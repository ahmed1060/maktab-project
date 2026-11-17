import { prisma } from "@/lib/prisma"
import type { Prisma } from "@prisma/client"
import { recomputeAfter } from "./attendance-recompute"
import { serialize } from "./attendance-calendar.service"
import { lockMonths, lockedMonths, punchMonthsOf } from "./attendance-lock"
import { localToInstant } from "@/lib/attendance/punch-import"
import { addDays } from "@/lib/attendance/calendar"
import { calendarDateStr, offsetMsIn } from "@/lib/time"
import type { AuthenticatedAgent } from "./attendance-agent.service"
import { isRealWallClock, type PunchBatch } from "@/lib/attendance/agent-payloads"

/**
 * Punches from the terminals (ATTENDANCE_PLAN.md §17, §8.6), whichever way
 * they come: delivered by an agent, or sent by the terminal itself (§17.1).
 * Stored as they came — evidence, like an imported row — with the terminal
 * they came from and, when its mode says so, a direction decided now and
 * never again.
 *
 * Delivery is at least once: an agent resends until it hears back, and so
 * does a terminal, so a punch seen twice is the same punch. Its key is the
 * terminal's own record identity — terminal, user number, time — the same
 * whichever way it came, so a retry, or the same scan by the other way, is
 * "duplicate", never a second punch (§17.6, PR 290).
 *
 * The answer says, for every punch not stored, why. An agent is also told
 * whether sending it again could ever help: it advances past a punch only
 * once it is stored or will never be. A terminal holds nothing back, so
 * nothing of its own waits to be sent again (§17.5).
 */

/** How far ahead of the company's clock a punch may be: a terminal a little fast is not wrong. */
export const FUTURE_TOLERANCE_MINUTES = 60

/**
 * How far ahead a punch is still worth sending again: from a terminal hours
 * fast, or set to another zone, it is a real scan, and in an hour or two it
 * is taken (review on #17). It used to be refused for good and the agent
 * dropped it. Further ahead the terminal's date is wrong, and a punch held
 * that long would keep the terminal from being cleared.
 */
export const FUTURE_RETRY_HOURS = 24

export type Refusal = "UNKNOWN_DEVICE" | "DEVICE_RETIRED" | "MONTH_LOCKED" | "IN_FUTURE" | "INVALID_TIME"
/**
 * An unknown terminal can come right: the agent's next heartbeat brings it
 * in. So can a punch a little too far ahead (FUTURE_RETRY_HOURS).
 */
const RETRYABLE: Record<Refusal, boolean> = { UNKNOWN_DEVICE: true, DEVICE_RETIRED: false, MONTH_LOCKED: false, IN_FUTURE: false, INVALID_TIME: false }

/**
 * Why a terminal's own scan was refused (§17.5, §17.6, PR 290): the
 * company's switch is off, the terminal is set to the agent or retired, the
 * scan's month is paid, or its time is one no calendar has or too far ahead.
 */
export type TerminalRefusal = "DIRECT_NOT_ALLOWED" | "DEVICE_VIA_AGENT" | "DEVICE_RETIRED" | "MONTH_LOCKED" | "IN_FUTURE" | "INVALID_TIME"

/** The two ways a terminal's scan comes in. They share its key (§17.6). */
export const TERMINAL_SOURCES = ["AGENT", "DEVICE_PUSH"] as const
type TerminalSource = (typeof TERMINAL_SOURCES)[number]

const wallClock = (local: string) => new Date(`${local}Z`)

/** The latest wall-clock time, in the company's zone, that is `ms` ahead of now. */
const aheadOf = (now: Date, timeZone: string, ms: number) => new Date(now.getTime() + offsetMsIn(now, timeZone) + ms).toISOString().slice(0, 19)

export type IngestResult = {
    accepted: number
    duplicates: number
    refused: { index: number; reason: Refusal; retry: boolean }[]
}

export type TerminalResult = {
    accepted: number
    duplicates: number
    /** From before the company started with terminals: answered, never stored. */
    skipped: number
    refused: { index: number; reason: TerminalRefusal }[]
}

/**
 * A scan to store: where it was in what was sent, and the terminal it came
 * from. `kept`: what a scan a terminal sent itself keeps of its event
 * (§17.5, PR 293); the agent's has none.
 */
type Candidate = { index: number; deviceId: string; mode: string; userNumber: string; at: string; kept?: Prisma.InputJsonObject }

/**
 * The steps both ways in share (§17.6, PR 290), inside the caller's
 * transaction, so that a scan is the same punch whichever way it came: the
 * employee numbers, the months' lock, what is already there under either
 * source, the direction from the terminal's mode, and each terminal's last
 * scan. `candidates` holds each scan once, by its key.
 *
 * A scan already there is already there, whatever has happened to its month
 * since: a terminal sending its whole memory after a switch is not refused
 * what Nizmo holds. A new one in a month whose payroll is approved is
 * handed to `paid`, and not stored.
 */
async function store(
    tx: Prisma.TransactionClient, companyId: string, timeZone: string, source: TerminalSource,
    candidates: Map<string, Candidate>, paid: (c: Candidate) => void,
) {
    // Mappings under the lock mapping takes, then the months, in the same
    // order as an import (review on #12): a number mapped while these go in
    // either reaches them or finds them waiting.
    await serialize(tx, `attendance-codes:${companyId}`)
    const mappings = await tx.attendanceCode.findMany({ where: { companyId, code: { in: [...new Set([...candidates.values()].map(c => c.userNumber))] } }, select: { code: true, userId: true } })
    const owner = new Map(mappings.map(m => [m.code, m.userId]))
    // A check-out just after midnight on the 1st can close the last night of
    // the month before, so that month is locked too. All of them at once: a
    // night shift's backlog read the days and the calendar again for each
    // punch (review on #49).
    const keys = [...candidates.keys()]
    const listed = await punchMonthsOf(tx, companyId, keys.map(k => ({ userId: owner.get(candidates.get(k)!.userNumber) ?? null, local: candidates.get(k)!.at })))
    const monthsOf = new Map(keys.map((k, i) => [k, listed[i]]))
    const months = new Set([...monthsOf.values()].flat())
    await lockMonths(tx, companyId, months)
    const approved = await lockedMonths(tx, companyId, months)

    // Under either source: the agent's delivery and the terminal's own are the same scan.
    const existing = await tx.attendancePunch.findMany({ where: { companyId, source: { in: [...TERMINAL_SOURCES] }, sourceKey: { in: keys } }, select: { sourceKey: true } })
    const seen = new Set(existing.map(e => e.sourceKey))
    const fresh: [string, Candidate][] = []
    for (const [key, c] of candidates) {
        if (seen.has(key)) continue
        if (monthsOf.get(key)!.some(m => approved.has(m))) paid(c)
        else fresh.push([key, c])
    }
    if (fresh.length > 0) {
        await tx.attendancePunch.createMany({
            data: fresh.map(([key, c]) => ({
                companyId, source, sourceKey: key, deviceId: c.deviceId,
                userId: owner.get(c.userNumber) ?? null, hardwareUserId: c.userNumber,
                punchAtLocal: wallClock(c.at), punchAt: localToInstant(c.at, timeZone), resolvedWithTimeZone: timeZone,
                // The terminal's mode now, kept on the punch (§17): changing the mode later reinterprets nothing.
                direction: c.mode === "ENTRANCE" ? "IN" as const : c.mode === "EXIT" ? "OUT" as const : null,
                // Only a new punch keeps its event: one already there stays as it is.
                ...(c.kept && { rawPayload: c.kept }),
            })),
            skipDuplicates: true,
        })
        const lastPunch = new Map<string, Date>()
        for (const [, c] of fresh) {
            const at = localToInstant(c.at, timeZone)
            if (!lastPunch.has(c.deviceId) || lastPunch.get(c.deviceId)! < at) lastPunch.set(c.deviceId, at)
        }
        for (const [id, at] of lastPunch) {
            await tx.attendanceDevice.updateMany({ where: { id, OR: [{ lastPunchAt: null }, { lastPunchAt: { lt: at } }] }, data: { lastPunchAt: at } })
        }
    }
    return {
        accepted: fresh.length, duplicates: seen.size,
        // Whose days these punches touch, and from when. Punches nobody is
        // mapped to yet wait for the mapping, which rebuilds them then.
        people: [...new Set(fresh.map(([, c]) => owner.get(c.userNumber)).filter((u): u is string => !!u))],
        from: fresh.map(([, c]) => c.at.slice(0, 10)).sort()[0] ?? null,
    }
}

/**
 * The date a company's terminals start from: the first of the month, in its
 * own time zone, in which its first terminal was seen. A terminal sends its
 * whole memory on its first contact, years of it; the agent's `sendFrom`
 * leaves those out, and so does this (§17.6).
 */
async function terminalsStart(tx: Prisma.TransactionClient, companyId: string, timeZone: string): Promise<string> {
    const first = await tx.attendanceDevice.findFirst({ where: { companyId }, orderBy: { firstSeenAt: "asc" }, select: { firstSeenAt: true } })
    return `${calendarDateStr(first?.firstSeenAt ?? new Date(), timeZone).slice(0, 7)}-01`
}

export class AttendanceIngestService {
    /**
     * Punches as an agent delivers them. Those for a terminal set straight
     * to Nizmo are still taken, each stored once: what the agent read
     * before it heard of the change isn't lost (§17.6, PR 290).
     */
    static async punches(agent: AuthenticatedAgent, batch: PunchBatch): Promise<IngestResult> {
        const { companyId, timeZone } = agent
        const now = new Date()
        const latest = aheadOf(now, timeZone, FUTURE_TOLERANCE_MINUTES * 60_000)
        const latestToRetry = aheadOf(now, timeZone, FUTURE_RETRY_HOURS * 3_600_000)
        const serials = [...new Set(batch.punches.map(p => p.serialNumber))]

        const outcome = await prisma.$transaction(async tx => {
            const devices = await tx.attendanceDevice.findMany({ where: { companyId, serialNumber: { in: serials } }, select: { id: true, serialNumber: true, mode: true, retiredAt: true } })
            const device = new Map(devices.map(d => [d.serialNumber, d]))
            const refused: IngestResult["refused"] = []
            const refuse = (index: number, reason: Refusal, retry = RETRYABLE[reason]) => refused.push({ index, reason, retry })

            // Each punch once, by its key, in the order it came.
            const candidates = new Map<string, Candidate>()
            batch.punches.forEach((p, index) => {
                // A damaged record: stored, it would land on another day, in a month its own lock doesn't cover.
                if (!isRealWallClock(p.at)) return refuse(index, "INVALID_TIME")
                const d = device.get(p.serialNumber)
                if (!d) return refuse(index, "UNKNOWN_DEVICE")
                if (d.retiredAt) return refuse(index, "DEVICE_RETIRED")
                if (p.at > latest) return refuse(index, "IN_FUTURE", p.at <= latestToRetry)
                const key = `${d.id}:${p.userNumber}:${p.at}`
                if (!candidates.has(key)) candidates.set(key, { index, deviceId: d.id, mode: d.mode, userNumber: p.userNumber, at: p.at })
            })
            const sameBatchRepeats = batch.punches.length - refused.length - candidates.size

            const stored = await store(tx, companyId, timeZone, "AGENT", candidates, c => refuse(c.index, "MONTH_LOCKED"))
            await tx.attendanceAgent.update({ where: { id: agent.id }, data: { lastSyncAt: now } })
            // What the agent drops from its queue now: all but what it keeps to retry. Its heartbeat
            // reports the queue before it sends, so without this the card says these wait until the next
            // round (§17.13, PR 308). Never below none; an agent that hasn't reported a count keeps none.
            const settled = batch.punches.length - refused.filter(r => r.retry).length
            if (settled > 0) await tx.$executeRaw`UPDATE "AttendanceAgent" SET "queueDepth" = GREATEST("queueDepth" - ${settled}, 0) WHERE id = ${agent.id} AND "queueDepth" IS NOT NULL`
            return {
                result: { accepted: stored.accepted, duplicates: stored.duplicates + sameBatchRepeats, refused: refused.sort((a, b) => a.index - b.index) },
                people: stored.people, from: stored.from,
            }
        }, { timeout: 60_000 })

        // The days these punches touch, for the people they belong to; from
        // the day before the first, since an early check-out can close the
        // night before's shift (review on #13).
        if (outcome.from && outcome.people.length > 0) await recomputeAfter(companyId, addDays(outcome.from, -1), outcome.people)
        return outcome.result
    }

    /**
     * Scans a terminal sent itself (§17.2, §17.3; PR 290), through the same
     * steps as the agent's. Whose request it is, whether its company may
     * use terminals at all, and the shape of what was sent are for the
     * route to settle first, as `authenticate` and the batch's schema do
     * for an agent: parts 5 and 6 add the routes.
     *
     * A terminal uses one connection at a time (§17.6): its own scans are
     * refused once it is retired, while the company's switch is off, and
     * while it is set to the agent. Otherwise every scan is answered:
     * stored, already there, skipped as from before the company's terminals
     * started, or refused. What is refused is counted on the terminal, with
     * the latest reason (§17.5).
     */
    static async fromTerminal(deviceId: string, scans: readonly { userNumber: string; at: string; kept?: Prisma.InputJsonObject }[]): Promise<TerminalResult> {
        const now = new Date()
        const outcome = await prisma.$transaction(async tx => {
            const device = await tx.attendanceDevice.findUnique({
                where: { id: deviceId },
                select: { id: true, companyId: true, mode: true, retiredAt: true, connection: true, company: { select: { timezone: true, terminalsDirectAllowed: true } } },
            })
            if (!device) throw new Error("DEVICE_NOT_FOUND")
            const { companyId } = device
            const timeZone = device.company.timezone
            const refused: TerminalResult["refused"] = []
            const refuse = (index: number, reason: TerminalRefusal) => refused.push({ index, reason })
            const candidates = new Map<string, Candidate>()
            let skipped = 0
            let sameRequestRepeats = 0
            let stored: Awaited<ReturnType<typeof store>> | null = null

            const turnedAway: TerminalRefusal | null = device.retiredAt ? "DEVICE_RETIRED"
                : !device.company.terminalsDirectAllowed ? "DIRECT_NOT_ALLOWED"
                    : device.connection !== "DIRECT" ? "DEVICE_VIA_AGENT" : null
            if (turnedAway) scans.forEach((_, index) => refuse(index, turnedAway))
            else {
                const latest = aheadOf(now, timeZone, FUTURE_TOLERANCE_MINUTES * 60_000)
                const start = await terminalsStart(tx, companyId, timeZone)
                scans.forEach((s, index) => {
                    if (!isRealWallClock(s.at)) {
                        refuse(index, "INVALID_TIME")
                    } else if (s.at.slice(0, 10) < start) {
                        skipped += 1
                    } else if (s.at > latest) {
                        // Unlike the agent, a terminal can't hold a scan and offer it again later (§17.5).
                        refuse(index, "IN_FUTURE")
                    } else {
                        const key = `${device.id}:${s.userNumber}:${s.at}`
                        if (!candidates.has(key)) candidates.set(key, { index, deviceId: device.id, mode: device.mode, userNumber: s.userNumber, at: s.at, kept: s.kept })
                    }
                })
                sameRequestRepeats = scans.length - refused.length - skipped - candidates.size
                stored = await store(tx, companyId, timeZone, "DEVICE_PUSH", candidates, c => refuse(c.index, "MONTH_LOCKED"))
            }
            refused.sort((a, b) => a.index - b.index)
            if (refused.length > 0) {
                await tx.attendanceDevice.update({
                    where: { id: device.id },
                    data: { refusedCount: { increment: refused.length }, lastRefusedAt: now, lastRefusal: refused[refused.length - 1].reason },
                })
            }
            return {
                companyId,
                result: { accepted: stored?.accepted ?? 0, duplicates: (stored?.duplicates ?? 0) + sameRequestRepeats, skipped, refused },
                people: stored?.people ?? [], from: stored?.from ?? null,
            }
        }, { timeout: 60_000 })

        // As for the agent's: from the day before the first, for the people they belong to.
        if (outcome.from && outcome.people.length > 0) await recomputeAfter(outcome.companyId, addDays(outcome.from, -1), outcome.people)
        return outcome.result
    }
}

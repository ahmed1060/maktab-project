import { prisma } from "@/lib/prisma"
import { recomputeAfter } from "./attendance-recompute"
import { serialize } from "./attendance-calendar.service"
import { lockMonths, lockedMonths, punchMonths } from "./attendance-lock"
import { localToInstant } from "@/lib/attendance/punch-import"
import { addDays } from "@/lib/attendance/calendar"
import { offsetMsIn } from "@/lib/time"
import type { AuthenticatedAgent } from "./attendance-agent.service"
import { isRealWallClock, type PunchBatch } from "@/lib/attendance/agent-payloads"

/**
 * Punches from the terminals, as an agent delivers them (ATTENDANCE_PLAN.md
 * §17, §8.6). Stored as they came — evidence, like an imported row — with
 * the terminal they came from and, when its mode says so, a direction
 * decided now and never again.
 *
 * Delivery is at least once: an agent resends until it hears back, so a
 * punch seen twice is the same punch. Its key is the terminal's own record
 * identity — terminal, user number, time — so a retry is "duplicate", never
 * a second punch.
 *
 * The answer says, for every punch not stored, why, and whether sending it
 * again could ever help: an agent advances past a punch only once it is
 * stored or will never be.
 */

/** How far ahead of the company's clock a punch may be: a terminal a little fast is not wrong. */
export const FUTURE_TOLERANCE_MINUTES = 60

export type Refusal = "UNKNOWN_DEVICE" | "DEVICE_RETIRED" | "MONTH_LOCKED" | "IN_FUTURE" | "INVALID_TIME"
/** Only an unknown terminal can come right: the agent's next heartbeat brings it in. */
const RETRYABLE: Record<Refusal, boolean> = { UNKNOWN_DEVICE: true, DEVICE_RETIRED: false, MONTH_LOCKED: false, IN_FUTURE: false, INVALID_TIME: false }

const wallClock = (local: string) => new Date(`${local}Z`)
const monthOf = (local: string) => local.slice(0, 7)

export type IngestResult = {
    accepted: number
    duplicates: number
    refused: { index: number; reason: Refusal; retry: boolean }[]
}

export class AttendanceIngestService {
    static async punches(agent: AuthenticatedAgent, batch: PunchBatch): Promise<IngestResult> {
        const { companyId, timeZone } = agent
        const now = new Date()
        const latest = new Date(now.getTime() + offsetMsIn(now, timeZone) + FUTURE_TOLERANCE_MINUTES * 60_000).toISOString().slice(0, 19)
        const serials = [...new Set(batch.punches.map(p => p.serialNumber))]

        const outcome = await prisma.$transaction(async tx => {
            const devices = await tx.attendanceDevice.findMany({ where: { companyId, serialNumber: { in: serials } }, select: { id: true, serialNumber: true, mode: true, retiredAt: true } })
            const device = new Map(devices.map(d => [d.serialNumber, d]))
            const refused: IngestResult["refused"] = []
            const refuse = (index: number, reason: Refusal) => refused.push({ index, reason, retry: RETRYABLE[reason] })

            // Each punch once, by its key, in the order it came.
            const candidates = new Map<string, { index: number; deviceId: string; mode: string; userNumber: string; at: string }>()
            batch.punches.forEach((p, index) => {
                // A damaged record: stored, it would land on another day, in a month its own lock doesn't cover.
                if (!isRealWallClock(p.at)) return refuse(index, "INVALID_TIME")
                const d = device.get(p.serialNumber)
                if (!d) return refuse(index, "UNKNOWN_DEVICE")
                if (d.retiredAt) return refuse(index, "DEVICE_RETIRED")
                if (p.at > latest) return refuse(index, "IN_FUTURE")
                const key = `${d.id}:${p.userNumber}:${p.at}`
                if (!candidates.has(key)) candidates.set(key, { index, deviceId: d.id, mode: d.mode, userNumber: p.userNumber, at: p.at })
            })
            const sameBatchRepeats = batch.punches.length - refused.length - candidates.size

            // Mappings under the lock mapping takes, then the months, in the
            // same order as an import (review on #12): a number mapped while
            // this batch goes in either reaches it or finds it waiting.
            await serialize(tx, `attendance-codes:${companyId}`)
            const mappings = await tx.attendanceCode.findMany({ where: { companyId, code: { in: [...new Set([...candidates.values()].map(c => c.userNumber))] } }, select: { code: true, userId: true } })
            const owner = new Map(mappings.map(m => [m.code, m.userId]))
            // A check-out just after midnight on the 1st can close the last
            // night of the month before, so that month is locked too.
            const monthsOf = new Map<string, string[]>()
            for (const [key, c] of candidates) {
                const userId = owner.get(c.userNumber)
                monthsOf.set(key, userId ? await punchMonths(tx, companyId, userId, c.at) : [monthOf(c.at)])
            }
            const months = new Set([...monthsOf.values()].flat())
            await lockMonths(tx, companyId, months)
            const locked = await lockedMonths(tx, companyId, months)
            for (const [key, c] of candidates) {
                if (monthsOf.get(key)!.some(m => locked.has(m))) {
                    refuse(c.index, "MONTH_LOCKED")
                    candidates.delete(key)
                }
            }

            const existing = await tx.attendancePunch.findMany({ where: { companyId, source: "AGENT", sourceKey: { in: [...candidates.keys()] } }, select: { sourceKey: true } })
            const seen = new Set(existing.map(e => e.sourceKey))
            const fresh = [...candidates].filter(([key]) => !seen.has(key))
            if (fresh.length > 0) {
                await tx.attendancePunch.createMany({
                    data: fresh.map(([key, c]) => ({
                        companyId, source: "AGENT" as const, sourceKey: key, deviceId: c.deviceId,
                        userId: owner.get(c.userNumber) ?? null, hardwareUserId: c.userNumber,
                        punchAtLocal: wallClock(c.at), punchAt: localToInstant(c.at, timeZone), resolvedWithTimeZone: timeZone,
                        // The terminal's mode now, kept on the punch (§17): changing the mode later reinterprets nothing.
                        direction: c.mode === "ENTRANCE" ? "IN" as const : c.mode === "EXIT" ? "OUT" as const : null,
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
            await tx.attendanceAgent.update({ where: { id: agent.id }, data: { lastSyncAt: now } })

            const people = [...new Set(fresh.map(([, c]) => owner.get(c.userNumber)).filter((u): u is string => !!u))]
            const from = fresh.map(([, c]) => c.at.slice(0, 10)).sort()[0] ?? null
            return {
                result: { accepted: fresh.length, duplicates: seen.size + sameBatchRepeats, refused: refused.sort((a, b) => a.index - b.index) },
                people, from,
            }
        }, { timeout: 60_000 })

        // The days these punches touch, for the people they belong to; from
        // the day before the first, since an early check-out can close the
        // night before's shift (review on #13). Punches nobody is mapped to
        // yet wait for the mapping, which rebuilds them then.
        if (outcome.from && outcome.people.length > 0) await recomputeAfter(companyId, addDays(outcome.from, -1), outcome.people)
        return outcome.result
    }
}

import { prisma } from "@/lib/prisma"
import type { Prisma } from "@prisma/client"
import { hasBundle, resolveBundles } from "@/lib/features/bundles"
import { hashSecret } from "@/lib/attendance/agent-credentials"
import type { TerminalInfo } from "@/lib/attendance/zkteco-adms"
import { AttendanceIngestService } from "./attendance-ingest.service"

/**
 * A terminal straight to Nizmo, on its side of the conversation
 * (ATTENDANCE_PLAN.md §17.2, §17.3, §17.5; PR 291, PR 296): whose request
 * it is, and what becomes of what it sent. The company comes from the
 * terminal the secret or the serial number belongs to, never from the
 * request (§2).
 */

/** Why a known terminal's request is held for now. It sends again until it is answered. */
export type PushRefusal = "COMPANY_BANNED" | "TERMINALS_NOT_INCLUDED" | "DIRECT_NOT_ALLOWED"

/**
 * What a terminal sent, whichever protocol it speaks: a scan, with the
 * offset from UTC it states if it states one and what the scan keeps of
 * it; something refused, counted with its reason; or something answered
 * and dropped.
 */
export type TakenEvent =
    | { kind: "scan"; userNumber: string; at: string; offsetMinutes?: number | null; kept: Prisma.InputJsonObject }
    | { kind: "refused"; reason: string }
    | { kind: "other" }

const isScan = (e: TakenEvent): e is Extract<TakenEvent, { kind: "scan" }> => e.kind === "scan"
const isRefused = (e: TakenEvent): e is Extract<TakenEvent, { kind: "refused" }> => e.kind === "refused"

/** A terminal sending its whole memory sends thousands of lines: they are stored this many at a time. */
export const SCANS_AT_A_TIME = 1000

const COMPANY = { isBanned: true, terminalsDirectAllowed: true, timezone: true, package: { select: { hasCompanyManagement: true, hasHR: true, hasAttendanceTerminals: true, hasAttendanceMobile: true } } } as const

/** Whether a terminal's company may use it now: not suspended, holding the Terminals add-on, and with terminals straight to Nizmo switched on (§17.8). */
function heldFor(company: { isBanned: boolean; terminalsDirectAllowed: boolean; package: Parameters<typeof resolveBundles>[0] }): PushRefusal | null {
    return company.isBanned ? "COMPANY_BANNED"
        : !hasBundle(resolveBundles(company.package), "ATTENDANCE_TERMINALS") ? "TERMINALS_NOT_INCLUDED"
            : !company.terminalsDirectAllowed ? "DIRECT_NOT_ALLOWED" : null
}

export class AttendanceTerminalPushService {
    /**
     * The terminal a secret belongs to, by the secret's hash, and whether
     * its company may use it now: not suspended, holding the Terminals
     * add-on, and with terminals straight to Nizmo switched on (§17.8).
     * Null when the secret is nobody's, or its terminal speaks another
     * protocol.
     *
     * `firstContactAt`: when its first request was taken, for keeping its
     * first contacts (§17.8, PR 294); `live`: it is straight to Nizmo and
     * not retired, the only terminal whose contacts are kept.
     */
    static async bySecret(secret: string, protocol: "HIKVISION"): Promise<{ deviceId: string; refused: PushRefusal | null; firstContactAt: Date | null; live: boolean } | null> {
        const device = await prisma.attendanceDevice.findUnique({
            where: { pushSecretHash: hashSecret(secret) },
            select: { id: true, protocol: true, connection: true, retiredAt: true, firstContactAt: true, company: { select: COMPANY } },
        })
        if (!device || device.protocol !== protocol) return null
        return { deviceId: device.id, refused: heldFor(device.company), firstContactAt: device.firstContactAt, live: device.connection === "DIRECT" && !device.retiredAt }
    }

    /**
     * The ZKTeco terminal a serial number names (§17.3, PR 296): one added
     * straight to Nizmo and not retired. With it, the addresses it may
     * call from, where it had got to in its logs, its company's time zone,
     * and whether its company may use it now; and when its first request
     * was taken, for keeping its first contacts (§17.8, PR 299). Null when
     * the serial number is nobody's: one an agent brought in, a retired
     * one, and one on another protocol's terminal are nobody's here.
     *
     * A serial number is one terminal's, one company at a time (§17.7):
     * the database holds one that isn't retired for each serial number
     * (`AttendanceDevice_serialNumber_active_key`), and that index is
     * what finds it, a heartbeat every half minute.
     */
    static async bySerial(serial: string): Promise<{ deviceId: string; serial: string; allowedAddresses: string[]; cursor: string | null; timeZone: string; refused: PushRefusal | null; firstContactAt: Date | null } | null> {
        const device = await prisma.attendanceDevice.findFirst({
            where: { serialNumber: serial, retiredAt: null },
            select: { id: true, serialNumber: true, protocol: true, connection: true, allowedAddresses: true, pushCursor: true, firstContactAt: true, company: { select: COMPANY } },
        })
        if (!device || device.protocol !== "ZKTECO" || device.connection !== "DIRECT") return null
        return {
            deviceId: device.id, serial: device.serialNumber, allowedAddresses: device.allowedAddresses, cursor: device.pushCursor,
            timeZone: device.company.timezone, refused: heldFor(device.company), firstContactAt: device.firstContactAt,
        }
    }

    /**
     * A call in a terminal's name from an address that isn't one of its
     * own (§17.3): counted on it as refused, with the address, so its card
     * says which one to add when the office's has changed.
     */
    static async calledFromElsewhere(deviceId: string, address: string): Promise<void> {
        await prisma.attendanceDevice.update({
            where: { id: deviceId },
            data: { refusedCount: { increment: 1 }, lastRefusedAt: new Date(), lastRefusal: `ADDRESS_NOT_ALLOWED:${address.slice(0, 64)}` },
        })
    }

    /**
     * Where a terminal had got to in its logs, once what it sent up to
     * there is taken (§17.3). `moved` is given what the terminal's row
     * holds now, with the row held, and returns what it is to hold.
     *
     * A ZKTeco terminal's two logs are kept together, and uploads of both
     * can arrive at once: each written from what its request read on
     * arriving, the later would undo the other's, and the terminal would
     * be told to send again what was already answered (review on PR 296).
     * Within one log the upload answered last has the say, even to a
     * lower stamp: a terminal whose clock or log was reset counts from
     * lower again, and going back only has it send what is already there.
     *
     * Not FOR UPDATE: that also holds up a scan being stored for the
     * terminal, which takes a key share on its row.
     */
    static async gotTo(deviceId: string, moved: (kept: string | null) => string): Promise<void> {
        await prisma.$transaction(async tx => {
            const held = await tx.$queryRaw<{ pushCursor: string | null }[]>`SELECT "pushCursor" FROM "AttendanceDevice" WHERE id = ${deviceId} AND "connection" = 'DIRECT' AND "retiredAt" IS NULL FOR NO KEY UPDATE`
            if (held.length === 0) return
            await tx.attendanceDevice.update({ where: { id: deviceId }, data: { pushCursor: moved(held[0].pushCursor) } })
        })
    }

    /**
     * What a terminal sent, taken: the request is its contact, its scans go
     * through the same steps as any terminal's own (§17.6), and what can't
     * be kept is counted on it with the reason (§17.5). `events` is null
     * for a body that couldn't be read.
     *
     * A terminal that is retired, or set to the agent, is refused there and
     * counted; its contact isn't noted, since how it is doing is then the
     * agent's to say, or nobody's.
     *
     * With the contact goes the terminal's own offset from UTC, as the last
     * scan here states it, and each scan keeps the fields of its event that
     * Nizmo knows (§17.5, PR 293); and what the terminal says of itself,
     * when it does (`said`: a ZKTeco terminal's firmware and counts, §17.3).
     *
     * Scans are stored a thousand at a time: a ZKTeco terminal moved from
     * the agent sends its whole memory (§17.6). If one lot fails, the
     * request does, and the terminal sends it all again: what was stored
     * is then already there.
     */
    static async receive(deviceId: string, events: readonly TakenEvent[] | null, address: string, said: TerminalInfo | null = null) {
        const now = new Date()
        const scans = (events ?? []).filter(isScan)
        const stated = scans.filter(s => typeof s.offsetMinutes === "number")
        await prisma.attendanceDevice.updateMany({
            where: { id: deviceId, connection: "DIRECT", retiredAt: null },
            data: {
                lastSeenAt: now, lastAddress: address.slice(0, 64),
                ...(stated.length > 0 && { utcOffsetMinutes: stated[stated.length - 1].offsetMinutes }),
                ...(said?.firmware && { firmware: said.firmware }),
                ...(typeof said?.userCount === "number" && { userCount: said.userCount }),
                ...(typeof said?.recordCount === "number" && { recordCount: said.recordCount }),
            },
        })
        let stored: Awaited<ReturnType<typeof AttendanceIngestService.fromTerminal>> | null = null
        for (let from = 0; from < scans.length; from += SCANS_AT_A_TIME) {
            const lot = await AttendanceIngestService.fromTerminal(deviceId, scans.slice(from, from + SCANS_AT_A_TIME).map(({ userNumber, at, kept }) => ({ userNumber, at, kept })))
            stored = stored === null ? lot : {
                accepted: stored.accepted + lot.accepted, duplicates: stored.duplicates + lot.duplicates, skipped: stored.skipped + lot.skipped,
                refused: [...stored.refused, ...lot.refused.map(r => ({ ...r, index: r.index + from }))],
            }
        }
        const reasons = events === null ? ["UNREADABLE"] : events.filter(isRefused).map(e => e.reason)
        if (reasons.length > 0) {
            await prisma.attendanceDevice.update({
                where: { id: deviceId },
                data: { refusedCount: { increment: reasons.length }, lastRefusedAt: now, lastRefusal: reasons[reasons.length - 1] },
            })
        }
        return { stored, counted: reasons }
    }
}

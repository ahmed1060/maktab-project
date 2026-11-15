import { prisma } from "@/lib/prisma"
import { hasBundle, resolveBundles } from "@/lib/features/bundles"
import { hashSecret } from "@/lib/attendance/agent-credentials"
import type { TerminalEvent } from "@/lib/attendance/hikvision-events"
import { AttendanceIngestService } from "./attendance-ingest.service"

/**
 * A terminal straight to Nizmo, on its side of the conversation
 * (ATTENDANCE_PLAN.md §17.2, §17.5, PR 291): whose request it is, and what
 * becomes of what it sent. The company comes from the terminal the secret
 * belongs to, never from the request (§2).
 */

/** Why a known terminal's request is held for now. It sends again until it is answered. */
export type PushRefusal = "COMPANY_BANNED" | "TERMINALS_NOT_INCLUDED" | "DIRECT_NOT_ALLOWED"

const isScan = (e: TerminalEvent): e is Extract<TerminalEvent, { kind: "scan" }> => e.kind === "scan"
const isRefused = (e: TerminalEvent): e is Extract<TerminalEvent, { kind: "refused" }> => e.kind === "refused"

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
            select: {
                id: true, protocol: true, connection: true, retiredAt: true, firstContactAt: true,
                company: { select: { isBanned: true, terminalsDirectAllowed: true, package: { select: { hasCompanyManagement: true, hasHR: true, hasAttendanceTerminals: true, hasAttendanceMobile: true } } } },
            },
        })
        if (!device || device.protocol !== protocol) return null
        const refused = device.company.isBanned ? "COMPANY_BANNED"
            : !hasBundle(resolveBundles(device.company.package), "ATTENDANCE_TERMINALS") ? "TERMINALS_NOT_INCLUDED"
                : !device.company.terminalsDirectAllowed ? "DIRECT_NOT_ALLOWED" : null
        return { deviceId: device.id, refused, firstContactAt: device.firstContactAt, live: device.connection === "DIRECT" && !device.retiredAt }
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
     * Nizmo knows (§17.5, PR 293).
     */
    static async receive(deviceId: string, events: readonly TerminalEvent[] | null, address: string) {
        const now = new Date()
        const scans = (events ?? []).filter(isScan)
        const stated = scans.filter(s => s.offsetMinutes !== null)
        await prisma.attendanceDevice.updateMany({
            where: { id: deviceId, connection: "DIRECT", retiredAt: null },
            data: { lastSeenAt: now, lastAddress: address.slice(0, 64), ...(stated.length > 0 && { utcOffsetMinutes: stated[stated.length - 1].offsetMinutes }) },
        })
        const stored = scans.length > 0 ? await AttendanceIngestService.fromTerminal(deviceId, scans.map(({ userNumber, at, kept }) => ({ userNumber, at, kept }))) : null
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

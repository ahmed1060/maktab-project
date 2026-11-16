import { RateLimiter } from "@/lib/api-utils"
import { offsetMsIn } from "@/lib/time"
import { AuditLogService } from "@/lib/services/audit-log.service"
import { SystemSettingsService } from "@/lib/services/system-settings.service"
import { AttendanceTerminalPushService } from "@/lib/services/attendance-terminal-push.service"
import { TerminalFirstContactService } from "@/lib/services/terminal-first-contact.service"
import { isNextInternalError } from "@/lib/next-internal-error"
import { ipInRanges } from "./ip-ranges"
import { PER_TERMINAL_PER_MINUTE, UNKNOWN_PER_ADDRESS } from "./terminal-handler"
import { keepingFor, roomFor } from "./terminal-first-contact"
import { ICLOCK_ROUTE, admsRequest, attlogOf, cursorOf, cursorWith, optionsAnswer, type AdmsRequest } from "./zkteco-adms"
import { admsContact, admsKind } from "./zkteco-first-contact"

/**
 * A ZKTeco terminal's side of the API (ATTENDANCE_PLAN.md §17.3, PR 296):
 * everything under `/iclock/`. There is no session, no token and no
 * secret: a terminal names itself by its serial number, which is printed
 * on it. So a request is the terminal's only when it also comes from one
 * of the addresses kept for that terminal, the office's own.
 *
 * A terminal counts anything but 200 as a failure and tries again, so:
 *
 * - **200** with `OK`, or with its options, once the request is the
 *   terminal's and has been taken, whether its scans were stored, already
 *   there, or refused for good and counted (§17.5).
 * - **Anything else holds what it sent**, to be sent again: 503 during
 *   maintenance, 403 while its company may not use it, 429 past its
 *   limit, 500 when something fails that shouldn't.
 * - **403**, with nothing in it, to a serial number that is nobody's and
 *   to one called from elsewhere alike: nothing says which.
 */

const UNKNOWN_WINDOW_MS = 15 * 60_000

/** A call from elsewhere is noted on its terminal this often at most: one that polls from a changed address doesn't count thousands. */
export const ELSEWHERE_NOTED_EVERY_MS = 60 * 60_000

const refuse = (status: number) => new Response(null, { status })
const say = (text: string) => new Response(text, { status: 200, headers: { "Content-Type": "text/plain" } })

/**
 * Where a request came from, by Vercel's own header alone: a caller can't
 * set it, where it can prepend to `x-forwarded-for`. Without it nothing
 * says, and the request is refused (§17.3).
 */
function callerOf(headers: Headers): string | null {
    const address = headers.get("x-vercel-forwarded-for")?.split(",")[0].trim()
    return address ? address.slice(0, 64) : null
}

export async function receiveZkteco(req: Request): Promise<Response> {
    let deviceId: string | null = null
    try {
        // Held like the agent's punches, and for the same reason: a scan
        // stored during a restore could be lost to it (review on #17).
        if ((await SystemSettingsService.get()).maintenanceMode) return refuse(503)
        const address = callerOf(req.headers)
        if (!address) return refuse(403)
        const url = new URL(req.url)
        const asked = admsRequest(req.method, url)
        const terminal = asked ? await AttendanceTerminalPushService.bySerial(asked.serial) : null
        if (!asked || !terminal || !ipInRanges(address, terminal.allowedAddresses)) {
            // Counted against the address, whichever it was: a scanner
            // trying serial numbers, or a terminal whose office's address
            // changed.
            const { limited } = await RateLimiter.getLimitData(`terminal-unknown:${address}`, UNKNOWN_PER_ADDRESS, UNKNOWN_WINDOW_MS)
            if (limited) return refuse(429)
            if (terminal) {
                const noted = await RateLimiter.getLimitData(`terminal-elsewhere:${terminal.deviceId}`, 1, ELSEWHERE_NOTED_EVERY_MS)
                if (!noted.limited) await AttendanceTerminalPushService.calledFromElsewhere(terminal.deviceId, address)
            }
            return refuse(403)
        }
        deviceId = terminal.deviceId
        if (terminal.refused) return refuse(403)
        const { limited } = await RateLimiter.getLimitData(`terminal:${terminal.deviceId}`, PER_TERMINAL_PER_MINUTE, 60_000)
        if (limited) return refuse(429)

        // Its first contacts are kept for the Super Admin (§17.8, PR 299).
        // What kind of request it is, and so whether there is room to keep
        // it, is known from its address before anything it sent is read.
        const kind = admsKind(asked, req.method, url)
        const keeping = await mayKeep(terminal, kind, req.method)
        const taken = await take(req, asked, terminal, address)
        if (keeping) await keepContact(terminal.deviceId, req.method, () => admsContact(req, url, asked, taken.read))
        return say(taken.answer)
    } catch (error) {
        if (isNextInternalError(error)) throw error
        console.error("Terminal API error:", ICLOCK_ROUTE, error)
        await AuditLogService.logSystemError({ error, route: ICLOCK_ROUTE, method: req.method, extra: { deviceId } })
        return refuse(500)
    }
}

type Terminal = NonNullable<Awaited<ReturnType<typeof AttendanceTerminalPushService.bySerial>>>

/**
 * Takes a request that is the terminal's: what it is answered, and what
 * was read of it, for its first contacts. Only an attendance upload's body
 * is read.
 */
async function take(req: Request, asked: AdmsRequest, terminal: Terminal, address: string): Promise<{ answer: string; read: Parameters<typeof admsContact>[3] }> {
    switch (asked.kind) {
        case "options": {
            await AttendanceTerminalPushService.receive(terminal.deviceId, [], address)
            const offsetMinutes = Math.round(offsetMsIn(new Date(), terminal.timeZone) / 60_000)
            return { answer: optionsAnswer(terminal.serial, cursorOf(terminal.cursor), offsetMinutes), read: {} }
        }
        case "scans": {
            const { stamp } = asked
            const text = await req.text()
            const lines = attlogOf(text)
            const { stored } = await AttendanceTerminalPushService.receive(terminal.deviceId, lines, address)
            // Only once they are taken: were this to fail before, the terminal sends them again from where it was.
            // This log's stamp alone, beside the other's as the row holds it then, not as this request read it.
            if (stamp) await AttendanceTerminalPushService.gotTo(terminal.deviceId, kept => cursorWith(kept, { scans: stamp }))
            return { answer: `OK: ${lines.length}\n`, read: { text, lines, stored } }
        }
        case "people": {
            const { stamp } = asked
            // Names are in it: the body is never read (§17.5).
            await AttendanceTerminalPushService.receive(terminal.deviceId, [], address)
            if (stamp) await AttendanceTerminalPushService.gotTo(terminal.deviceId, kept => cursorWith(kept, { people: stamp }))
            return { answer: "OK\n", read: {} }
        }
        case "poll":
            // No command is ever sent (§19): this is its heartbeat.
            await AttendanceTerminalPushService.receive(terminal.deviceId, [], address, asked.info)
            return { answer: "OK\n", read: {} }
        default:
            await AttendanceTerminalPushService.receive(terminal.deviceId, [], address)
            return { answer: "OK\n", read: {} }
    }
}

/**
 * Whether a request may be kept among its terminal's first contacts: in
 * its first 7 days, with room for one more, and for one more of its kind.
 * Past its 7 days nothing is looked up. What is kept is counted again
 * when it is, with the terminal held.
 *
 * Counting is no more allowed to hold a terminal than keeping is: if it
 * fails, the request is taken and not kept (as for Hikvision, review on
 * PR 294).
 */
async function mayKeep(terminal: Terminal, kind: string, method: string): Promise<boolean> {
    if (!keepingFor(terminal.firstContactAt, new Date())) return false
    try {
        return roomFor(await TerminalFirstContactService.counts(terminal.deviceId), kind)
    } catch (error) {
        await notKept(error, terminal.deviceId, method)
        return false
    }
}

/**
 * Keeps a request among its terminal's first contacts, once it is taken:
 * one held is sent again until it is, and would fill the 50 with copies.
 * Keeping never holds a terminal: the request is answered whatever
 * happens here, what is kept of it being worked out included, and a
 * failure is recorded.
 */
async function keepContact(deviceId: string, method: string, contactOf: () => ReturnType<typeof admsContact>): Promise<void> {
    try {
        await TerminalFirstContactService.keep(deviceId, contactOf())
    } catch (error) {
        await notKept(error, deviceId, method)
    }
}

/** Records that a first contact wasn't kept, and passes over it. */
async function notKept(error: unknown, deviceId: string, method: string): Promise<void> {
    if (isNextInternalError(error)) throw error
    console.error("Terminal first contact not kept:", ICLOCK_ROUTE, error)
    await AuditLogService.logSystemError({ error, route: ICLOCK_ROUTE, method, extra: { deviceId, step: "first contact" } }).catch(() => {})
}

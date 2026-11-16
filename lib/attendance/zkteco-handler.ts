import { RateLimiter } from "@/lib/api-utils"
import { offsetMsIn } from "@/lib/time"
import { AuditLogService } from "@/lib/services/audit-log.service"
import { SystemSettingsService } from "@/lib/services/system-settings.service"
import { AttendanceTerminalPushService } from "@/lib/services/attendance-terminal-push.service"
import { isNextInternalError } from "@/lib/next-internal-error"
import { ipInRanges } from "./ip-ranges"
import { PER_TERMINAL_PER_MINUTE, UNKNOWN_PER_ADDRESS } from "./terminal-handler"
import { ICLOCK_ROUTE, admsRequest, attlogOf, cursorOf, cursorWith, optionsAnswer } from "./zkteco-adms"

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
        const asked = admsRequest(req.method, new URL(req.url))
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

        switch (asked.kind) {
            case "options": {
                await AttendanceTerminalPushService.receive(terminal.deviceId, [], address)
                const offsetMinutes = Math.round(offsetMsIn(new Date(), terminal.timeZone) / 60_000)
                return say(optionsAnswer(terminal.serial, cursorOf(terminal.cursor), offsetMinutes))
            }
            case "scans": {
                const lines = attlogOf(await req.text())
                await AttendanceTerminalPushService.receive(terminal.deviceId, lines, address)
                // Only once they are taken: were this to fail before, the terminal sends them again from where it was.
                if (asked.stamp) await AttendanceTerminalPushService.gotTo(terminal.deviceId, cursorWith(terminal.cursor, { scans: asked.stamp }))
                return say(`OK: ${lines.length}\n`)
            }
            case "people": {
                // Names are in it: the body is never read (§17.5).
                await AttendanceTerminalPushService.receive(terminal.deviceId, [], address)
                if (asked.stamp) await AttendanceTerminalPushService.gotTo(terminal.deviceId, cursorWith(terminal.cursor, { people: asked.stamp }))
                return say("OK\n")
            }
            case "poll":
                // No command is ever sent (§19): this is its heartbeat.
                await AttendanceTerminalPushService.receive(terminal.deviceId, [], address, asked.info)
                return say("OK\n")
            default:
                await AttendanceTerminalPushService.receive(terminal.deviceId, [], address)
                return say("OK\n")
        }
    } catch (error) {
        if (isNextInternalError(error)) throw error
        console.error("Terminal API error:", ICLOCK_ROUTE, error)
        await AuditLogService.logSystemError({ error, route: ICLOCK_ROUTE, method: req.method, extra: { deviceId } })
        return refuse(500)
    }
}

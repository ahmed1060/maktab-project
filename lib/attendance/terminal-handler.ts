import { RateLimiter, getClientIp } from "@/lib/api-utils"
import { AuditLogService } from "@/lib/services/audit-log.service"
import { SystemSettingsService } from "@/lib/services/system-settings.service"
import { AttendanceTerminalPushService } from "@/lib/services/attendance-terminal-push.service"
import { TerminalFirstContactService } from "@/lib/services/terminal-first-contact.service"
import { isNextInternalError } from "@/lib/next-internal-error"
import { eventsOf, type TerminalEvent } from "./hikvision-events"
import { bodyOf, headersOf, keepingFor, outcomeOf, roomFor } from "./terminal-first-contact"
import { HIKVISION_ROUTE, isPushSecret } from "./terminal-secrets"

/**
 * A terminal's side of the API (ATTENDANCE_PLAN.md §17.2, PR 291):
 * `/api/terminals/hikvision/<secret>`. There is no session and no token: a
 * terminal is told an address, and the secret in it says whose it is.
 *
 * A terminal reads only the status. It sends an event again until it hears
 * 200, and waits behind what isn't answered, so:
 *
 * - **200**, with nothing in it, once the request is the terminal's and has
 *   been taken, whether its scans were stored, already there, or refused
 *   for good and counted (§17.5).
 * - **Anything else holds the event on the terminal**, to be sent again:
 *   503 during maintenance, 403 while its company may not use it, 429 past
 *   its limit, 500 when something fails that shouldn't.
 * - **404** to a secret that is nobody's. Nothing says whether it was close.
 */

/** Wrong secrets from one address before it is told to wait: a terminal set to an old address, or a scanner. */
export const UNKNOWN_PER_ADDRESS = 30
const UNKNOWN_WINDOW_MS = 15 * 60_000

/**
 * One event a request, so a busy door is a few a minute. A terminal
 * catching up after a day offline sends hundreds, which this allows for.
 */
export const PER_TERMINAL_PER_MINUTE = 600

const answer = (status: number) => new Response(null, { status })

export async function receiveHikvision(req: Request, secret: string): Promise<Response> {
    let deviceId: string | null = null
    try {
        // Held like the agent's punches, and for the same reason: a scan
        // stored during a restore could be lost to it (review on #17).
        if ((await SystemSettingsService.get()).maintenanceMode) return answer(503)
        if (!isPushSecret(secret)) return answer(404)
        const terminal = await AttendanceTerminalPushService.bySecret(secret, "HIKVISION")
        if (!terminal) {
            // Counted after the look, not before: the terminals behind an
            // address still get through with their own secrets, and a guess
            // costs one indexed read either way.
            const { limited } = await RateLimiter.getLimitData(`terminal-unknown:${getClientIp(req.headers)}`, UNKNOWN_PER_ADDRESS, UNKNOWN_WINDOW_MS)
            return answer(limited ? 429 : 404)
        }
        deviceId = terminal.deviceId
        if (terminal.refused) return answer(403)
        const { limited } = await RateLimiter.getLimitData(`terminal:${terminal.deviceId}`, PER_TERMINAL_PER_MINUTE, 60_000)
        if (limited) return answer(429)
        // Its first contacts are kept for the Super Admin (§17.8, PR 294). A
        // body is read once, so a copy is taken first, only while one may
        // still be kept: past its first 7 days nothing is looked up. What
        // is kept is counted again when it is, with the terminal held.
        const counts = terminal.live && keepingFor(terminal.firstContactAt, new Date()) ? await TerminalFirstContactService.counts(terminal.deviceId) : null
        const copy = counts && roomFor(counts) ? req.clone() : null
        const events = await eventsOf(req)
        const taken = await AttendanceTerminalPushService.receive(terminal.deviceId, events, getClientIp(req.headers))
        if (copy) await keepContact(terminal.deviceId, copy, secret, events, taken.stored)
        return answer(200)
    } catch (error) {
        if (isNextInternalError(error)) throw error
        // The route by its pattern, never the address: the address is the secret.
        console.error("Terminal API error:", HIKVISION_ROUTE, error)
        await AuditLogService.logSystemError({ error, route: HIKVISION_ROUTE, method: req.method, extra: { deviceId } })
        return answer(500)
    }
}

/**
 * Keeps a request among its terminal's first contacts. Only one that was
 * taken is kept: one held is sent again until it is, and would fill the 50
 * with copies. Keeping never holds a terminal: the request is answered
 * whatever happens here, and a failure is recorded without the secret.
 */
async function keepContact(deviceId: string, copy: Request, secret: string, events: readonly TerminalEvent[] | null, stored: Parameters<typeof outcomeOf>[1]): Promise<void> {
    try {
        const { headers, others } = headersOf(copy.headers, secret)
        const { body, kind } = await bodyOf(copy, secret)
        await TerminalFirstContactService.keep(deviceId, { method: copy.method, path: HIKVISION_ROUTE, headers, otherHeaders: others, body, kind, outcome: outcomeOf(events, stored) })
    } catch (error) {
        if (isNextInternalError(error)) throw error
        console.error("Terminal first contact not kept:", HIKVISION_ROUTE, error)
        await AuditLogService.logSystemError({ error, route: HIKVISION_ROUTE, method: copy.method, extra: { deviceId, step: "first contact" } }).catch(() => {})
    }
}

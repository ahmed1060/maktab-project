import { NextRequest } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { ApiResponse } from "@/lib/api-response"
import { RateLimiter, getClientIp } from "@/lib/api-utils"
import { AuditLogService } from "@/lib/services/audit-log.service"
import { isNextInternalError } from "@/lib/next-internal-error"

// Client-side failures a server catch block never sees at all — a React
// render crash caught by an error boundary, or signIn() throwing on the
// login page before any session exists. Both call this so the same
// friendly-message + super-admin-log pattern used everywhere else in the
// app covers this class of failure too, instead of leaving it as a
// console.error only the developer's own browser ever shows.
//
// Deliberately reachable without a session (the login-page boundary has
// none to offer) — rate-limited by IP instead, same shape as every other
// unauthenticated endpoint in this app, so it can't be used to flood the
// audit log for free.
export async function POST(req: NextRequest) {
    try {
        const ip = getClientIp(req.headers)
        const { limited } = await RateLimiter.getLimitData(`client-error-log:${ip}`, 10, 5 * 60 * 1000)
        if (limited) {
            // Silently drop rather than surface a rate-limit error for a
            // best-effort diagnostic call the UI never blocks on.
            return ApiResponse.success({ ref: null })
        }

        const json = await req.json().catch(() => ({}))
        const message = typeof json?.message === 'string' ? json.message.slice(0, 1000) : 'Unknown client error'
        const stack = typeof json?.stack === 'string' ? json.stack.slice(0, 2000) : undefined
        const componentStack = typeof json?.componentStack === 'string' ? json.componentStack.slice(0, 2000) : undefined
        const route = typeof json?.route === 'string' ? json.route.slice(0, 300) : undefined
        // The Sentry event for the same failure, when Sentry is on — a
        // 32-character hex id, so the audit entry can point at it.
        const sentryId = typeof json?.sentryId === 'string' && /^[0-9a-f]{32}$/.test(json.sentryId) ? json.sentryId : undefined

        const session = await getServerSession(authOptions).catch((e) => {
            if (isNextInternalError(e)) throw e
            return null
        })
        const role = session && (session.user as any).role
        const userId = role && role !== 'SUPER_ADMIN' ? (session!.user as any).id : null
        const superAdminId = role === 'SUPER_ADMIN' ? (session!.user as any).id : null

        const ref = await AuditLogService.logSystemError({
            error: { message },
            route: route || 'client',
            method: 'CLIENT',
            userId,
            superAdminId,
            extra: { stack, componentStack, source: 'client', ...(sentryId && { sentryId }) }
        })

        return ApiResponse.success({ ref })
    } catch (error) {
        if (isNextInternalError(error)) throw error
        // This endpoint IS the fallback error-reporting path — if it fails
        // too, there's nowhere left to send the detail. Console only, and
        // never break the page that called this for a diagnostic ping.
        console.error('[log-client-error] failed to record client error:', error)
        return ApiResponse.success({ ref: null })
    }
}

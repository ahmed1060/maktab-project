import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { ApiResponse } from "./api-response"
import { AuditLogService } from "./services/audit-log.service"
import { isNextInternalError } from "./next-internal-error"

type HandlerOptions = {
    allowedRoles?: string[]
    audit?: {
        action: string
        entityType: string
        getEntityId?: (response: any, body: any) => string
    }
    rateLimit?: {
        maxRequests: number
        windowMs: number
    }
}

/**
 * F-10: extracts the real client IP rather than trusting the raw
 * x-forwarded-for header, which is a comma-separated list a client can
 * prepend fake entries to.
 *
 * x-vercel-forwarded-for is Vercel's own header carrying just the
 * connecting client's address — preferred when present. Otherwise, take
 * only the first hop of x-forwarded-for (the entry Vercel's edge itself
 * adds for the true client, before any upstream proxy) rather than the
 * whole header.
 */
export function getClientIp(headers: { get(name: string): string | null }): string {
    const vercelIp = headers.get('x-vercel-forwarded-for')
    if (vercelIp) return vercelIp.split(',')[0].trim()

    const forwardedFor = headers.get('x-forwarded-for')
    if (forwardedFor) return forwardedFor.split(',')[0].trim()

    return 'unknown'
}

/**
 * F-10: database-only rate limiter — no per-lambda memory cache.
 *
 * The old version checked an in-memory Map first and only touched the
 * database when that cache missed or expired. On Vercel that cache is
 * per-lambda-instance, not shared, so N warm lambdas each independently
 * allowed up to `limit` requests before any of them ever consulted the
 * database that's the only thing they actually share — a 5-attempt login
 * limit became effectively unbounded under concurrency. Every call here
 * hits the database now.
 *
 * The increment-then-check order also matters for the same reason: within
 * an active window, this does one atomic UPDATE ... SET count = count + 1
 * and only then checks whether the returned count exceeds the limit,
 * rather than reading the count, deciding, and writing separately (which
 * would let two simultaneous requests both read the same "count: 4" and
 * both decide they're under a limit of 5, letting 6 through). Postgres
 * serializes concurrent UPDATEs to the same row, so the increment itself
 * can't lose a count the way a read-decide-write sequence can.
 */
export class RateLimiter {
    static async getLimitData(key: string, limit: number, windowMs: number): Promise<{ limited: boolean; resetAt: number }> {
        const now = Date.now()

        try {
            const existing = await prisma.rateLimit.findUnique({ where: { key } })

            if (!existing || now > existing.resetAt.getTime()) {
                // New window. This create-or-reset step isn't perfectly atomic
                // against a simultaneous first request for a brand-new key —
                // the worst case there is two windows starting back to back,
                // not the count race the increment path below closes.
                const resetAt = new Date(now + windowMs)
                const record = await prisma.rateLimit.upsert({
                    where: { key },
                    update: { count: 1, resetAt },
                    create: { key, count: 1, resetAt }
                })
                return { limited: record.count > limit, resetAt: resetAt.getTime() }
            }

            const updated = await prisma.rateLimit.update({
                where: { key },
                data: { count: { increment: 1 } }
            })

            return { limited: updated.count > limit, resetAt: updated.resetAt.getTime() }
        } catch (e) {
            // F-10: fail CLOSED, not open. The old catch block reset the
            // counter to 1 and returned limited:false — meaning making the
            // database unhappy was itself a way to defeat the limiter.
            console.error("[RateLimiter] Database error — failing closed", e)
            return { limited: true, resetAt: now + windowMs }
        }
    }

    static async clear(key: string) {
        try {
            await prisma.rateLimit.delete({ where: { key } })
        } catch { }
    }

    static async clearByPrefix(prefix: string) {
        try {
            await prisma.rateLimit.deleteMany({
                where: { key: { startsWith: prefix } }
            })
        } catch { }
    }
}

export function withStandardHandler(
    handler: (req: Request, session: any, body?: any, context?: any) => Promise<NextResponse>,
    options: HandlerOptions = {}
) {
    return async (req: Request, context?: any) => {
        // Hoisted out of the try block so the catch below can still
        // attribute a system-error log entry to whoever was signed in,
        // even if the failure happened after these were set.
        let userId: string | null = null
        let userRole: string | undefined
        try {
            const session = await getServerSession(authOptions)
            if (!session) {
                return ApiResponse.unauthorized()
            }

            userRole = (session.user as any).role
            userId = (session.user as any).id

            // Rate Limiting
            if (options.rateLimit) {
                const ip = getClientIp(req.headers)
                const key = `${userId || ip}:${options.audit?.action || 'generic'}`
                const { limited, resetAt } = await RateLimiter.getLimitData(key, options.rateLimit.maxRequests, options.rateLimit.windowMs)
                if (limited) {
                    const timeStr = new Date(resetAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                    return ApiResponse.error(`Too many requests. Please try again at ${timeStr}.`, 429)
                }
            }

            // Role Check
            if (options.allowedRoles && !options.allowedRoles.includes(userRole as string)) {
                return ApiResponse.forbidden()
            }

            // --- PROACTIVE SUSPENSION CHECK ---
            // F-11: this used to run its own user.findUnique on every single
            // request — a second DB round trip on top of the jwt() callback's
            // session-revocation check, before the actual handler even
            // started. That callback now fetches status/company.isBanned in
            // the same throttled query it already runs for revocation and
            // stamps them on the session (see lib/auth.ts), so this reads
            // from the session instead of querying again. Undefined/false
            // for a SuperAdmin session, same as the old query returned for
            // an id with no matching User row.
            //
            // /api/user/activity itself is exempt from BOTH checks below —
            // not just maintenance. It's the one endpoint whose entire job is
            // telling a suspended/banned/maintenance-blocked browser what its
            // own status is (UserService.updateActivity does its own live
            // read and returns {status: 'SUSPENDED'|'COMPANY_BANNED'|...}).
            // Blocking it here with a 403 instead was a real bug: the
            // heartbeat's fetch got an error body it couldn't parse as
            // {data: {status}}, threw inside its own try/catch, and silently
            // gave up — so a suspended/banned user's browser could never
            // learn it was suspended, never triggered the emergency-save
            // event, and never signed itself out. It just sat on whatever
            // page was already loaded, indefinitely.
            const isHeartbeat = new URL(req.url).pathname === '/api/user/activity'
            const isSuspendedOrBanned = (session.user.userStatus === 'SUSPENDED' || session.user.companyBanned) && !isHeartbeat
            const isMaintenanceBlocked = !!session.user.maintenanceMode && session.user.role !== 'SUPER_ADMIN' && !isHeartbeat

            const isRestricted = isSuspendedOrBanned || isMaintenanceBlocked

            if (isRestricted) {
                const isEmergencySave = req.headers.get('x-emergency-save') === 'true'
                const isDraftUpload = req.method === 'PUT' && req.url.includes('/submit')

                // Allow ONLY a one-time draft save during suspension/maintenance
                if (!(isEmergencySave && isDraftUpload)) {
                    return ApiResponse.forbidden(isMaintenanceBlocked && !isSuspendedOrBanned ? "System is under maintenance" : "Account suspended or company banned")
                }
            }
            // -----------------------------------

            // Parse body if it exists (for POST/PATCH/PUT).
            // Only attempt this for JSON bodies — calling req.json() on a
            // multipart/form-data request consumes the body stream, which then
            // makes a later req.formData() call in the handler throw. Handlers
            // that need multipart data read it themselves via req.formData().
            let body: any = null
            const contentType = req.headers.get('content-type') || ''
            if (['POST', 'PATCH', 'PUT'].includes(req.method) && contentType.includes('application/json')) {
                try {
                    body = await req.json()
                } catch {
                    // Fallback for empty bodies or malformed JSON
                }
            }

            const response = await handler(req, session, body, context)

            // Audit Logging (only if successful and configured)
            if (options.audit && response.ok) {
                let entityId: string | null | undefined = options.audit.getEntityId ? undefined : null

                // If the handler returns a JSON with ID, we can try to extract it
                if (options.audit.getEntityId) {
                    try {
                        const resClone = response.clone()
                        const resData = await resClone.json()
                        const data = resData.success ? resData.data : resData
                        entityId = options.audit.getEntityId(data, body)
                    } catch { }
                }

                // --- Wave 16: Strict Sanitization ---
                const sanitizedBody = body ? { ...body } : null
                if (sanitizedBody) {
                    const sensitiveKeys = ['password', 'passcode', 'token', 'secret', 'plainPassword']
                    for (const key of sensitiveKeys) {
                        if (key in sanitizedBody) sanitizedBody[key] = '[REDACTED]'
                    }
                }

                await prisma.auditLog.create({
                    data: {
                        action: options.audit.action,
                        entityType: options.audit.entityType,
                        entityId: (entityId as unknown as string) || 'N/A',
                        userId: userRole !== 'SUPER_ADMIN' ? userId : null,
                        superAdminId: userRole === 'SUPER_ADMIN' ? userId : null,
                        details: sanitizedBody ?? undefined
                    }
                })
            }

            return response
        } catch (error: any) {
            if (isNextInternalError(error)) throw error
            console.error("API Standard Handler Error:", error)
            // Never echo the raw exception to the client — it can be a
            // Prisma/Supabase/network error with internal detail in it.
            // Log the real thing under a short reference code instead,
            // visible only on the super-admin-only audit log page, and
            // hand the client just that code.
            const ref = await AuditLogService.logSystemError({
                error,
                route: new URL(req.url).pathname,
                method: req.method,
                userId: userRole !== 'SUPER_ADMIN' ? userId : null,
                superAdminId: userRole === 'SUPER_ADMIN' ? userId : null,
            })
            return ApiResponse.error(AuditLogService.friendlyErrorMessage(ref))
        }
    }
}

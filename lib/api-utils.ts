import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { ApiResponse } from "./api-response"

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

// Simple in-memory rate limiter
export class RateLimiter {
    private static limits = new Map<string, { count: number; resetAt: number }>()

    static async getLimitData(key: string, limit: number, windowMs: number): Promise<{ limited: boolean; resetAt: number }> {
        const now = Date.now()

        // 1. Memory Check (Fastest)
        const entry = this.limits.get(key)
        if (entry && now <= entry.resetAt) {
            if (entry.count >= limit) return { limited: true, resetAt: entry.resetAt }
            entry.count++
            return { limited: false, resetAt: entry.resetAt }
        }

        // 2. Database Sync (Fallback for Serverless/Distributed)
        // If we are in Vercel/Production, we use the DB to synchronize across instances
        try {
            const dbLimit = await (prisma as any).rateLimit.findUnique({ where: { key } })

            if (!dbLimit || now > dbLimit.resetAt.getTime()) {
                const resetAt = new Date(now + windowMs)
                await (prisma as any).rateLimit.upsert({
                    where: { key },
                    update: { count: 1, resetAt },
                    create: { key, count: 1, resetAt }
                })
                this.limits.set(key, { count: 1, resetAt: resetAt.getTime() })
                return { limited: false, resetAt: resetAt.getTime() }
            }

            if (dbLimit.count >= limit) {
                return { limited: true, resetAt: dbLimit.resetAt.getTime() }
            }

            const updated = await (prisma as any).rateLimit.update({
                where: { key },
                data: { count: { increment: 1 } }
            })

            this.limits.set(key, { count: updated.count, resetAt: updated.resetAt.getTime() })
            return { limited: false, resetAt: updated.resetAt.getTime() }
        } catch (e) {
            console.error("[RateLimiter] DB sync failed, falling back to local memory", e)
            // Local fallback logic
            const resetAt = now + windowMs
            this.limits.set(key, { count: 1, resetAt })
            return { limited: false, resetAt }
        }
    }

    static async clear(key: string) {
        this.limits.delete(key)
        try {
            await (prisma as any).rateLimit.delete({ where: { key } }).catch(() => { })
        } catch { }
    }

    static async clearByPrefix(prefix: string) {
        // Clear Memory
        for (const key of this.limits.keys()) {
            if (key.startsWith(prefix)) {
                this.limits.delete(key)
            }
        }
        // Clear DB
        try {
            await (prisma as any).rateLimit.deleteMany({
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
        try {
            const session = await getServerSession(authOptions)
            if (!session) {
                return ApiResponse.unauthorized()
            }

            const userRole = (session.user as any).role
            const userId = (session.user as any).id

            // Rate Limiting
            if (options.rateLimit) {
                const ip = req.headers.get('x-forwarded-for') || 'unknown'
                const key = `${userId || ip}:${options.audit?.action || 'generic'}`
                const { limited, resetAt } = await RateLimiter.getLimitData(key, options.rateLimit.maxRequests, options.rateLimit.windowMs)
                if (limited) {
                    const timeStr = new Date(resetAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                    return ApiResponse.error(`Too many requests. Please try again at ${timeStr}.`, 429)
                }
            }

            // Role Check
            if (options.allowedRoles && !options.allowedRoles.includes(userRole)) {
                return ApiResponse.forbidden()
            }

            // --- PROACTIVE SUSPENSION CHECK ---
            const userStatus = await prisma.user.findUnique({
                where: { id: userId },
                select: { status: true, company: { select: { isBanned: true } } }
            })

            const isRestricted = userStatus?.status === 'SUSPENDED' || userStatus?.company?.isBanned

            if (isRestricted) {
                const isEmergencySave = req.headers.get('x-emergency-save') === 'true'
                const isDraftUpload = req.method === 'PUT' && req.url.includes('/submit')

                // Allow ONLY a one-time draft save during suspension
                if (!(isEmergencySave && isDraftUpload)) {
                    return ApiResponse.forbidden("Account suspended or company banned")
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
                        details: sanitizedBody ? JSON.stringify(sanitizedBody) : null
                    }
                })
            }

            return response
        } catch (error: any) {
            console.error("API Standard Handler Error:", error)
            return ApiResponse.error(error.message || "Internal Server Error")
        }
    }
}

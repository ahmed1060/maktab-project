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

            // Parse body if it exists (for POST/PATCH/PUT)
            let body: any = null
            if (['POST', 'PATCH', 'PUT'].includes(req.method)) {
                try {
                    body = await req.json()
                } catch {
                    // Fallback for empty bodies or non-JSON
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
                        // Extract from standardized structure if present
                        const data = resData.success ? resData.data : resData
                        entityId = options.audit.getEntityId(data, body)
                    } catch {
                        // Ignore if response is not JSON
                    }
                }

                await prisma.auditLog.create({
                    data: {
                        action: options.audit.action,
                        entityType: options.audit.entityType,
                        entityId: (entityId as unknown as string) || 'N/A',
                        userId: userRole !== 'SUPER_ADMIN' ? userId : null,
                        superAdminId: userRole === 'SUPER_ADMIN' ? userId : null,
                        details: body ? JSON.stringify(body) : null
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

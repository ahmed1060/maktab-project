import { randomBytes } from "crypto"
import { prisma } from "@/lib/prisma"

export interface AuditLogOptions {
    tx?: any
    userId?: string | null
    superAdminId?: string | null
    details?: any
}

export class AuditLogService {
    /**
     * A short, human-shareable reference for an unexpected/system error.
     * Doubles as the AuditLog entry's entityId, so a super admin can paste
     * it straight into the existing "Entity ID" filter on
     * /dashboard/audit-logs and land directly on the full detail — no new
     * search UI needed.
     */
    static genErrorRef(): string {
        return randomBytes(4).toString('hex').toUpperCase()
    }

    /**
     * Logs the real detail of an unexpected failure (message, stack,
     * route, whoever was signed in) under a short reference code, and
     * returns that code so the caller can hand the user a safe, generic
     * message that still carries something concrete to report — see
     * friendlyErrorMessage(). Never throws itself: a failure here must
     * never mask the original error or break the response it's guarding.
     */
    static async logSystemError(params: {
        error: unknown
        route: string
        method?: string
        userId?: string | null
        superAdminId?: string | null
        extra?: Record<string, any>
    }): Promise<string> {
        const ref = this.genErrorRef()
        try {
            const err = params.error as any
            await this.log('SYSTEM_API_ERROR', 'SYSTEM', ref, {
                userId: params.userId || null,
                superAdminId: params.superAdminId || null,
                details: {
                    route: params.route,
                    method: params.method,
                    message: err?.message ?? String(err),
                    stack: typeof err?.stack === 'string' ? err.stack.slice(0, 2000) : undefined,
                    ...params.extra
                }
            })
        } catch (logError) {
            console.error('[AuditLogService] Failed to log system error', logError)
        }
        return ref
    }

    /** The one piece of UI text every "unexpected error" surface in the
     *  app should show — never the raw exception. */
    static friendlyErrorMessage(ref: string): string {
        return `We couldn't complete that action. Please try again — if it keeps happening, share this reference with your admin: ${ref}`
    }

    static async log(action: string, entityType: string, entityId: string, options: AuditLogOptions = {}) {
        const prismaClient = options.tx || prisma
        return await prismaClient.auditLog.create({
            data: {
                action,
                entityType,
                entityId,
                userId: options.userId || null,
                superAdminId: options.superAdminId || null,
                details: options.details ?? undefined
            }
        })
    }

    static async getMany(skip: number, limit: number, filters: {
        entityType?: string,
        action?: string,
        companyId?: string,
        startDate?: string,
        endDate?: string,
        entityId?: string,
        performedById?: string
    } = {}) {
        const where: any = {}

        if (filters.entityType) where.entityType = filters.entityType

        if (filters.action) {
            // If it's a generic action (like CREATE, UPDATE, DELETE), use startsWith
            if (['CREATE', 'UPDATE', 'DELETE', 'SYSTEM'].includes(filters.action)) {
                where.action = { startsWith: `${filters.action}_` }
            } else {
                where.action = filters.action
            }
        }

        if (filters.entityId) where.entityId = filters.entityId

        if (filters.performedById) {
            where.OR = [
                { userId: filters.performedById },
                { superAdminId: filters.performedById }
            ]
        }

        if (filters.startDate || filters.endDate) {
            where.createdAt = {}
            if (filters.startDate) where.createdAt.gte = new Date(filters.startDate)
            if (filters.endDate) where.createdAt.lte = new Date(filters.endDate)
        }

        if (filters.companyId) {
            where.user = { companyId: filters.companyId }
        }

        const [logs, total] = await Promise.all([
            prisma.auditLog.findMany({
                where,
                skip,
                take: limit,
                orderBy: { createdAt: 'desc' },
                include: {
                    user: {
                        select: {
                            firstName: true,
                            lastName: true,
                            email: true,
                            role: true
                        }
                    },
                    superAdmin: {
                        select: {
                            firstName: true,
                            lastName: true,
                            email: true
                        }
                    }
                }
            }),
            prisma.auditLog.count({ where })
        ])

        return {
            logs,
            total
        }
    }
}

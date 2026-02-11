import { prisma } from "@/lib/prisma"

export interface AuditLogOptions {
    tx?: any
    userId?: string | null
    superAdminId?: string | null
    details?: any
}

export class AuditLogService {
    static async log(action: string, entityType: string, entityId: string, options: AuditLogOptions = {}) {
        const prismaClient = options.tx || prisma
        return await prismaClient.auditLog.create({
            data: {
                action,
                entityType,
                entityId,
                userId: options.userId || null,
                superAdminId: options.superAdminId || null,
                details: options.details ? JSON.stringify(options.details) : null
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

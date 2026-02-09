import { prisma } from "@/lib/prisma"

export class AuditLogService {
    static async getMany(skip: number, limit: number, filters: { entityType?: string, action?: string, userId?: string } = {}) {
        const where: any = {}

        if (filters.entityType) where.entityType = filters.entityType
        if (filters.action) where.action = filters.action
        if (filters.userId) {
            where.OR = [
                { userId: filters.userId },
                { superAdminId: filters.userId }
            ]
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

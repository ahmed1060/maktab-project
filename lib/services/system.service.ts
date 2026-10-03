import { prisma } from "@/lib/prisma"
import { NotificationService } from "./notification.service"
import { can, type Actor } from "@/lib/permissions/can"

export class SystemService {
    static async getBootstrapData(viewer: Actor & { id: string }) {
        const userId = viewer.id
        const role = viewer.role as string
        const [user, unreadNotificationsCount] = await Promise.all([
            prisma.user.findUnique({
                where: { id: userId },
                select: {
                    id: true,
                    firstName: true,
                    lastName: true,
                    email: true,
                    role: true,
                    avatar: true,
                    gender: true,
                    language: true,
                    companyId: true
                }
            }),
            // Matches either recipient column: a Super Admin's id lives in the
            // SuperAdmin table, so a userId-only count was structurally always 0
            // for them — the bell showed no badge no matter what was waiting.
            prisma.notification.count({
                where: { ...NotificationService.recipientFilter(userId), read: false }
            })
        ])

        if (!user) {
            // Check if it's a super admin
            const superAdmin = await prisma.superAdmin.findUnique({
                where: { id: userId },
                select: {
                    id: true,
                    firstName: true,
                    lastName: true,
                    email: true,
                    avatar: true,
                    gender: true,
                }
            })
            if (superAdmin) {
                const companies = await prisma.company.findMany({
                    orderBy: { name: 'asc' },
                    select: { id: true, name: true }
                })
                const pendingProfileRequestsCount = await prisma.profileUpdateRequest.count({
                    where: { status: 'PENDING' }
                })
                return {
                    user: { ...superAdmin, role: 'SUPER_ADMIN', language: 'en' },
                    companies,
                    counts: {
                        unreadNotifications: unreadNotificationsCount,
                        pendingProfileRequests: pendingProfileRequestsCount
                    }
                }
            }
            throw new Error("USER_NOT_FOUND")
        }

        let companies: any[] = []
        let pendingProfileRequestsCount = 0

        const extraTasks = []
        if (role === 'SUPER_ADMIN') {
            extraTasks.push(
                prisma.company.findMany({
                    orderBy: { name: 'asc' },
                    select: { id: true, name: true }
                }).then(res => companies = res)
            )
        }

        // The header's name-change badge: for whoever decides them, and only
        // their own company's. It counted every company's pending requests,
        // so an Admin's badge carried other companies' numbers.
        if (can(viewer, "profile_requests.review")) {
            extraTasks.push(
                prisma.profileUpdateRequest.count({
                    where: { status: 'PENDING', user: { companyId: user.companyId } }
                }).then(res => pendingProfileRequestsCount = res)
            )
        }

        if (extraTasks.length > 0) await Promise.all(extraTasks)

        return {
            user,
            companies,
            counts: {
                unreadNotifications: unreadNotificationsCount,
                pendingProfileRequests: pendingProfileRequestsCount
            }
        }
    }

    static async getHealthMetrics() {
        const now = new Date()
        const last24h = new Date(now.getTime() - 24 * 60 * 60 * 1000)

        const [
            failedLogins,
            blockedIps,
            totalUsers,
            suspendedUsers,
            totalAuditLogs,
            totalNotifications,
            totalTasks,
            totalObligations,
            lastHourLogs
        ] = await Promise.all([
            prisma.auditLog.count({
                where: { action: 'LOGIN_FAILURE', createdAt: { gt: last24h } }
            }),
            prisma.auditLog.groupBy({
                by: ['entityId'],
                where: { action: 'ADMIN_UNBLOCK_RATE_LIMIT', createdAt: { gt: last24h } },
                _count: { entityId: true },
                orderBy: { _count: { entityId: 'desc' } },
                take: 5
            }),
            prisma.user.count({ where: { status: { not: 'DELETED' } } }),
            prisma.user.count({ where: { status: 'SUSPENDED' } }),
            prisma.auditLog.count(),
            prisma.notification.count(),
            prisma.task.count(),
            prisma.obligation.count(),
            prisma.auditLog.count({
                where: { createdAt: { gt: new Date(now.getTime() - 60 * 60 * 1000) } }
            })
        ])

        // Fetch storage asset count estimate (limited for speed, just to see if it's healthy)
        const { supabase } = await import("@/lib/storage")
        const { data: files } = await supabase.storage.from('app-assets').list('', { limit: 1 })
        const hasAssets = files && files.length > 0

        return {
            security: {
                failedLogins24h: failedLogins,
                topBlockedIps: blockedIps.map(item => ({ ip: item.entityId, count: item._count.entityId })),
                lastHourActivity: lastHourLogs
            },
            usage: {
                totalUsers,
                suspendedUsers,
                activeUsers: totalUsers - suspendedUsers,
                totalTasks,
                totalObligations
            },
            database: {
                totalAuditLogs,
                totalNotifications,
                estimatedRowcount: totalAuditLogs + totalNotifications + totalTasks + totalObligations + totalUsers,
                status: 'HEALTHY'
            },
            storage: {
                hasAppAssets: hasAssets,
                bucket: 'app-assets'
            },
            timestamp: now.toISOString()
        }
    }
}

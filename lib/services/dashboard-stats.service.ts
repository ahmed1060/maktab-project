import { unstable_cache } from "next/cache"
import { prisma } from "@/lib/prisma"

/**
 * Super Admin's system-wide overview counts (dashboard home). Cached
 * because it's the same read for every super admin regardless of who's
 * looking — unlike the Admin/Team Leader and Employee dashboard views,
 * which are scoped to one company/user and which people expect to reflect
 * their own just-taken action immediately, so those stay uncached.
 *
 * 30s revalidate: cheap enough that repeat page loads inside that window
 * (a super admin bouncing between dashboard and another page, or just
 * refreshing) reuse one query instead of re-running all 8, without the
 * numbers ever visibly lagging by more than half a minute.
 *
 * The date boundaries are computed inside the cached function itself, not
 * passed in as arguments — unstable_cache derives part of its cache key
 * from the function's arguments, so an ever-changing timestamp argument
 * would bust the cache on every single call and defeat the point.
 */
export const getSuperAdminOverviewStats = unstable_cache(
    async () => {
        const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000)
        const fourteenDaysFromNow = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000)

        const [totalCompanies, totalUsers, totalTasks, totalClients, taskStats, systemErrors24h, expiringSubscriptions, bannedCompanies] = await Promise.all([
            prisma.company.count(),
            prisma.user.count(),
            prisma.task.count(),
            prisma.businessClient.count(),
            prisma.task.groupBy({ by: ['status'], _count: true }),
            prisma.auditLog.count({
                where: { action: 'SYSTEM_API_ERROR', createdAt: { gte: oneDayAgo } }
            }),
            prisma.companyPayment.count({
                where: { status: 'PAID', endDate: { gt: new Date(), lte: fourteenDaysFromNow } }
            }),
            prisma.company.count({ where: { isBanned: true } })
        ])

        return { totalCompanies, totalUsers, totalTasks, totalClients, taskStats, systemErrors24h, expiringSubscriptions, bannedCompanies }
    },
    ['dashboard-super-admin-overview'],
    { revalidate: 30 }
)

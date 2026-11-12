import { prisma } from "@/lib/prisma"
import { needsAttention } from "@/lib/billing/state"

/**
 * Super Admin's system-wide overview counts (dashboard home), read fresh
 * every time the page is opened (PR 268; TROUBLESHOOTING.md).
 *
 * They were cached for 30 seconds, with unstable_cache. Stale, it served
 * the old counts and read them again in the background, after the page was
 * sent. The home page sits behind loading.tsx, so Next.js had already sent
 * its first part, and handed what was pending to waitUntil, before this was
 * read: the background read was never waited for. Vercel froze the function
 * mid-handshake with the database, and the error came on the next page that
 * woke it. Eight counts on a handful of rows don't need a cache.
 *
 * One batch transaction: one connection, where eight queries at once took
 * up to five on a cold function, each with its own handshake; and one
 * snapshot, so the figures agree with each other.
 */
export async function getSuperAdminOverviewStats() {
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000)

    const [totalCompanies, totalUsers, totalTasks, totalClients, taskStats, systemErrors24h, companiesForAttention, bannedCompanies] = await prisma.$transaction([
        prisma.company.count(),
        prisma.user.count(),
        prisma.task.count(),
        // The businesses companies work for: clients (CLIENTS_PLAN.md
        // §0.1). The old Clients section's own list is gone; its records
        // are on each client now (§0.2).
        prisma.client.count(),
        prisma.task.groupBy({ by: ['status'], _count: true }),
        prisma.auditLog.count({
            where: { action: 'SYSTEM_API_ERROR', createdAt: { gte: oneDayAgo } }
        }),
        // Every company with its facts, counted through needsAttention()
        // rather than by a query. The predicate is the same one the
        // companies-list filter uses, so the tile and the list can never
        // disagree — which the old query could not promise: it required a
        // PAID payment row, so a trial running out next week appeared here
        // nowhere at all, and its 14 was a second, independent 14.
        prisma.company.findMany({
            select: {
                createdAt: true,
                trialPreset: true,
                trialExtensionDays: true,
                payments: {
                    where: { status: 'PAID' },
                    orderBy: { endDate: 'desc' },
                    take: 1,
                    select: { endDate: true, graceExtensionHours: true },
                },
                _count: { select: { payments: { where: { status: 'UNPAID' } } } },
            },
        }),
        prisma.company.count({ where: { isBanned: true } })
    ])

    const now = new Date()
    const expiringSubscriptions = companiesForAttention.filter(company => needsAttention({
        createdAt: company.createdAt,
        trialPreset: company.trialPreset,
        trialExtensionDays: company.trialExtensionDays,
        latestPaidPeriod: company.payments[0] ?? null,
        hasUnpaidPayment: company._count.payments > 0,
    }, now)).length

    return { totalCompanies, totalUsers, totalTasks, totalClients, taskStats, systemErrors24h, expiringSubscriptions, bannedCompanies }
}

import { prisma } from "@/lib/prisma"
import { isModule, type Module } from "@/lib/features"

/**
 * Recording how often a company reaches for a module it does not have.
 *
 * The signal is free: because a locked module stays visible, every attempt
 * already arrives at the server as a request. Nothing client-side is added.
 */
export class FeatureAccessService {
    /** First instant of the month, UTC — the bucket a timestamp falls in. */
    static monthBucket(now: Date = new Date()): Date {
        return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
    }

    /**
     * Count one attempt. Deliberately fire-and-forget at the call site: a
     * failure to record a sales signal must never turn into a failed request
     * for the user, who is already being told they cannot do the thing.
     */
    static async recordAttempt(companyId: string | null | undefined, module: Module, now: Date = new Date()) {
        if (!companyId) return
        if (!isModule(module)) return

        const month = FeatureAccessService.monthBucket(now)

        try {
            // Upsert against the unique key, so two simultaneous attempts race
            // to insert and the loser increments instead of failing.
            await prisma.lockedModuleAttempt.upsert({
                where: { companyId_module_month: { companyId, module, month } },
                create: { companyId, module, month, count: 1 },
                update: { count: { increment: 1 } },
            })
        } catch (error) {
            console.error('[features] failed to record locked-module attempt', { companyId, module, error })
        }
    }

    /**
     * The tally, for the Super Admin who wants to know what to sell.
     * Newest month first, largest count first within a month.
     */
    static async getAttempts({ companyId, months = 6 }: { companyId?: string; months?: number } = {}) {
        const since = new Date()
        since.setUTCMonth(since.getUTCMonth() - (months - 1))

        return prisma.lockedModuleAttempt.findMany({
            where: {
                month: { gte: FeatureAccessService.monthBucket(since) },
                ...(companyId ? { companyId } : {}),
            },
            orderBy: [{ month: 'desc' }, { count: 'desc' }],
            include: { company: { select: { id: true, name: true } } },
        })
    }
}

import { prisma } from "@/lib/prisma"
import { isModule, type Module } from "@/lib/features"
import { startOfMonthIn } from "@/lib/time"

/**
 * Recording how often a company reaches for a module it does not have.
 *
 * Counted where a module's page is opened by its address (lib/features/guard.tsx):
 * it isn't in the side bar any more (DESIGN.md §5.1), so this is somebody who
 * typed or kept the address, and the count is smaller than when a locked entry
 * there led to it. Nothing client-side is added.
 */
export class FeatureAccessService {
    /**
     * First instant of the month the timestamp falls in — the bucket it counts
     * against.
     *
     * Local, not UTC. This was the one site already consistent with itself,
     * which is why the plan first listed it as already right; but "usage this
     * month" is a calendar question, and answering it in UTC would reset a
     * company's allowance two or three hours after their month actually turned
     * over. Leaving one site on a different clock is the condition P0 exists to
     * remove, not an exception to it.
     */
    static monthBucket(now: Date = new Date()): Date {
        return startOfMonthIn(now)
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

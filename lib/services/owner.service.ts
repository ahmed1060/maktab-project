import { prisma } from "@/lib/prisma"
import { calendarDateStr } from "@/lib/time"
import { startOfDate } from "@/lib/contract-start"
import { monthsReached, monthsSpanned, ownerIn, ownerSince, planOwner } from "@/lib/owners"
import type { Prisma } from "@prisma/client"
import { lockMonths, lockPersonDates, lockedMonths } from "./attendance-lock"

/**
 * Owners (LATER_CHANGES_PLAN.md §7.3, step 3a, PR 426): whether someone is
 * one now, and marking them, or taking it off, from the start of this month
 * in their company's calendar, as lib/owners.ts works it out.
 */

/** Work still open that marking someone an owner waits on, to be moved first. */
export type OpenWork = { kind: "task" | "obligation"; id: string; title: string }

/** A refusal, with its code as the message, and the work it names where it's open work. */
export class OwnerRefused extends Error {
    constructor(code: string, readonly work: OpenWork[] = []) {
        super(code)
    }
}

// Not yet finished: work done but not reviewed is still theirs to answer for.
const OPEN_TASK = ["PENDING", "IN_PROGRESS", "PENDING_CONFIRMATION"] as const
const OPEN_OBLIGATION = ["PENDING", "IN_PROGRESS", "PENDING_CONFIRMATION"]

/**
 * Refuses what's asked for days in a month they're an owner in
 * (LATER_CHANGES_PLAN.md §7.3, step 3b1, PR 427): a day off, a permission,
 * a mission or a missing punch. An owner has no attendance, so nothing to
 * ask for. Read under the request's own lock, on the person's dates or the
 * months, which marking an owner takes too, so the two can't cross.
 */
export async function refuseOwnerMonths(tx: Prisma.TransactionClient, userId: string, from: string, to: string = from) {
    const periods = await tx.ownerPeriod.findMany({ where: { userId }, select: { id: true, startsAt: true, endsAt: true } })
    if (monthsSpanned(from, to).some(month => ownerIn(periods, month))) throw new Error("OWNER_NO_ATTENDANCE")
}

export class OwnerService {
    /** Since which month they're an owner now, in their company's calendar; null for none. */
    static async of(userId: string): Promise<{ since: string } | null> {
        const person = await prisma.user.findUnique({
            where: { id: userId },
            select: { company: { select: { id: true } }, ownerPeriods: { select: { id: true, startsAt: true, endsAt: true } } },
        })
        if (!person?.company) return null
        const since = ownerSince(person.ownerPeriods)
        return since ? { since } : null
    }

    /**
     * Marks someone an owner, or takes it off, from the start of this month.
     * Refused, with its code as the error's message: someone not in a company
     * (NO_COMPANY); the payroll of this month or a later one approved or
     * paid (PAYROLL_MONTH_LOCKED); a final settlement for this month or a
     * later one (OWNER_SETTLED);
     * what they are already (ALREADY_OWNER, NOT_OWNER); work still open,
     * named (OWNER_OPEN_WORK), when marking.
     *
     * Who may ask is the route's to check. Their days are worked out again
     * from this month once it's written: none while they're an owner.
     */
    static async set(userId: string, owner: boolean, by: { userId: string | null; superAdminId: string | null }): Promise<{ owner: boolean; month: string }> {
        const person = await prisma.user.findUnique({ where: { id: userId }, select: { companyId: true, company: { select: { timezone: true } } } })
        if (!person?.companyId || !person.company) throw new OwnerRefused("NO_COMPANY")
        const { companyId } = person
        const zone = person.company.timezone
        const month = calendarDateStr(new Date(), zone).slice(0, 7)
        const monthStart = startOfDate(`${month}-01`, zone)

        await prisma.$transaction(async tx => {
            // One change to a person's dates at a time. It reaches every month
            // from this one on, so it waits on each of those months' payroll
            // approval, and an approved or paid one refuses it.
            await lockPersonDates(tx, userId)
            const last = await tx.payrollRun.findFirst({ where: { companyId }, orderBy: [{ year: "desc" }, { month: "desc" }], select: { year: true, month: true } })
            const months = monthsReached(month, last ? `${last.year}-${String(last.month).padStart(2, "0")}` : null)
            await lockMonths(tx, companyId, months)
            if ((await lockedMonths(tx, companyId, months)).size > 0) throw new OwnerRefused("PAYROLL_MONTH_LOCKED")
            // A contract ended with a final settlement in a month the change
            // reaches was settled as they were then: the change would leave
            // the settlement, and any debt it made, wrong.
            if (await tx.finalSettlement.findFirst({ where: { userId, lastWorkingDay: { gte: monthStart } }, select: { id: true } })) throw new OwnerRefused("OWNER_SETTLED")
            const periods = await tx.ownerPeriod.findMany({ where: { userId }, select: { id: true, startsAt: true, endsAt: true } })
            const plan = planOwner(periods, month, owner)
            if (!plan.ok) throw new OwnerRefused(plan.refusal)

            if (owner) {
                // An owner is given no work: theirs still open is moved first; finished, it stays in their history.
                const tasks = await tx.task.findMany({ where: { status: { in: [...OPEN_TASK] }, assignees: { some: { id: userId } } }, select: { id: true, title: true }, orderBy: { createdAt: "asc" } })
                const obligations = await tx.obligation.findMany({ where: { status: { in: OPEN_OBLIGATION }, assignees: { some: { id: userId } } }, select: { id: true, title: true }, orderBy: { createdAt: "asc" } })
                const work: OpenWork[] = [
                    ...tasks.map(t => ({ kind: "task" as const, id: t.id, title: t.title })),
                    ...obligations.map(o => ({ kind: "obligation" as const, id: o.id, title: o.title })),
                ]
                if (work.length > 0) throw new OwnerRefused("OWNER_OPEN_WORK", work)
            }

            if (plan.action === "create") await tx.ownerPeriod.create({ data: { userId, startsAt: monthStart, createdById: by.userId } })
            else if (plan.action === "reopen") await tx.ownerPeriod.update({ where: { id: plan.id }, data: { endsAt: null } })
            else if (plan.action === "close") await tx.ownerPeriod.update({ where: { id: plan.id }, data: { endsAt: monthStart } })
            else await tx.ownerPeriod.delete({ where: { id: plan.id } })

            const { AuditLogService } = await import("./audit-log.service")
            await AuditLogService.log(owner ? "OWNER_MARKED" : "OWNER_UNMARKED", "USER", userId, {
                userId: by.userId, superAdminId: by.superAdminId, tx, details: { month },
            })
        })

        // Never undoing the change: the nightly run works out this month and last again.
        try {
            const { recomputeForPersonFrom } = await import("./attendance-recompute")
            await recomputeForPersonFrom(userId, monthStart)
        } catch (error) {
            console.error("[owners] recompute after a change failed", userId, error)
        }
        return { owner, month }
    }
}

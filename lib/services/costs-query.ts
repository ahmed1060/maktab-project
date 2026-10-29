import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { grantFor, type Actor } from "@/lib/permissions/can"
import { assignedToTeamWhere } from "@/lib/team-scope"
import { dayRangeIn } from "@/lib/services/filter-zone"
import { placeFilters } from "@/lib/place-filters"
import { createHash } from "node:crypto"
import { dueParts, namedParts, partsLine } from "@/lib/costs-total"
import { costNamed, withCostNamed, type FilterName } from "@/lib/saved-lists"
import { ListService } from "@/lib/services/list.service"

/**
 * A task in which this member's share of the cost is still to pay: more than
 * nothing, and not marked paid (`shareOwed` in lib/cost-shares.ts). A share
 * with no status is unpaid, and is asked for apart: to Postgres a missing
 * key is no value at all, which "not paid" alone leaves out.
 */
export const unpaidShareOf = (userId: string) => ({
    AND: [
        { memberCosts: { path: [userId], gt: 0 } },
        {
            OR: [
                { memberPaymentStatus: { path: [userId], not: "PAID" } },
                { memberPaymentStatus: { path: [userId], equals: Prisma.DbNull } },
            ],
        },
    ],
})

/** The Costs page's filters, as its address carries them. */
export type CostFilters = {
    /** A Super Admin's chosen company, by name (`?company=`). */
    company?: string
    employeeId?: string
    search?: string
    dateFrom?: string
    dateTo?: string
    /** A client's tasks, or "none" for those with no client (CLIENTS_PLAN.md §3). */
    clientId?: string
    /** The tasks done at one location. */
    locationId?: string
    /**
     * The tasks with a cost of one saved name (CLIENTS_PLAN.md §5.9), and
     * what those costs come to. Mark all as paid isn't offered with it: a
     * payment is a person's share of a task, not one of its costs.
     */
    costNameId?: string
}

/**
 * The company whose costs these are: the payer's own, or a Super Admin's
 * chosen one, or every company (null) for a Super Admin who chose none.
 * Undefined when there's nothing to list: no company, or a name that's none.
 */
async function companyInView(user: Actor & { id: string }, filters: CostFilters): Promise<string | null | undefined> {
    if (user.role === "SUPER_ADMIN") {
        if (!filters.company) return null
        const company = await prisma.company.findUnique({ where: { name: filters.company }, select: { id: true } })
        return company ? company.id : undefined
    }
    return user.companyId ?? undefined
}

/** The saved cost name `costNameId` picks, in the company in view; null for one that's none there. */
export async function costNameOf(user: Actor & { id: string }, filters: CostFilters): Promise<FilterName | null> {
    if (!filters.costNameId) return null
    const companyId = await companyInView(user, filters)
    if (companyId === undefined) return null
    return ListService.filterName("COST_NAME", filters.costNameId, companyId)
}

/**
 * Which costs wait to be paid, for the Costs page and for its "Mark all as
 * paid" (POST /api/tasks/payment/bulk).
 *
 * One query for both, so the button pays the list shown and nothing else. The
 * route built its own, and for a Super Admin it had no company in it: the page
 * listed the chosen company's costs, and the button paid every company's.
 *
 * The company is the payer's own, or a Super Admin's chosen one. A name that
 * matches no company is nothing, not every company. Null means there's
 * nothing to list or pay.
 */
export async function pendingCostsWhere(
    user: Actor & { id: string },
    filters: CostFilters,
): Promise<{ AND: any[] } | null> {
    const companyId = await companyInView(user, filters)
    if (companyId === undefined) return null

    const where = {
        AND: [
            { OR: [{ status: "APPROVED" }, { status: "COMPLETED" }, { status: "REJECTED" }] },
            { totalCost: { gt: 0 } },
            { paymentStatus: "PENDING_PAYMENT" },
        ] as any[],
    }
    if (companyId) where.AND.push({ assignees: { some: { companyId } } })

    // A Team Leader pays their team's tasks — tasks.pay at TEAM scope, the rule
    // every single-task payment route applies through verifyResourceAccess.
    if (grantFor(user, "tasks.pay") === "TEAM") where.AND.push(assignedToTeamWhere(user.id))

    // One employee's costs are their shares still to pay, as their cards
    // show, and Mark all as paid pays those, not the rest of each task.
    if (filters.employeeId) where.AND.push({ assignees: { some: { id: filters.employeeId } } }, unpaidShareOf(filters.employeeId))
    if (filters.search) where.AND.push({ title: { contains: filters.search, mode: "insensitive" } })
    // Days where the company is, not on the server's clock.
    const updatedAt = await dayRangeIn(filters.dateFrom, filters.dateTo, companyId)
    if (updatedAt) where.AND.push({ updatedAt })
    // So Mark all as paid pays only the client's, or the location's, shown.
    where.AND.push(...placeFilters(filters.clientId, filters.locationId))
    // With a cost of the name still due, picked as it or typed the same (§5.9).
    if (filters.costNameId) where.AND.push(await namedDue(where, await ListService.filterName("COST_NAME", filters.costNameId, companyId), filters.employeeId))

    return where
}

/**
 * Of a list's tasks, those with a cost of the name still due, as the Costs
 * page's cards show them (namedParts), so it counts and pages only those. A
 * task whose costs of it are all in shares paid already, or with an
 * employee picked, all someone else's, has none. Whose share each cost is in
 * is in the task's JSON, by person, which a Prisma filter can't match to
 * each cost's author.
 */
async function namedDue(where: { AND: any[] }, name: FilterName | null, employeeId?: string) {
    if (!name) return withCostNamed(null)
    const tasks = await prisma.task.findMany({
        where: { AND: [...where.AND, withCostNamed(name)] },
        select: { id: true, memberCosts: true, memberPaymentStatus: true, costs: { where: costNamed(name), select: { authorId: true, amount: true } } },
    })
    return { id: { in: [...new Set(namedParts(tasks, employeeId).map(p => p.taskId))] } }
}

/**
 * What the Costs page's list owes, as "Mark all as paid" confirms it
 * (CLIENTS_PLAN.md §4.1): how many parts are due, what they come to, the
 * tasks they're on, and a digest of exactly those parts. The button sends
 * the digest back; it pays only if the list still comes to the same.
 */
export async function pendingCostsSnapshot(where: { AND: any[] }, employeeId?: string | null, db: { task: { findMany: (args: any) => Promise<any[]> } } = prisma) {
    const tasks = await db.task.findMany({ where, select: { id: true, totalCost: true, memberCosts: true, memberPaymentStatus: true } })
    return snapshotOf(tasks, employeeId)
}

/** With an employee picked, their shares only, as Mark all as paid pays then. */
export function snapshotOf(tasks: { id: string; totalCost: unknown; memberCosts: unknown; memberPaymentStatus: unknown }[], employeeId?: string | null) {
    const rows = tasks.map(t => ({ ...t, totalCost: Number(t.totalCost) }))
    const parts = dueParts(rows, employeeId)
    return {
        count: parts.length,
        // To the piastre, as the parts are.
        amount: Math.round(parts.reduce((sum, p) => sum + p.amount, 0) * 100) / 100,
        taskIds: [...new Set(parts.map(p => p.taskId))],
        digest: createHash("sha256").update(partsLine(parts)).digest("hex"),
        rows,
    }
}

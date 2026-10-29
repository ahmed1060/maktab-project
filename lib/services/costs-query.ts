import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { grantFor, type Actor } from "@/lib/permissions/can"
import { assignedToTeamWhere } from "@/lib/team-scope"
import { dayRangeIn } from "@/lib/services/filter-zone"
import { placeFilters } from "@/lib/place-filters"

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
    let companyId: string | null = null
    if (user.role === "SUPER_ADMIN") {
        if (filters.company) {
            const company = await prisma.company.findUnique({ where: { name: filters.company }, select: { id: true } })
            if (!company) return null
            companyId = company.id
        }
    } else {
        if (!user.companyId) return null
        companyId = user.companyId
    }

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

    return where
}

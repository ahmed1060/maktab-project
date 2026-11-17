import { prisma } from "@/lib/prisma"
import { can, type Actor } from "@/lib/permissions/can"
import { filterTimeZone } from "@/lib/services/filter-zone"
import { calendarDateStr } from "@/lib/time"
import { cents } from "@/lib/task-costs"
import type { Paging } from "@/lib/pagination"
import { daysLate, type TaxPosition } from "@/lib/tax-claims"

/** A date column's day, as it was written. */
const dayOf = (date: Date) => date.toISOString().slice(0, 10)

/**
 * A client's tax position, for the company's people (CLIENT_PORTAL_PLAN.md
 * §3.5): the day its figures are from and who uploaded the portal's file,
 * what all its open claims come to, and a page of them, the longest overdue
 * first.
 *
 * Late is counted here, in the days of the client's own company (§3.4), so
 * every screen agrees, wherever its reader is. Read from the client's own
 * company, so a Super Admin gets any client's; another company's reads as
 * not there, whatever the address says.
 */
export async function taxPositionOf(user: Actor, clientId: string | null | undefined, paging: Paging, now: Date = new Date()): Promise<TaxPosition> {
    if (!clientId) throw new Error("TAX_CLIENT_REQUIRED")
    if (!can(user, "tax.view")) throw new Error("TAX_VIEW_REQUIRED")
    const client = await prisma.client.findUnique({ where: { id: clientId }, select: { id: true, name: true, companyId: true, archivedAt: true } })
    if (!client || (user.role !== "SUPER_ADMIN" && client.companyId !== user.companyId)) throw new Error("CLIENT_NOT_FOUND")

    const timeZone = await filterTimeZone(client.companyId)
    const today = calendarDateStr(now, timeZone)
    const its = { clientId: client.id }
    // Its last day to pay has passed. Every claim kept has something left to pay (§3.2).
    const late = { ...its, dueDate: { lt: new Date(`${today}T00:00:00Z`) } }

    const [position, rows, sums, lateCount] = await Promise.all([
        prisma.clientTaxPosition.findUnique({ where: { clientId: client.id }, select: { asOf: true, uploadedAt: true, uploadedByName: true } }),
        prisma.taxClaim.findMany({
            where: its,
            select: {
                id: true, claimNumber: true, item: true, taxType: true, registrationType: true, originalAmount: true, paidAmount: true, remainingAmount: true,
                currency: true, status: true, periodStart: true, periodEnd: true, dueDate: true,
            },
            orderBy: [{ dueDate: "asc" }, { claimNumber: "asc" }, { id: "asc" }],
            skip: paging.skip,
            take: paging.limit,
        }),
        prisma.taxClaim.aggregate({ where: its, _sum: { originalAmount: true, paidAmount: true, remainingAmount: true }, _count: true }),
        prisma.taxClaim.count({ where: late }),
    ])
    const total = sums._count
    const sum = (amount: unknown) => cents(Number(amount ?? 0))

    return {
        client: { id: client.id, name: client.name, archived: !!client.archivedAt },
        today,
        position: position && { asOf: dayOf(position.asOf), uploadedOn: calendarDateStr(position.uploadedAt, timeZone), uploadedBy: position.uploadedByName },
        totals: { original: sum(sums._sum.originalAmount), paid: sum(sums._sum.paidAmount), remaining: sum(sums._sum.remainingAmount), open: total, late: lateCount },
        claims: rows.map(row => {
            const dueDate = dayOf(row.dueDate)
            return {
                ...row,
                originalAmount: Number(row.originalAmount),
                paidAmount: Number(row.paidAmount),
                remainingAmount: Number(row.remainingAmount),
                periodStart: row.periodStart && dayOf(row.periodStart),
                periodEnd: row.periodEnd && dayOf(row.periodEnd),
                dueDate,
                daysLate: daysLate(dueDate, today),
            }
        }),
        total,
        totalPages: Math.ceil(total / paging.limit),
    }
}

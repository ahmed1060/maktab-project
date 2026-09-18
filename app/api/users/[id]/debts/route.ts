import { withStandardHandler } from "@/lib/api-utils"
import { ApiResponse } from "@/lib/api-response"
import { prisma } from "@/lib/prisma"
import { managesCompany } from "@/lib/payroll-scope"

/**
 * One person's debts, in every state rather than only the open ones.
 *
 * E2: the data for this has existed since P8 and nothing assembled it. A debt
 * is raised by a floored payslip or a settlement, recovered across later
 * months, and finally settled or written off — four events that were each
 * recorded somewhere and never shown together. The question somebody actually
 * asks is "what did this person owe and what happened to it", and until now the
 * only answer was a row on a register that showed whichever debts were still
 * open today.
 *
 * Closed debts are included on purpose. A list of open debts answers what is
 * left; this answers what happened, and a written-off debt is the entry most
 * worth being able to find later.
 */
export const GET = withStandardHandler(async (_req, session, _json, { params }) => {
    const user = await prisma.user.findUnique({
        where: { id: params.id },
        select: { companyId: true },
    })
    if (!user?.companyId) return ApiResponse.notFound("Not found")

    if (!managesCompany(session.user.role, session.user.companyId, user.companyId)) {
        return ApiResponse.forbidden("Access denied")
    }

    const debts = await prisma.debt.findMany({
        where: { userId: params.id },
        orderBy: [{ status: "asc" }, { dueDate: "asc" }],
    })

    return ApiResponse.success(debts.map(d => {
        const amount = Number(d.amount)
        const recovered = Number(d.recoveredAmount)
        return {
            id: d.id,
            amount,
            recovered,
            outstanding: d.status === "OUTSTANDING" ? amount - recovered : 0,
            // Written off is what was left when somebody closed it, which is
            // not the same as the debt's size — a debt mostly recovered and
            // then waived forgave only the remainder.
            writtenOff: d.status === "WAIVED" ? amount - recovered : 0,
            status: d.status,
            source: d.source,
            reason: d.reason,
            dueDate: d.dueDate,
            settledAt: d.settledAt,
            createdAt: d.createdAt,
        }
    }))
})

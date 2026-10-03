import { withStandardHandler } from "@/lib/api-utils"
import { ApiResponse } from "@/lib/api-response"
import { prisma } from "@/lib/prisma"
import { managesCompany } from "@/lib/payroll-scope"

/**
 * One final settlement, as the statement needs it.
 *
 * Managers only, and not because it is more sensitive than a payslip — because
 * the person it is about has left, and an ended contract blocks login. There is
 * nobody else who could be asking. HR prints it or sends it again; that was
 * decided rather than assumed, and building a self-service route for accounts
 * that cannot sign in would be building for nobody.
 */
export const GET = withStandardHandler(async (req, session, _json, { params }) => {
    const settlement = await prisma.finalSettlement.findUnique({
        where: { id: params.id },
        include: {
            user: { select: { firstName: true, lastName: true, email: true } },
            company: { select: { id: true, name: true, logoUrl: true } },
        },
    })

    if (!settlement) return ApiResponse.notFound("Settlement not found")

    if (!managesCompany(session.user, "settlements.manage", settlement.companyId)) {
        return ApiResponse.forbidden("Access denied")
    }

    const net = Number(settlement.netAmount)

    return ApiResponse.success({
        id: settlement.id,
        person: {
            name: `${settlement.user.firstName} ${settlement.user.lastName}`.trim(),
            email: settlement.user.email,
        },
        company: { name: settlement.company.name, logoUrl: settlement.company.logoUrl },
        lastWorkingDay: settlement.lastWorkingDay,
        earned: Number(settlement.earnedAmount),
        paid: Number(settlement.paidAmount),
        net,
        debtRecovered: Number(settlement.debtRecoveredAmount),
        // What actually moves. Kept separate from net so the document's own
        // arithmetic — earned, less paid, is net — still adds up in front of
        // the person reading it.
        payable: net - Number(settlement.debtRecoveredAmount),
        // Derived here, once, rather than in each place that renders it. A
        // statement whose figure and whose wording could disagree is the one
        // thing this document must never be.
        direction: net > 0 ? 'COMPANY_OWES' : net < 0 ? 'PERSON_OWES' : 'SETTLED',
        status: settlement.status,
        dueDate: settlement.dueDate,
        reason: settlement.reason,
        emailedAt: settlement.emailedAt,
    })
})

import { withStandardHandler } from "@/lib/api-utils"
import { ApiResponse } from "@/lib/api-response"
import { prisma } from "@/lib/prisma"
import { managesCompany } from "@/lib/payroll-scope"

/**
 * Every payslip on record for one person.
 *
 * The list that makes a payslip findable at all. Until this existed the
 * document rendered correctly at a URL nothing in the product linked to, so the
 * only way one reached anybody was the email — which worked, and is exactly why
 * nobody noticed.
 *
 * Two readers, same route, different rules, and they are the payslip document's
 * rules rather than new ones: a manager of that person's company always may; the
 * person themselves may only once their company has switched payslips on.
 *
 * Drafts are never listed. A draft is a working figure that is recomputed every
 * time the register is opened, and a payslip somebody has seen and can no longer
 * find — because the number changed — is worse than one they never saw.
 */
export const GET = withStandardHandler(async (_req, session, _json, { params }) => {
    const userId = params.id

    const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { id: true, companyId: true, company: { select: { payslipsVisible: true } } },
    })
    if (!user || !user.companyId) return ApiResponse.notFound("Not found")

    const isManager = managesCompany(session.user, "payroll.view", user.companyId)
    const isOwner = session.user.id === userId

    if (!isManager && !(isOwner && user.company?.payslipsVisible)) {
        // The same single answer the payslip document gives, for the same
        // reason: telling somebody a payslip exists but is hidden is the thing
        // the switch is off in order not to say.
        return ApiResponse.forbidden("Access denied")
    }

    const payslips = await prisma.payslip.findMany({
        where: {
            userId,
            excluded: false,
            payrollRun: { status: { in: ["APPROVED", "PAID"] } },
        },
        select: {
            id: true,
            netAmount: true,
            daysPaid: true,
            emailedAt: true,
            payrollRun: { select: { month: true, year: true, status: true, paidAt: true } },
        },
        orderBy: [{ payrollRun: { year: "desc" } }, { payrollRun: { month: "desc" } }],
    })

    return ApiResponse.success(payslips.map(p => ({
        id: p.id,
        month: p.payrollRun.month,
        year: p.payrollRun.year,
        status: p.payrollRun.status,
        paidAt: p.payrollRun.paidAt,
        net: Number(p.netAmount),
        daysPaid: p.daysPaid,
        emailedAt: p.emailedAt,
    })))
})

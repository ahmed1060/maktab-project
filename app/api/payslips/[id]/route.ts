import { withStandardHandler } from "@/lib/api-utils"
import { ApiResponse } from "@/lib/api-response"
import { prisma } from "@/lib/prisma"
import { managesCompany } from "@/lib/payroll-scope"

/**
 * One payslip, as the document needs it.
 *
 * Three people may read it and the rules differ. A manager of that company
 * always may. The person it belongs to may only if their company has turned
 * payslips on — the switch defaults off, and a payslip is the single most
 * sensitive thing this app holds about somebody, so it is checked here rather
 * than assumed from the fact that a page rendered.
 *
 * Nobody else, including a manager at another company, which is why this reads
 * the payslip's own company rather than trusting the session's.
 */
export const GET = withStandardHandler(async (req, session, _json, { params }) => {
    const payslip = await prisma.payslip.findUnique({
        where: { id: params.id },
        include: {
            lines: { orderBy: { sortOrder: "asc" } },
            user: { select: { id: true, firstName: true, lastName: true, email: true, companyId: true } },
            payrollRun: {
                select: {
                    month: true, year: true, status: true, payrollDay: true, paidAt: true,
                    company: { select: { id: true, name: true, logoUrl: true, payslipsVisible: true } },
                },
            },
        },
    })

    if (!payslip) return ApiResponse.notFound("Payslip not found")

    const company = payslip.payrollRun.company
    const isManager = managesCompany(session.user.role, session.user.companyId, company.id)
    const isOwner = session.user.id === payslip.userId

    if (!isManager && !(isOwner && company.payslipsVisible)) {
        // Deliberately the same answer for "not yours" and "your company has
        // payslips switched off". Distinguishing them tells an employee that a
        // payslip exists for them, which is the thing the switch is off to
        // avoid saying.
        return ApiResponse.forbidden("Access denied")
    }

    return ApiResponse.success({
        id: payslip.id,
        person: {
            name: `${payslip.user.firstName} ${payslip.user.lastName}`.trim(),
            email: payslip.user.email,
        },
        company: { name: company.name, logoUrl: company.logoUrl },
        period: { month: payslip.payrollRun.month, year: payslip.payrollRun.year },
        status: payslip.payrollRun.status,
        paidAt: payslip.payrollRun.paidAt,
        daysPaid: payslip.daysPaid,
        excluded: payslip.excluded,
        exclusionReason: payslip.exclusionReason,
        earnings: Number(payslip.earningsAmount),
        deductions: Number(payslip.deductionsAmount),
        net: Number(payslip.netAmount),
        carried: Number(payslip.carriedAmount),
        emailedAt: payslip.emailedAt,
        lines: payslip.lines.map(l => ({
            kind: l.kind,
            label: l.label,
            amount: Number(l.amount),
        })),
    })
})

import { prisma } from "@/lib/prisma"
import { sendPlainEmail, type SendOutcome } from "@/lib/email"
import { nextIssueBatch, ISSUE_BATCH_SIZE } from "@/lib/register"
import { csvFile } from "@/lib/csv"

/**
 * Getting the money out, and getting the documents to the people they are about.
 *
 * The last phase, and the one where every failure is visible to somebody
 * outside the company. A payslip sent twice, a payslip never sent, a month
 * marked paid that was not — these are not internal inconsistencies, they are
 * conversations with an employee.
 *
 * So two rules run through all of it. Nothing is sent from a draft, because a
 * provisional figure in somebody's inbox cannot be recalled. And emailedAt is
 * stamped as each individual send succeeds rather than after the batch, so a
 * timeout costs a pause instead of sixty people receiving their payslip twice.
 */
export class PayrollDeliveryService {
    /**
     * Mark an approved month as paid.
     *
     * Separate from approval on purpose: approving says the figures are right,
     * and this says the money has moved. Collapsing them would make a mistake in
     * the first one unrecoverable, and there is usually a day or more between
     * them in practice.
     */
    static async markPaid(companyId: string, year: number, month: number, session: any, paidAt?: Date) {
        const run = await prisma.payrollRun.findUnique({
            where: { companyId_month_year: { companyId, month, year } },
        })
        if (!run) throw new Error("RUN_NOT_FOUND")
        if (run.status === "PAID") throw new Error("ALREADY_PAID")
        if (run.status !== "APPROVED") throw new Error("NOT_APPROVED")

        const when = paidAt ?? new Date()

        return prisma.$transaction(async (tx) => {
            const updated = await tx.payrollRun.update({
                where: { id: run.id },
                data: { status: "PAID", paidAt: when, paidById: session?.user?.id ?? null },
            })

            // The settlements this run carried move with it. A settlement left
            // APPROVED after its run is PAID is a person who has been paid
            // according to one table and is still owed according to another.
            await tx.finalSettlement.updateMany({
                where: { payrollRunId: run.id, status: "APPROVED" },
                data: { status: "PAID" },
            })

            const { AuditLogService } = await import("./audit-log.service")
            await AuditLogService.log("MARK_PAYROLL_PAID", "PAYROLL", run.id, {
                tx,
                userId: session?.user?.role !== "SUPER_ADMIN" ? session?.user?.id : null,
                superAdminId: session?.user?.role === "SUPER_ADMIN" ? session?.user?.id : null,
                details: { companyId, month, year, paidAt: when.toISOString() },
            })

            return updated
        })
    }

    private static payslipBody(person: string, company: string, monthLabel: string, net: string) {
        return [
            `Hello ${person},`,
            ``,
            `Your payslip for ${monthLabel} is ready.`,
            ``,
            `Net pay: ${net}`,
            ``,
            `If anything on it looks wrong, reply to this message and somebody will look at it.`,
            ``,
            company,
        ].join("\n")
    }

    /**
     * Send the next batch of payslips for a run.
     *
     * Sequential, because lib/email.ts sends through one Gmail account with no
     * queue and no retry, and firing them in parallel is how an account gets
     * rate-limited — which does not merely annoy somebody, it stops password
     * resets and sign-in codes for everyone.
     *
     * A reserved address is reported rather than stamped. It is not a failure
     * and never will be deliverable, but calling it "emailed" would be a lie in
     * a column the register reads to decide what is left.
     */
    static async issueBatch(
        companyId: string,
        year: number,
        month: number,
        size: number = ISSUE_BATCH_SIZE,
    ) {
        const run = await prisma.payrollRun.findUnique({
            where: { companyId_month_year: { companyId, month, year } },
            include: {
                company: { select: { name: true } },
                payslips: {
                    orderBy: { createdAt: "asc" },
                    include: { user: { select: { firstName: true, lastName: true, email: true } } },
                },
            },
        })
        if (!run) throw new Error("RUN_NOT_FOUND")
        // Nothing leaves a draft. A provisional figure in somebody's inbox
        // cannot be recalled, and "we will send a corrected one" is a sentence
        // that costs more trust than the original mistake.
        if (run.status === "DRAFT") throw new Error("RUN_IS_DRAFT")

        const { batch, remaining, total } = nextIssueBatch(run.payslips, size)
        const monthLabel = `${new Date(Date.UTC(year, month - 1)).toLocaleString("en-US", { month: "long", timeZone: "UTC" })} ${year}`

        let sent = 0
        const skipped: string[] = []
        const failed: { name: string; error: string }[] = []

        for (const payslip of batch) {
            const name = `${payslip.user.firstName} ${payslip.user.lastName}`.trim()
            try {
                const outcome: SendOutcome = await sendPlainEmail(
                    payslip.user.email,
                    `Payslip — ${monthLabel}`,
                    this.payslipBody(name, run.company.name, monthLabel, Number(payslip.netAmount).toFixed(2)),
                )

                if (outcome === "SENT") {
                    // Stamped here, one at a time, immediately. Stamping after
                    // the loop is what turns a timeout into a second send.
                    await prisma.payslip.update({
                        where: { id: payslip.id },
                        data: { emailedAt: new Date() },
                    })
                    sent++
                } else {
                    skipped.push(name)
                }
            } catch (error: any) {
                // One bad address must not stop the other twenty-four. It is
                // named, and its payslip stays unsent so the next batch retries
                // it.
                failed.push({ name, error: error?.message ?? String(error) })
            }
        }

        return { sent, skipped, failed, attempted: batch.length, remaining, total }
    }

    /** One document again, for somebody who asks. Usually a leaver. */
    static async resendSettlement(settlementId: string) {
        const settlement = await prisma.finalSettlement.findUnique({
            where: { id: settlementId },
            include: {
                user: { select: { firstName: true, lastName: true, email: true } },
                company: { select: { name: true } },
            },
        })
        if (!settlement) throw new Error("SETTLEMENT_NOT_FOUND")

        const name = `${settlement.user.firstName} ${settlement.user.lastName}`.trim()
        const net = Number(settlement.netAmount)
        const direction = net > 0
            ? `The company owes you ${net.toFixed(2)}.`
            : net < 0
                ? `${Math.abs(net).toFixed(2)} is owed to the company.`
                : `Nothing is outstanding.`

        const outcome = await sendPlainEmail(
            settlement.user.email,
            `Final settlement — ${settlement.company.name}`,
            [
                `Hello ${name},`,
                ``,
                `Here is your final settlement.`,
                ``,
                `Earned for the final month: ${Number(settlement.earnedAmount).toFixed(2)}`,
                `Already paid for that month: ${Number(settlement.paidAmount).toFixed(2)}`,
                direction,
                ``,
                settlement.company.name,
            ].join("\n"),
        )

        if (outcome === "SENT") {
            await prisma.finalSettlement.update({
                where: { id: settlementId },
                data: { emailedAt: new Date() },
            })
        }

        return { outcome }
    }

    /**
     * The register as a file.
     *
     * Every money column is written unsigned, with its sign carried by the
     * column heading. A signed figure would trip the formula guard in lib/csv.ts
     * and export as text, and "deductions" is clearer than a column of negative
     * numbers anyway.
     */
    static async exportCsv(companyId: string, year: number, month: number) {
        const run = await prisma.payrollRun.findUnique({
            where: { companyId_month_year: { companyId, month, year } },
            include: {
                company: { select: { name: true } },
                payslips: {
                    orderBy: { createdAt: "asc" },
                    include: { user: { select: { firstName: true, lastName: true, email: true } } },
                },
            },
        })
        if (!run) throw new Error("RUN_NOT_FOUND")

        const rows: unknown[][] = [[
            "Name", "Email", "Days paid", "Earnings", "Deductions", "Net", "Carried as debt",
            "Excluded", "Exclusion reason", "Emailed at",
        ]]

        for (const p of run.payslips) {
            rows.push([
                `${p.user.firstName} ${p.user.lastName}`.trim(),
                p.user.email,
                p.daysPaid,
                Number(p.earningsAmount).toFixed(2),
                Number(p.deductionsAmount).toFixed(2),
                Number(p.netAmount).toFixed(2),
                Number(p.carriedAmount).toFixed(2),
                p.excluded ? "yes" : "no",
                p.exclusionReason ?? "",
                p.emailedAt ? p.emailedAt.toISOString() : "",
            ])
        }

        const included = run.payslips.filter(p => !p.excluded)
        rows.push([])
        rows.push([
            "Total", "", "", "",
            "",
            included.reduce((sum, p) => sum + Number(p.netAmount), 0).toFixed(2),
        ])

        return {
            filename: `payroll_${year}-${String(month).padStart(2, "0")}_${run.status.toLowerCase()}.csv`,
            body: csvFile(rows),
        }
    }
}

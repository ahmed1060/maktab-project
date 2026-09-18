import { prisma } from "@/lib/prisma"
import { buildRegister, variance, nextIssueBatch, type PersonMonth, type AdjustmentInput } from "@/lib/register"
import { timelineForMonth } from "@/lib/employment"
import { ratesForMonth } from "@/lib/salary-history"
import { toMajor, toMinor } from "@/lib/payroll"
import { paydayIn } from "@/lib/payday"
import { startOfMonthIn } from "@/lib/time"
import { resolveTimeZone } from "@/lib/timezone"
import { checkApproval, type ApprovalRefusal } from "@/lib/approval"

/**
 * Building a month's payroll, and freezing it once somebody signs it off.
 *
 * Everything interesting happens in lib/register.ts, which is pure. This reads
 * the rows that feed it and writes the rows it produces, and is careful about
 * exactly one thing: a DRAFT is recomputed from source every time it is opened,
 * and anything past DRAFT is never recomputed at all.
 *
 * That line is the whole design. Before approval the register should reflect a
 * correction made five minutes ago; after approval it must show what was
 * approved, not today's answer to last month's question.
 */
export class PayrollRunService {
    /** The company's calendar and payroll day, resolved once per run. */
    private static async policy(companyId: string) {
        const [company, settings] = await Promise.all([
            prisma.company.findUnique({
                where: { id: companyId },
                select: { payrollDay: true, timezone: true },
            }),
            prisma.systemSettings.findUnique({
                where: { id: "default" },
                select: { defaultTimezone: true },
            }),
        ])
        if (!company) throw new Error("COMPANY_NOT_FOUND")

        return {
            payrollDay: company.payrollDay,
            timeZone: resolveTimeZone(company.timezone, settings?.defaultTimezone),
        }
    }

    /**
     * Everyone whose month this run has to answer for.
     *
     * Deliberately includes people who have left and people who are archived.
     * Somebody who left on the 10th is owed ten days, and a register that
     * listed only current staff would silently not pay them — which is the
     * failure mode a register exists to prevent, arriving as an absence rather
     * than as a wrong number.
     */
    private static async peopleFor(companyId: string) {
        return prisma.user.findMany({
            where: {
                companyId,
                status: { not: "DELETED" },
                role: { in: ["EMPLOYEE", "TEAM_LEADER", "ADMIN"] },
            },
            select: { id: true, firstName: true, lastName: true },
            orderBy: [{ firstName: "asc" }, { lastName: "asc" }],
        })
    }

    /**
     * The register for a month, computed from source.
     *
     * A read. It writes nothing, so opening the screen twice cannot produce two
     * runs, and a person looking at a draft is never the reason a row appears.
     */
    static async compute(companyId: string, year: number, month: number) {
        const { timeZone, payrollDay } = await this.policy(companyId)
        const people = await this.peopleFor(companyId)

        const entries: PersonMonth[] = []
        const refused: { userId: string; name: string; reason: string }[] = []

        for (const user of people) {
            const name = `${user.firstName} ${user.lastName}`.trim()
            const [events, changes, adjustments] = await Promise.all([
                prisma.employmentEvent.findMany({
                    where: { userId: user.id },
                    orderBy: [{ effectiveFrom: "asc" }, { createdAt: "asc" }],
                }),
                prisma.salaryChange.findMany({
                    where: { userId: user.id },
                    orderBy: [{ effectiveFrom: "asc" }, { createdAt: "asc" }],
                }),
                prisma.salaryAdjustment.findMany({
                    where: { userId: user.id, year, month, status: "ACTIVE" },
                    orderBy: { createdAt: "asc" },
                }),
            ])

            const timeline = timelineForMonth(
                events.map(e => ({
                    type: e.type as any,
                    effectiveFrom: e.effectiveFrom,
                    reason: e.reason,
                    deductSuspension: e.deductSuspension,
                    createdAt: e.createdAt,
                })),
                year, month, timeZone,
            )

            // Somebody who was not employed at all this month has no payslip,
            // and that is not a refusal — it is the correct answer.
            if (timeline.employed.length === 0) continue

            try {
                entries.push({
                    userId: user.id,
                    name,
                    timeline,
                    rates: ratesForMonth(
                        changes.map(c => ({
                            monthlyAmount: c.monthlyAmount.toString(),
                            effectiveFrom: c.effectiveFrom,
                            reason: c.reason,
                            createdAt: c.createdAt,
                        })),
                        year, month, timeZone,
                    ),
                    adjustments: adjustments.map((a): AdjustmentInput => ({
                        type: a.type === "BONUS" ? "BONUS" : "DEDUCTION",
                        days: Number(a.amount),
                        reason: a.reason,
                        source: a.source,
                        sourceId: a.sourceId,
                    })),
                })
            } catch (error: any) {
                // One person with no salary history must not stop the other
                // fifty being paid. They are named instead, on the register,
                // where somebody can fix it.
                refused.push({ userId: user.id, name, reason: error?.message ?? String(error) })
            }
        }

        return { register: buildRegister(entries, year, month), refused, timeZone, payrollDay }
    }

    /** Last month's nets, for the variance. Absent is not zero — it is "no run". */
    private static async previousNets(companyId: string, year: number, month: number) {
        const prevYear = month === 1 ? year - 1 : year
        const prevMonth = month === 1 ? 12 : month - 1

        const run = await prisma.payrollRun.findUnique({
            where: { companyId_month_year: { companyId, month: prevMonth, year: prevYear } },
            include: {
                payslips: {
                    where: { excluded: false },
                    include: { user: { select: { firstName: true, lastName: true } } },
                },
            },
        })
        if (!run) return null

        return run.payslips.map(p => ({
            userId: p.userId,
            name: `${p.user.firstName} ${p.user.lastName}`.trim(),
            netMinor: toMinor(p.netAmount.toString()),
        }))
    }

    /**
     * The register as a screen wants it: the figures, what changed, what is
     * still undecided, and what is outstanding.
     */
    static async view(companyId: string, year: number, month: number) {
        const [{ register, refused, payrollDay }, run, previous, debts] = await Promise.all([
            this.compute(companyId, year, month),
            prisma.payrollRun.findUnique({
                where: { companyId_month_year: { companyId, month, year } },
            }),
            this.previousNets(companyId, year, month),
            prisma.debt.findMany({
                where: { companyId, status: "OUTSTANDING" },
                orderBy: { dueDate: "asc" },
                include: { user: { select: { firstName: true, lastName: true } } },
            }),
        ])

        return {
            year,
            month,
            payrollDay,
            status: run?.status ?? "DRAFT",
            runId: run?.id ?? null,
            register,
            refused,
            // Null rather than an empty variance: "nothing changed" and "there
            // is nothing to compare against" are different answers, and the
            // first is reassuring while the second is not.
            variance: previous ? variance(register.entries, previous) : null,
            debts: debts.map(d => ({
                id: d.id,
                userId: d.userId,
                name: `${d.user.firstName} ${d.user.lastName}`.trim(),
                amount: Number(d.amount),
                dueDate: d.dueDate,
                source: d.source,
            })),
        }
    }

    /**
     * Write the computed register into a DRAFT run, replacing whatever was
     * there.
     *
     * Only ever a draft. An approved run is a record and is never rebuilt — see
     * the guard below, which is the one thing standing between "correct a typo"
     * and "silently restate a month that has already been paid".
     */
    static async saveDraft(companyId: string, year: number, month: number, session?: any) {
        const existing = await prisma.payrollRun.findUnique({
            where: { companyId_month_year: { companyId, month, year } },
        })
        if (existing && existing.status !== "DRAFT") {
            throw new Error("RUN_NOT_DRAFT")
        }

        const { register, payrollDay } = await this.compute(companyId, year, month)

        return prisma.$transaction(async (tx) => {
            const run = await tx.payrollRun.upsert({
                where: { companyId_month_year: { companyId, month, year } },
                update: { payrollDay },
                create: { companyId, month, year, payrollDay },
            })

            // Replaced wholesale rather than reconciled. A draft is a view that
            // happens to be stored, and a partial update is how a payslip keeps
            // a line whose adjustment was rolled back an hour ago.
            await tx.payslip.deleteMany({ where: { payrollRunId: run.id } })

            for (const entry of register.entries) {
                await tx.payslip.create({
                    data: {
                        payrollRunId: run.id,
                        userId: entry.userId,
                        earningsAmount: toMajor(entry.totals.earningsMinor),
                        deductionsAmount: toMajor(entry.totals.deductionsMinor),
                        netAmount: toMajor(entry.totals.netMinor),
                        carriedAmount: toMajor(entry.totals.carriedMinor),
                        daysPaid: entry.daysPaid,
                        excluded: entry.excluded,
                        exclusionReason: entry.exclusionReason ?? null,
                        lines: {
                            create: entry.lines.map(line => ({
                                kind: line.kind,
                                label: line.label,
                                amount: toMajor(line.amountMinor),
                                source: line.source,
                                sourceId: line.sourceId ?? null,
                                sortOrder: line.sortOrder,
                            })),
                        },
                    },
                })
            }

            if (session) {
                const { AuditLogService } = await import("./audit-log.service")
                await AuditLogService.log("SAVE_PAYROLL_DRAFT", "PAYROLL", run.id, {
                    tx,
                    userId: session.user.role !== "SUPER_ADMIN" ? session.user.id : null,
                    superAdminId: session.user.role === "SUPER_ADMIN" ? session.user.id : null,
                    details: {
                        companyId, month, year,
                        people: register.includedCount,
                        excluded: register.excludedCount,
                        payable: toMajor(register.payableMinor),
                    },
                })
            }

            return run
        })
    }

    /**
     * Freeze the month.
     *
     * Recomputed once more from source inside the transaction, so what gets
     * approved is what was true at the moment of approval rather than whatever
     * a draft happened to be storing from an hour ago. After this the figures
     * are a record: the run refuses to be rebuilt, and the adjustments behind it
     * refuse to be undone.
     *
     * Three things happen together or none do. The payslips, the settlements
     * this run is carrying, and the debts that come out of a net that floored at
     * zero. Any of them alone is a state somebody has to reconcile by hand.
     */
    static async approve(
        companyId: string,
        year: number,
        month: number,
        session: any,
        options: { acknowledgePending?: boolean } = {},
    ): Promise<{ runId: string } | { refusal: ApprovalRefusal }> {
        const [{ register, refused }, existing] = await Promise.all([
            this.compute(companyId, year, month),
            prisma.payrollRun.findUnique({
                where: { companyId_month_year: { companyId, month, year } },
            }),
        ])

        const verdict = checkApproval({
            status: (existing?.status ?? "DRAFT") as "DRAFT" | "APPROVED" | "PAID",
            refused,
            pendingDecisions: register.pendingDecisions,
            acknowledgePending: options.acknowledgePending === true,
            includedCount: register.includedCount,
        })
        if (!verdict.ok) return { refusal: verdict.refusal }

        // Written first so the transaction below only ever writes.
        await this.saveDraft(companyId, year, month)
        const { timeZone } = await this.policy(companyId)

        return prisma.$transaction(async (tx) => {
            const run = await tx.payrollRun.update({
                where: { companyId_month_year: { companyId, month, year } },
                data: {
                    status: "APPROVED",
                    approvedAt: new Date(),
                    approvedById: session?.user?.id ?? null,
                },
                include: { payslips: true },
            })

            // A net that floored at zero leaves money the deductions could not
            // take. It becomes a debt here rather than at draft time, because
            // until approval the figure is still moving and a debt that changes
            // every time somebody opens a screen is not a debt.
            for (const payslip of run.payslips) {
                if (payslip.excluded) continue
                const carried = Number(payslip.carriedAmount)
                if (carried <= 0) continue

                await tx.debt.create({
                    data: {
                        userId: payslip.userId,
                        companyId,
                        amount: carried,
                        source: "PAYSLIP_CARRY",
                        sourceId: payslip.id,
                        // Due on the payday this run is for: the month it could
                        // not be taken from is the month it became owed.
                        dueDate: paydayIn(year, month, run.payrollDay, timeZone),
                    },
                })
            }

            // Settlements waiting on a run, now carried by this one. Attached by
            // due date rather than by the month somebody left in: a person who
            // left in March with an April due date is April's to pay.
            const carriedSettlements = await tx.finalSettlement.updateMany({
                where: {
                    companyId,
                    status: "PENDING",
                    payrollRunId: null,
                    dueDate: { lte: endOfMonthIn(year, month, timeZone) },
                },
                data: { payrollRunId: run.id, status: "APPROVED" },
            })

            const { AuditLogService } = await import("./audit-log.service")
            await AuditLogService.log("APPROVE_PAYROLL", "PAYROLL", run.id, {
                tx,
                userId: session?.user?.role !== "SUPER_ADMIN" ? session?.user?.id : null,
                superAdminId: session?.user?.role === "SUPER_ADMIN" ? session?.user?.id : null,
                details: {
                    companyId, month, year,
                    payslips: run.payslips.length,
                    payable: toMajor(register.payableMinor),
                    settlementsCarried: carriedSettlements.count,
                    pendingAcknowledged: register.pendingDecisions.map(p => p.name),
                },
            })

            return { runId: run.id }
        })
    }

    /** Which payslips the next issue action would send, and how many remain. */
    static async issueBatch(runId: string, size?: number) {
        const payslips = await prisma.payslip.findMany({
            where: { payrollRunId: runId },
            orderBy: { createdAt: "asc" },
            include: { user: { select: { firstName: true, lastName: true, email: true } } },
        })
        return nextIssueBatch(payslips, size)
    }
}

/** The last instant of a calendar month in a given zone. */
function endOfMonthIn(year: number, month: number, timeZone: string): Date {
    const nextYear = month === 12 ? year + 1 : year
    const nextMonth = month === 12 ? 1 : month + 1
    const nextStart = startOfMonthIn(new Date(Date.UTC(nextYear, nextMonth - 1, 1, 12)), timeZone)
    return new Date(nextStart.getTime() - 1)
}

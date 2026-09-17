import { prisma } from "@/lib/prisma"
import { buildRegister, variance, nextIssueBatch, type PersonMonth, type AdjustmentInput } from "@/lib/register"
import { timelineForMonth } from "@/lib/employment"
import { ratesForMonth } from "@/lib/salary-history"
import { toMajor, toMinor } from "@/lib/payroll"
import { resolveTimeZone } from "@/lib/timezone"

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

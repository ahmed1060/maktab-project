import { prisma } from "@/lib/prisma"
import { addDays } from "@/lib/attendance/calendar"
import { Prisma } from "@prisma/client"
import { LOCK_WAIT, lockMonths } from "./attendance-lock"
import { attendanceReaches, attendanceMoney, rejectPendingOvertime, reconcileEntries, stampDays, monthKey, daysToSettle, waitingOf } from "./attendance-payroll"
import { buildRegister, variance, nextIssueBatch, issueProgress, ISSUE_BATCH_SIZE, ATTENDANCE_SOURCE, type PersonMonth, type AdjustmentInput } from "@/lib/register"
import { DEBT_RECOVERY_SOURCE, type RecoverableDebt } from "@/lib/debt-recovery"
import { timelineForMonth } from "@/lib/employment"
import { ratesForMonth } from "@/lib/salary-history"
import { toMajor, toMinor } from "@/lib/payroll"
import { closeDateOf, lastDayOf, monthKeyOf, nextMonth } from "@/lib/payroll-period"
import { PayrollPeriodService } from "./payroll-period.service"
import { calendarDateStr, startOfDayIn, startOfMonthIn } from "@/lib/time"
import { notOwnerIn } from "@/lib/owners"
import { resolveTimeZone } from "@/lib/timezone"
import { PAYDAY_BEFORE_CLOSE, checkApproval, settleRefusal, type ApprovalRefusal } from "@/lib/approval"

/**
 * A day still to settle found on the register being approved, for someone
 * not checked before it was built (review on PR 276). Thrown, so the
 * transaction undoes what it had done; answered as the refusal it carries.
 */
class SettleRefused extends Error {
    constructor(readonly refusal: ApprovalRefusal) { super("DAYS_TO_SETTLE") }
}

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
/** Why a month's payday isn't changed (LATER_CHANGES_PLAN.md §7.10, PR 430). */
export type PaydayChangeRefusal = {
    code: "RUN_PAID" | "PERIOD_FROZEN" | "ATTENDANCE_OUT_OF_RANGE" | "PAYDAY_NOT_AFTER_PERIOD" | "PAYDAY_TOO_LATE"
    periodEnd?: string; from?: string; to?: string
}

export class PayrollRunService {
    /** The company's calendar and payroll day, resolved once per run. */
    private static async policy(companyId: string, db: Prisma.TransactionClient = prisma) {
        const [company, settings] = await Promise.all([
            db.company.findUnique({
                where: { id: companyId },
                select: { payrollDay: true, timezone: true, debtRecoveryPercent: true, attendancePayrollFrom: true },
            }),
            prisma.systemSettings.findUnique({
                where: { id: "default" },
                select: { defaultTimezone: true },
            }),
        ])
        if (!company) throw new Error("COMPANY_NOT_FOUND")

        return {
            payrollDay: company.payrollDay,
            debtRecoveryPercent: company.debtRecoveryPercent,
            attendancePayrollFrom: company.attendancePayrollFrom,
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
    private static async peopleFor(companyId: string, month: string) {
        return prisma.user.findMany({
            where: {
                companyId,
                status: { not: "DELETED" },
                role: { in: ["EMPLOYEE", "TEAM_LEADER", "ADMIN"] },
                // An owner that month has no payslip at all (LATER_CHANGES_PLAN.md §7.3, PR 426).
                ...notOwnerIn(month),
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
    static async compute(
        companyId: string, year: number, month: number, db: Prisma.TransactionClient = prisma,
        // Whether attendance is on the payslips, when the caller already knows:
        // approval's own reading of the switch, or what an approved run recorded.
        reaches?: boolean,
    ) {
        const { timeZone, payrollDay, debtRecoveryPercent, attendancePayrollFrom } = await this.policy(companyId, db)
        const people = await this.peopleFor(companyId, `${year}-${String(month).padStart(2, "0")}`)
        // Attendance as money (ATTENDANCE_PLAN.md §12.2), read through the
        // caller's transaction: approval's, after its own final recompute.
        // Before the company's chosen month it is shown, never deducted.
        const attendanceReachesPayroll = reaches ?? attendanceReaches(attendancePayrollFrom, year, month)
        // Its attendance period, not its calendar month (LATER_CHANGES_PLAN.md §7.10, PR 430).
        const period = await PayrollPeriodService.periodOf(db, companyId, year, month)
        const attendance = await attendanceMoney(db, companyId, period)

        // Everything still owed, and the moment after which a debt has not come
        // due yet — computed in the company's calendar, because a UTC month end
        // is hours adrift of a Cairo one and that is enough to take a debt the
        // day before it is owed.
        const monthEnd = new Date(startOfMonthIn(
            new Date(Date.UTC(month === 12 ? year + 1 : year, month === 12 ? 0 : month, 1, 12)),
            timeZone,
        ).getTime() - 1)

        const outstanding = await prisma.debt.findMany({
            where: { companyId, status: "OUTSTANDING" },
            select: { id: true, userId: true, amount: true, recoveredAmount: true, dueDate: true },
        })
        const debtsByUser = new Map<string, RecoverableDebt[]>()
        for (const debt of outstanding) {
            const outstandingMinor = toMinor(debt.amount.toString()) - toMinor(debt.recoveredAmount.toString())
            if (outstandingMinor <= 0) continue
            const list = debtsByUser.get(debt.userId) ?? []
            list.push({ id: debt.id, outstandingMinor, dueDate: debt.dueDate })
            debtsByUser.set(debt.userId, list)
        }

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
                    ...(attendanceReachesPayroll && attendance.has(user.id) ? { attendance: attendance.get(user.id) } : {}),
                    debts: debtsByUser.get(user.id) ?? [],
                    recoveryCapPercent: debtRecoveryPercent,
                    debtsDueOnOrBefore: monthEnd,
                })
            } catch (error: any) {
                // One person with no salary history must not stop the other
                // fifty being paid. They are named instead, on the register,
                // where somebody can fix it.
                refused.push({ userId: user.id, name, reason: error?.message ?? String(error) })
            }
        }

        return {
            register: buildRegister(entries, year, month), refused, timeZone, payrollDay, period,
            attendance: {
                reachesPayroll: attendanceReachesPayroll,
                from: attendancePayrollFrom ? attendancePayrollFrom.toISOString().slice(0, 7) : null,
                byPerson: Object.fromEntries(attendance),
            },
        }
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
        const run = await prisma.payrollRun.findUnique({
            where: { companyId_month_year: { companyId, month, year } },
            include: { payslips: { select: { id: true, userId: true, netAmount: true, emailedAt: true, excluded: true } } },
        })
        // An approved run shows attendance as it was approved, whatever the
        // switch says now (review on #16).
        const recorded = run && run.status !== "DRAFT" ? run.attendanceIncluded : undefined
        const [{ register, refused, payrollDay, attendance, timeZone, period }, discrepanciesOpen, previous, debts] = await Promise.all([
            this.compute(companyId, year, month, prisma, recorded),
            // Owed whether or not attendance reaches payroll now: a run approved
            // with it keeps producing these after the switch is stopped.
            prisma.attendanceDiscrepancy.count({ where: { companyId, resolvedAt: null } }),
            this.previousNets(companyId, year, month),
            prisma.debt.findMany({
                where: { companyId, status: "OUTSTANDING" },
                orderBy: { dueDate: "asc" },
                include: { user: { select: { firstName: true, lastName: true } } },
            }),
            // Note: `amount` and "still owed" stopped being the same number when
            // recovery arrived — see the mapping below.
        ])
        // What approving waits on, and warns of (ATTENDANCE_PLAN.md §6.9,
        // decisions 14 and 24, PR 276): for a draft, once attendance reaches
        // its payroll. Past approval, nothing waits.
        const toSettle = (run?.status ?? "DRAFT") === "DRAFT" && attendance.reachesPayroll
            ? await daysToSettle(prisma, companyId, period, register.entries.filter(e => !e.excluded).map(e => e.userId))
            : null
        // The month's payday as a date, and from when it may be approved
        // (LATER_CHANGES_PLAN.md §7.10, PR 430).
        const payday = await PayrollPeriodService.paydayOf(prisma, companyId, year, month)
        const today = calendarDateStr(new Date(), timeZone)
        const { closeDay } = await PayrollPeriodService.settings(prisma, companyId)
        const after = nextMonth(year, month)
        const next = await prisma.payrollRun.findUnique({ where: { companyId_month_year: { companyId, month: after.month, year: after.year } }, select: { status: true } })

        return {
            year,
            month,
            payrollDay,
            payday,
            period,
            approvableFrom: addDays(period.to, 1),
            periodOver: today > period.to,
            // The latest a changed month's attendance can end: the settings' close.
            settingClose: closeDateOf(year, month, closeDay),
            // The month after approved, this one's attendance ends where that one's begins (review on PR 430).
            nextApproved: !!next && next.status !== "DRAFT",
            status: run?.status ?? "DRAFT",
            runId: run?.id ?? null,
            // How far delivery has got, from the stored payslips rather than
            // the computed register: the register is what the month *would*
            // pay, and what has been emailed is a fact about the run.
            delivery: run
                ? { paidAt: run.paidAt, batchSize: ISSUE_BATCH_SIZE, ...issueProgress(run.payslips) }
                : null,
            // userId -> payslip id, so the register can link a row to the
            // document it produced. Only present once a draft has been saved;
            // a computed row that has never been stored has no payslip to
            // point at, and inventing a link to one would be worse than
            // showing none.
            payslipIds: run
                ? Object.fromEntries(run.payslips.map(p => [p.userId, p.id]))
                : {},
            register,
            refused,
            toSettle,
            // What attendance costs this month: on the payslips once it reaches
            // payroll; before that, shown beside the register and deducted from
            // nobody — the dry run (ATTENDANCE_PLAN.md §20).
            // An approved run's start month as it was approved: the switch can since have moved only past the
            // months approved, or stopped. Still at or before this month, it is the one approved with; later or
            // gone, that one isn't known here, and none is shown rather than today's (review on #16).
            attendance: { ...attendance, from: recorded !== undefined && attendance.from && attendance.from > monthKey(year, month) ? null : attendance.from, discrepanciesOpen },
            // Null rather than an empty variance: "nothing changed" and "there
            // is nothing to compare against" are different answers, and the
            // first is reassuring while the second is not.
            variance: previous ? variance(register.entries, previous) : null,
            // E1: what has moved since the draft on screen was saved.
            //
            // The variance above answers "why is this different from last
            // month", which is the question a reviewer can answer. This answers
            // a narrower and more urgent one — "did anything change since I
            // read this" — because approval is irreversible and the gap between
            // reading a register and signing it is exactly where a late
            // adjustment lands unnoticed.
            //
            // Only for a draft. Past that the stored figures are the record and
            // the computed ones are no longer consulted.
            sinceDraft: run && run.status === "DRAFT" && run.payslips.length > 0
                ? variance(
                    register.entries,
                    run.payslips.filter(p => !p.excluded).map(p => ({
                        userId: p.userId,
                        name: "",
                        netMinor: toMinor(p.netAmount.toString()),
                    })),
                )
                : null,
            draftSavedAt: run && run.status === "DRAFT" ? run.updatedAt : null,
            // H2: this printed `amount`, which was the outstanding figure right
            // up until recovery existed. Since then a debt can be part-paid,
            // and `amount` is deliberately the original — so the list was
            // showing 5,000 for a debt with 2,000 left on it, correctly and
            // uselessly. Outstanding is what somebody reconciling against a
            // bank statement needs; the original is kept beside it, for the
            // rows where they differ.
            debts: debts.map(d => ({
                id: d.id,
                userId: d.userId,
                name: `${d.user.firstName} ${d.user.lastName}`.trim(),
                amount: Number(d.amount) - Number(d.recoveredAmount),
                originalAmount: Number(d.amount),
                recoveredAmount: Number(d.recoveredAmount),
                dueDate: d.dueDate,
                // The day it's due, in the company's zone: due at the start of
                // payday there, which in UTC can still be the day before
                // (PR 145).
                dueDay: calendarDateStr(d.dueDate, timeZone),
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
        return prisma.$transaction(tx => this.writeDraft(tx, companyId, year, month, register, payrollDay, session))
    }

    /** Writes a computed register into the month's DRAFT run, inside the caller's transaction. */
    private static async writeDraft(
        tx: Prisma.TransactionClient, companyId: string, year: number, month: number,
        register: Awaited<ReturnType<typeof PayrollRunService.compute>>["register"], payrollDay: number, session?: any,
    ) {
        {
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
        }
    }

    /**
     * Change this month's payday (LATER_CHANGES_PLAN.md §7.10, 10f, PR 430):
     * a one-off, such as paying before Eid. The day picked stays where it's
     * put, even on a day off. While the month is a draft, its attendance may
     * end sooner with it, the day before the new payday unless said, and the
     * days after go to next month's period. Once approved, only payday
     * changes, still after the period; once paid, nothing does.
     */
    static async changePayday(
        companyId: string, year: number, month: number,
        input: { payday: string; attendanceUntil?: string | null },
        session: any,
    ): Promise<{ payday: string; periodEnd: string } | { refused: PaydayChangeRefusal }> {
        const refuse = (code: PaydayChangeRefusal["code"], extra: Partial<PaydayChangeRefusal> = {}) => ({ refused: { code, ...extra } as PaydayChangeRefusal })
        return prisma.$transaction(async tx => {
            const after = nextMonth(year, month)
            await lockMonths(tx, companyId, [monthKey(year, month), monthKeyOf(after.year, after.month)])
            const run = await tx.payrollRun.findUnique({ where: { companyId_month_year: { companyId, month, year } }, select: { id: true, status: true, payrollDay: true } })
            if (run?.status === "PAID") return refuse("RUN_PAID")
            const settings = await PayrollPeriodService.settings(tx, companyId)
            const period = await PayrollPeriodService.periodOf(tx, companyId, year, month, settings)
            const draft = !run || run.status === "DRAFT"
            // Its attendance's end is fixed once it's approved, whatever the settings say
            // since, and while the month after is approved, which begins the day after
            // (review on PR 430): then only payday changes.
            const next = await tx.payrollRun.findUnique({ where: { companyId_month_year: { companyId, month: after.month, year: after.year } }, select: { status: true } })
            // And once a final settlement counted days after it: moved, its payroll would count
            // them again, or leave out the days between (Codex review on PR 430).
            const settledAfter = await tx.attendanceDay.count({
                where: { companyId, lockedBySettlementId: { not: null }, date: { gt: new Date(`${period.to}T00:00:00Z`), lte: new Date(`${lastDayOf(year, month)}T00:00:00Z`) } },
            })
            const endFixed = !draft || (!!next && next.status !== "DRAFT") || settledAfter > 0
            // While a draft, its attendance may end sooner, never later than the setting's close.
            const settingClose = closeDateOf(year, month, settings.closeDay)
            const until = endFixed ? period.to
                : input.attendanceUntil ?? (input.payday <= settingClose ? addDays(input.payday, -1) : settingClose)
            if (endFixed && input.attendanceUntil && input.attendanceUntil !== period.to) return refuse("PERIOD_FROZEN", { periodEnd: period.to })
            // From the month's own 1st at the earliest: a date is its own month's or the next's,
            // so a period touches two calendar months at most (review on PR 430).
            const firstDay = `${monthKey(year, month)}-01`
            const earliest = period.from > firstDay ? period.from : firstDay
            if (!endFixed && (until < earliest || until > settingClose)) return refuse("ATTENDANCE_OUT_OF_RANGE", { from: earliest, to: settingClose })
            if (input.payday <= until) return refuse("PAYDAY_NOT_AFTER_PERIOD", { periodEnd: until })
            // Within the month after next: far enough for paying in the month after and moving off a long holiday.
            const twoAfter = nextMonth(after.year, after.month)
            if (input.payday > lastDayOf(twoAfter.year, twoAfter.month)) return refuse("PAYDAY_TOO_LATE")
            const data = {
                payday: new Date(`${input.payday}T00:00:00Z`),
                paydayChanged: true,
                // The setting's own close is kept as the setting, so a later change of it still counts.
                ...(draft ? { periodEnd: until === settingClose ? null : new Date(`${until}T00:00:00Z`) } : {}),
            }
            const saved = await tx.payrollRun.upsert({
                where: { companyId_month_year: { companyId, month, year } },
                update: data,
                create: { companyId, month, year, payrollDay: settings.payday.day, ...data },
                select: { id: true },
            })
            const { AuditLogService } = await import("./audit-log.service")
            await AuditLogService.log("CHANGE_PAYROLL_PAYDAY", "PAYROLL", saved.id, {
                tx,
                userId: session?.user?.role !== "SUPER_ADMIN" ? session?.user?.id ?? null : null,
                superAdminId: session?.user?.role === "SUPER_ADMIN" ? session.user.id : null,
                details: { companyId, month, year, payday: input.payday, attendanceUntil: until },
            })
            return { payday: input.payday, periodEnd: until }
        }, LOCK_WAIT)
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
        const [{ register, refused, attendance, period: seen, timeZone: zone }, existing, payday] = await Promise.all([
            this.compute(companyId, year, month),
            prisma.payrollRun.findUnique({
                where: { companyId_month_year: { companyId, month, year } },
            }),
            // This month's own payday, one changed for it included (Codex review on PR 430).
            PayrollPeriodService.paydayOf(prisma, companyId, year, month),
        ])

        // Days still incomplete or a departure to confirm, for the people on
        // the register, once attendance reaches the month's payroll
        // (ATTENDANCE_PLAN.md §6.9, decision 14, PR 276): from the days as
        // stored here, and again inside the transaction below.
        const onRegister = register.entries.filter(e => !e.excluded).map(e => e.userId)
        const stored = attendance.reachesPayroll && (existing?.status ?? "DRAFT") === "DRAFT"
            ? await daysToSettle(prisma, companyId, seen, onRegister)
            : null
        const settle = stored ? waitingOf(stored) : { count: 0, names: [] }

        const verdict = checkApproval({
            status: (existing?.status ?? "DRAFT") as "DRAFT" | "APPROVED" | "PAID",
            refused,
            pendingDecisions: register.pendingDecisions,
            acknowledgePending: options.acknowledgePending === true,
            includedCount: register.includedCount,
            daysToSettle: settle,
            // Not before its period has ended, and never with a payday before the close (§7.10, PR 430).
            period: { to: seen.to, today: calendarDateStr(new Date(), zone) },
            paydayAfterClose: payday.date > seen.to,
        })
        if (!verdict.ok) return { refusal: verdict.refusal }

        const { timeZone } = await this.policy(companyId)
        const { AttendanceEngineService } = await import("./attendance-engine.service")

        // One transaction, in this order (ATTENDANCE_PLAN.md §12.1): take the
        // month's lock; settle the overtime nobody decided; rebuild the month's
        // attendance a last time; compute the payslips from it and write them;
        // write attendance's entries; stamp the days; approve. Either all of it
        // happened or none of it did, and a punch, a request or a recompute for
        // the month waits for the lock and is then refused — it can never land
        // between the figures being computed and the month being frozen.
        try {
            return await prisma.$transaction(async (tx) => {
                const key = monthKey(year, month)
                // Its own payroll month's lock and the next's: a date near the
                // close belongs to one or the other (§7.10, PR 430).
                const after = nextMonth(year, month)
                await lockMonths(tx, companyId, [key, monthKeyOf(after.year, after.month)])
                const current = await tx.payrollRun.findUnique({ where: { companyId_month_year: { companyId, month, year } }, select: { status: true } })
                if (current && current.status !== "DRAFT") throw new Error("RUN_NOT_DRAFT")
                // The switch, read once and held (review on #16): FOR SHARE makes a
                // concurrent change to it wait for this approval, and that change
                // then sees the month approved. Everything below uses this reading.
                // Taken before the period is read: the Payroll settings are on the
                // same row, and saving them takes no month lock (Codex review on PR 430).
                const [{ attendancePayrollFrom }] = await tx.$queryRaw<{ attendancePayrollFrom: Date | null }[]>`
                    SELECT "attendancePayrollFrom" FROM "Company" WHERE id = ${companyId} FOR SHARE`
                // The period again, now that nothing can change it: a payday changed
                // since the look above moves it, and this one is what's approved,
                // checked again (review on PR 430).
                const period = await PayrollPeriodService.periodOf(tx, companyId, year, month)
                const today = calendarDateStr(new Date(), timeZone)
                if (today <= period.to) {
                    const from = addDays(period.to, 1)
                    return { refusal: { code: "PERIOD_NOT_OVER" as const, message: `This month can be approved from ${from}, once its payroll closes.`, from } }
                }
                // Its payday, read again here too: one changed for the month stays where it's put,
                // and a close moved since can put the period past it (Codex review on PR 430).
                const payday = await PayrollPeriodService.paydayOf(tx, companyId, year, month)
                if (payday.date <= period.to) return { refusal: { code: "PAYDAY_BEFORE_CLOSE" as const, message: PAYDAY_BEFORE_CLOSE } }

                const approverId: string = session?.user?.id ?? "system"
                const reaches = attendanceReaches(attendancePayrollFrom, year, month)
                let overtimeRejected = 0
                if (reaches) {
                    // Rebuilt first, so overtime on days whose stored row was stale
                    // or missing is found and refused too; then rebuilt again so the
                    // money reflects those refusals (review on #16).
                    // The calendar months its period touches, each rebuilt; days
                    // another approval froze stay as they were paid.
                    const touched = [...new Set([period.from.slice(0, 7), period.to.slice(0, 7)])]
                    for (const m of touched) await AttendanceEngineService.recomputeMonthIn(tx, companyId, m, timeZone, today)
                    // Checked again on the month as just rebuilt, before anything of
                    // the approval is written (PR 276): a day whose stored row was
                    // out of date waits too. Refused, the recompute is kept, as any
                    // recompute's would be, and nothing else is written.
                    const still = await daysToSettle(tx, companyId, period, onRegister)
                    if (still.count > 0) return { refusal: settleRefusal(waitingOf(still)) }
                    overtimeRejected = await rejectPendingOvertime(tx, companyId, period, approverId)
                    if (overtimeRejected > 0) for (const m of touched) await AttendanceEngineService.recomputeMonthIn(tx, companyId, m, timeZone, today)
                }
                const { register: final, payrollDay } = await this.compute(companyId, year, month, tx, reaches)
                // The register being approved, read again here, can hold somebody the
                // one read before didn't, such as someone put back on the payroll
                // meanwhile: their days are checked too (review on PR 276). Found
                // waiting, everything above is undone, the overtime rejected among it.
                if (reaches) {
                    const unchecked = final.entries.filter(e => !e.excluded && !onRegister.includes(e.userId)).map(e => e.userId)
                    const late = unchecked.length ? await daysToSettle(tx, companyId, period, unchecked) : null
                    if (late && late.count > 0) throw new SettleRefused(settleRefusal(waitingOf(late)))
                }
                const draft = await this.writeDraft(tx, companyId, year, month, final, payrollDay)
                const people = final.entries.map(e => ({ userId: e.userId, excluded: e.excluded, attendance: attendanceOf(e.lines) }))
                const entries = reaches ? await reconcileEntries(tx, companyId, year, month, draft.id, people) : null
                // The days are frozen with a mission allowance only for those these
                // payslips paid one: nobody, when attendance doesn't reach this
                // payroll (review on PR 288).
                const allowancePaidTo = reaches ? people.filter(p => !p.excluded && p.attendance.missionAllowance > 0).map(p => p.userId) : []
                const daysLocked = await stampDays(tx, companyId, period, draft.id, allowancePaidTo)
                // What the month keeps: its period and its payday, both read
                // above, so a later change of either setting never restates it
                // (§7.10, PR 430).

                const run = await tx.payrollRun.update({
                    where: { companyId_month_year: { companyId, month, year } },
                    data: {
                        status: "APPROVED",
                        attendanceIncluded: reaches,
                        periodStart: new Date(`${period.from}T00:00:00Z`),
                        periodEnd: new Date(`${period.to}T00:00:00Z`),
                        payday: new Date(`${payday.date}T00:00:00Z`),
                        approvedAt: new Date(),
                        approvedById: session?.user?.id ?? null,
                    },
                    include: { payslips: { include: { lines: true } } },
                })

                // Recovery: what this run took back, applied to the debts it took it
                // from. Driven off the stored payslip lines rather than recomputed,
                // so the money moved and the record of it moving cannot disagree —
                // the line on somebody's payslip is the claim, and this is that same
                // claim being honoured.
                //
                // Before the carry loop below, deliberately. A debt raised by this
                // month is due on this month's payday and could otherwise be read as
                // already collectable by the very run that created it.
                for (const payslip of run.payslips) {
                    if (payslip.excluded) continue
                    for (const line of payslip.lines) {
                        if (line.source !== DEBT_RECOVERY_SOURCE || !line.sourceId) continue

                        const debt = await tx.debt.findUnique({ where: { id: line.sourceId } })
                        // Gone or already settled between the draft and now. Skipped
                        // rather than failed: the payslip is already correct about
                        // what was deducted, and refusing the whole approval over one
                        // stale row would hold up everybody else's pay.
                        if (!debt || debt.status !== "OUTSTANDING") continue

                        const recovered = Number(debt.recoveredAmount) + Number(line.amount)
                        const settled = recovered >= Number(debt.amount)
                        await tx.debt.update({
                            where: { id: debt.id },
                            data: {
                                recoveredAmount: recovered,
                                ...(settled && { status: "SETTLED", settledAt: new Date() }),
                            },
                        })
                    }
                }

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
                            dueDate: startOfDayIn(new Date(`${payday.date}T12:00:00Z`), timeZone),
                        },
                    })
                }

                // Settlements waiting on a run, now carried by this one. Attached by
                // due date rather than by the month somebody left in: a person who
                // left in March with an April due date is April's to pay. Due on or
                // before this run's payday, not its calendar month's end: paid in the
                // month after, November's carries one due on 1 December (review on PR 430).
                const carriedSettlements = await tx.finalSettlement.updateMany({
                    where: {
                        companyId,
                        status: "PENDING",
                        payrollRunId: null,
                        dueDate: { lt: startOfDayIn(new Date(`${addDays(payday.date, 1)}T12:00:00Z`), timeZone) },
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
                        payable: toMajor(final.payableMinor),
                        attendance: reaches ? { entries: entries?.written ?? 0, overtimeRejected, daysLocked } : null,
                        settlementsCarried: carriedSettlements.count,
                        pendingAcknowledged: final.pendingDecisions.map(p => p.name),
                    },
                })

                return { runId: run.id }
            }, { timeout: 120_000 })
        } catch (error) {
            if (error instanceof SettleRefused) return { refusal: error.refusal }
            throw error
        }
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

/** What attendance put on one payslip, read back from its lines: exactly what is paid. */
function attendanceOf(lines: { source: string; sourceId?: string | null; amountMinor: number }[]) {
    const of = (category: string) => lines.filter(l => l.source === ATTENDANCE_SOURCE && l.sourceId === category).reduce((s, l) => s + l.amountMinor, 0)
    return { lateness: of("LATENESS"), earlyLeave: of("EARLY_LEAVE"), absence: of("ABSENCE"), overtime: of("OVERTIME"), missionAllowance: of("MISSION_ALLOWANCE") }
}

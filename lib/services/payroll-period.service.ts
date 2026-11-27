import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { addDays, observedHolidays, toDateString, type WorkWeekChange } from "@/lib/attendance/calendar"
import { AttendancePolicyService } from "./attendance-policy.service"
import {
    closeDateOf, dayOffOn, monthKeyOf, movePayday, nextMonth, nominalPayday, payrollMonthOf, periodBetween, previousMonth,
    type PaydaySetting, type Period,
} from "@/lib/payroll-period"

/**
 * What a company's payday and its months' periods are, read from the database
 * (LATER_CHANGES_PLAN.md §7.10, PR 430). The rules are lib/payroll-period.ts;
 * this reads what they need: the settings, the runs that keep their own close
 * and payday, the work week by the policy in force, and the holidays.
 */

type Db = Prisma.TransactionClient | typeof prisma

/** A date as the database keeps a DATE: midnight UTC. */
const wallClock = (local: string) => new Date(`${local}Z`)

export type PayrollSettings = { closeDay: number | null; payday: PaydaySetting }

/** A month as a year and its number. */
type Month = { year: number; month: number }
const keyOf = (m: Month) => monthKeyOf(m.year, m.month)
const monthOfDate = (date: string): Month => ({ year: Number(date.slice(0, 4)), month: Number(date.slice(5, 7)) })

/** The days either side of payday a move may reach, read once. */
const MOVE_REACH = 60

export class PayrollPeriodService {
    static async settings(db: Db, companyId: string): Promise<PayrollSettings> {
        const c = await db.company.findUnique({
            where: { id: companyId },
            select: { payrollCloseDay: true, payrollDay: true, paydayLastDay: true, paydayNextMonth: true, paydayMove: true },
        })
        if (!c) throw new Error("COMPANY_NOT_FOUND")
        return {
            closeDay: c.payrollCloseDay,
            payday: { day: c.payrollDay, lastDay: c.paydayLastDay, nextMonth: c.paydayNextMonth, move: c.paydayMove },
        }
    }

    /**
     * Each month's close: its run's own where it keeps one (an approved month
     * always does, a draft once its payday was changed with it), otherwise by
     * the setting.
     */
    static async closes(db: Db, companyId: string, months: readonly Month[], settings?: PayrollSettings): Promise<Map<string, string>> {
        const wanted = [...new Map(months.map(m => [keyOf(m), m])).values()]
        const out = new Map<string, string>()
        if (wanted.length === 0) return out
        const { closeDay } = settings ?? await this.settings(db, companyId)
        const runs = await db.payrollRun.findMany({
            where: { companyId, periodEnd: { not: null }, OR: wanted.map(m => ({ year: m.year, month: m.month })) },
            select: { year: true, month: true, periodEnd: true },
        })
        const kept = new Map(runs.map(r => [monthKeyOf(r.year, r.month), toDateString(r.periodEnd!)]))
        for (const m of wanted) out.set(keyOf(m), kept.get(keyOf(m)) ?? closeDateOf(m.year, m.month, closeDay))
        return out
    }

    /** A month's attendance days: from the day after the month before's close to its own. */
    static async periodOf(db: Db, companyId: string, year: number, month: number, settings?: PayrollSettings): Promise<Period> {
        const before = previousMonth(year, month)
        const closes = await this.closes(db, companyId, [before, { year, month }], settings)
        return periodBetween(closes.get(keyOf(before))!, closes.get(monthKeyOf(year, month))!)
    }

    /** The payroll month each date belongs to ('YYYY-MM'). */
    static async payrollMonthsOf(db: Db, companyId: string, dates: readonly string[]): Promise<Map<string, string>> {
        const closes = await this.closes(db, companyId, dates.map(monthOfDate))
        return new Map(dates.map(d => [d, payrollMonthOf(d, (y, m) => closes.get(monthKeyOf(y, m))!)]))
    }

    /** The payroll months these dates fall in, each once. */
    static async monthsOfDates(db: Db, companyId: string, dates: Iterable<string>): Promise<string[]> {
        const list = [...new Set(dates)]
        if (list.length === 0) return []
        return [...new Set((await this.payrollMonthsOf(db, companyId, list)).values())]
    }

    /**
     * Whether a date is a day off for the company: a weekend day by the
     * attendance policy in force that day (Friday and Saturday without one),
     * a public holiday it observes, or one of its own.
     */
    static async dayOff(db: Db, companyId: string, from: string, to: string): Promise<(date: string) => boolean> {
        const range = { gte: wallClock(`${from}T00:00:00`), lte: wallClock(`${to}T00:00:00`) }
        const [versions, central, exclusions, own, publicChanges] = await Promise.all([
            AttendancePolicyService.versions(companyId, db as Prisma.TransactionClient),
            db.publicHoliday.findMany({ where: { country: "EG", date: range }, select: { id: true, date: true, name: true } }),
            db.companyHolidayExclusion.findMany({ where: { companyId }, select: { publicHolidayId: true } }),
            db.companyHoliday.findMany({ where: { companyId, date: range }, select: { id: true, date: true, name: true, isPaid: true } }),
            db.publicHolidaysChange.findMany({ where: { companyId }, select: { effectiveFrom: true, apply: true } }),
        ])
        const weeks: WorkWeekChange[] = versions.map(v => ({ effectiveFrom: v.effectiveFrom, workWeek: v.body.workWeek }))
        const holidays = new Set(observedHolidays(
            central.map(h => ({ id: h.id, date: toDateString(h.date), name: h.name })),
            new Set(exclusions.map(e => e.publicHolidayId)),
            own.map(h => ({ id: h.id, date: toDateString(h.date), name: h.name, isPaid: h.isPaid })),
            from, to,
            publicChanges.map(c => ({ effectiveFrom: toDateString(c.effectiveFrom), apply: c.apply })),
        ).keys())
        return date => dayOffOn(date, { weeks, holidays })
    }

    /**
     * A month's payday: its run's where it's approved or was changed for it,
     * otherwise as set, moved off a day off, never back into the period.
     */
    static async paydayOf(db: Db, companyId: string, year: number, month: number, settings?: PayrollSettings): Promise<{ date: string; changed: boolean }> {
        const run = await db.payrollRun.findUnique({
            where: { companyId_month_year: { companyId, month, year } },
            select: { payday: true, paydayChanged: true, status: true },
        })
        if (run?.payday && (run.status !== "DRAFT" || run.paydayChanged)) return { date: toDateString(run.payday), changed: run.paydayChanged }
        const set = settings ?? await this.settings(db, companyId)
        const nominal = nominalPayday(year, month, set.payday)
        const close = (await this.closes(db, companyId, [{ year, month }], set)).get(monthKeyOf(year, month))!
        const isDayOff = await this.dayOff(db, companyId, addDays(nominal, -MOVE_REACH), addDays(nominal, MOVE_REACH))
        return { date: movePayday(nominal, set.payday.move, isDayOff, close), changed: false }
    }

    /** The first payday on or after a date: a debt's due date, and when a settlement made then is paid. */
    static async nextPaydayOnOrAfter(db: Db, companyId: string, date: string): Promise<string> {
        const settings = await this.settings(db, companyId)
        const own = monthOfDate(date)
        let month = previousMonth(own.year, own.month)
        // Paid in the month after, the month before's payday falls in this one.
        for (let i = 0; i < 4; i++) {
            const { date: payday } = await this.paydayOf(db, companyId, month.year, month.month, settings)
            if (payday >= date) return payday
            month = nextMonth(month.year, month.month)
        }
        return (await this.paydayOf(db, companyId, month.year, month.month, settings)).date
    }
}

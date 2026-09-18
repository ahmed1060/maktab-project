import { toMinor, type Minor } from "./payroll"

/**
 * Which number is the answer to "what did this month pay".
 *
 * There were two, and that is the fault this file exists to end. The payslip
 * came from lib/payroll.ts — employment timeline, per-segment rates, floored
 * net, debt recovery. The employee history screen computed its own, inline in
 * JSX, as base ÷ days × payable days: a flat rate over a flat month, blind to
 * every one of those. For an ordinary month they agree. For any month worth
 * looking at — somebody hired on the 10th, a raise on the 16th, a suspension, a
 * debt being recovered — they disagree, and nothing said which to believe.
 *
 * P0 removed two clocks. P9 removed two bounds on what a day is. This removes
 * two calculations, which is the same fault one level up and the one neither of
 * them looked at.
 *
 * The estimate survives, because months before payroll existed have no payslip
 * and a blank cell is worse than an approximation. What changes is that it is
 * named an estimate, computed in one tested place rather than in a template,
 * and never shown in preference to a real payslip.
 */

/** A stored SalaryRecord, as the history screen receives it. */
export interface SalaryRecordLike {
    month: number
    year: number
    totalDays: number
    deductions: number
    bonusDays: number
    baseSalary: number
}

/** A payslip for that month, where payroll has produced one. */
export interface PayslipLike {
    id: string
    year: number
    month: number
    status: "APPROVED" | "PAID"
    netMinor: Minor
}

export type SalaryFigure =
    | { source: "PAYSLIP"; netMinor: Minor; payslipId: string; status: "APPROVED" | "PAID" }
    | { source: "ESTIMATE"; netMinor: Minor }

/**
 * The old arithmetic, moved out of the page and given a name that says what it
 * is worth.
 *
 * Deliberately unchanged: this is what that screen has always shown, and
 * quietly improving it would rewrite history for every month somebody has
 * already read. It is wrong in the ways described above; it is the best that
 * can be said about a month payroll never ran.
 */
export function estimateNetMinor(record: SalaryRecordLike): Minor {
    const base = record.baseSalary
    if (!(base > 0) || !(record.totalDays > 0)) return 0
    const payableDays = record.totalDays - record.deductions + (record.bonusDays || 0)
    // Never negative: more deductions than days is a debt, and a debt is the
    // payroll path's business, not this screen's.
    if (payableDays <= 0) return 0
    return toMinor((base / record.totalDays) * payableDays)
}

/**
 * A payslip wins whenever there is one.
 *
 * Approved counts as well as paid: approval is the moment the figure stops
 * moving, and showing an estimate beside an approved payslip would mean the
 * screen disagreed with a document somebody has already been sent.
 */
export function figureFor(record: SalaryRecordLike, payslip: PayslipLike | null | undefined): SalaryFigure {
    if (payslip && payslip.year === record.year && payslip.month === record.month) {
        return {
            source: "PAYSLIP",
            netMinor: payslip.netMinor,
            payslipId: payslip.id,
            status: payslip.status,
        }
    }
    return { source: "ESTIMATE", netMinor: estimateNetMinor(record) }
}

/** Index payslips by period, so a history of sixty months is one pass. */
export function byPeriod(payslips: PayslipLike[]): Map<string, PayslipLike> {
    return new Map(payslips.map(p => [`${p.year}-${p.month}`, p]))
}

export function periodKey(record: { year: number; month: number }): string {
    return `${record.year}-${record.month}`
}

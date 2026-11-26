import { isDateString } from "@/lib/attendance/calendar"
import { localToInstant } from "@/lib/attendance/punch-import"
import type { TranslationKey } from "@/lib/translations"

/**
 * The contract start date (LATER_CHANGES_PLAN.md §7.2, step 1): when
 * someone's job with the company began, which their hiring is dated, and
 * their starting salary with it. Attendance builds days, and payroll pays,
 * only from it.
 *
 * What changing it does is worked out here before anything is written, so
 * the service only checks the months it touches and writes what this says.
 */

/**
 * The dates a change to someone's start was between, from its log line's
 * details: the nightly run rebuilds from the earlier, as the change moves
 * their rows where they are, and their createdAt says nothing of it
 * (review on PR 425).
 */
export function startMovedBetween(details: unknown): string[] {
    const { from, to } = (details ?? {}) as { from?: unknown; to?: unknown }
    return [from, to].filter((date): date is string => isDateString(date))
}

/** The same date a year away, the 29th of February falling on the 28th. */
function yearAway(date: string, years: number): string {
    const year = Number(date.slice(0, 4)) + years
    const monthDay = date.slice(5)
    const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0
    return `${year}-${monthDay === "02-29" && !leap ? "02-28" : monthDay}`
}

/**
 * The days a contract may start on: from a year back, as far as attendance
 * is ever worked out again (reworkFloor), to a year ahead of today in the
 * company's calendar.
 */
export function contractStartRange(today: string): { min: string; max: string } {
    return { min: yearAway(today, -1), max: yearAway(today, 1) }
}

/** The first instant of a date in a zone: when a contract starting on it starts. */
export function startOfDate(date: string, timeZone: string): Date {
    return localToInstant(`${date}T00:00:00`, timeZone)
}

/** A real date, within the days a contract may start on. */
export function inContractStartRange(date: unknown, today: string): date is string {
    if (!isDateString(date)) return false
    const { min, max } = contractStartRange(today)
    return date >= min && date <= max
}

export type ContractStartRefusal = "NO_CONTRACT_START" | "CONTRACT_START_SAME" | "CONTRACT_START_AFTER_CHANGE"

export type ContractStartPlan =
    | { ok: true; hireId: string; from: Date; moveSalaryIds: string[] }
    | { ok: false; refusal: ContractStartRefusal }

/**
 * What moving someone's contract start to `to` does.
 *
 * The start is their first hiring. It may move earlier freely, and later
 * only while nothing else is recorded about their job, or their salary
 * changed, on or before the new date: that would be before their contract.
 *
 * Their starting salary moves with it where it's their first salary and
 * dated the start, as it's written when an account is made, with any
 * correction dated the same. Where their first salary is later than the new
 * start, it moves to it, so a salary is in force from the first day. A
 * salary history that starts earlier, dated back by hand, stays as it is.
 */
export function planContractStart(input: {
    to: Date
    events: readonly { id: string; type: string; effectiveFrom: Date }[]
    salaries: readonly { id: string; effectiveFrom: Date; createdAt: Date }[]
}): ContractStartPlan {
    const hires = input.events.filter(e => e.type === "HIRED").sort((a, b) => a.effectiveFrom.getTime() - b.effectiveFrom.getTime())
    const hire = hires[0]
    if (!hire) return { ok: false, refusal: "NO_CONTRACT_START" }
    const from = hire.effectiveFrom.getTime()
    const to = input.to.getTime()
    if (to === from) return { ok: false, refusal: "CONTRACT_START_SAME" }

    if (input.events.some(e => e.id !== hire.id && e.effectiveFrom.getTime() <= to)) return { ok: false, refusal: "CONTRACT_START_AFTER_CHANGE" }
    if (input.salaries.some(s => s.effectiveFrom.getTime() > from && s.effectiveFrom.getTime() <= to)) return { ok: false, refusal: "CONTRACT_START_AFTER_CHANGE" }

    const first = Math.min(...input.salaries.map(s => s.effectiveFrom.getTime()))
    const moving = first === from || (input.salaries.length > 0 && to < first) ? first : null
    const moveSalaryIds = moving === null ? [] : input.salaries
        .filter(s => s.effectiveFrom.getTime() === moving)
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
        .map(s => s.id)
    return { ok: true, hireId: hire.id, from: hire.effectiveFrom, moveSalaryIds }
}

/** What a refusal's code says, in the reader's language: under the date where it's chosen. */
const REFUSAL_WORDS: Record<string, TranslationKey> = {
    CONTRACT_START_OUT_OF_RANGE: "contract_start_out_of_range",
    CONTRACT_START_SAME: "contract_start_same",
    CONTRACT_START_AFTER_CHANGE: "contract_start_after_change",
    PAYROLL_MONTH_LOCKED: "contract_start_payroll_locked",
    NO_CONTRACT_START: "contract_start_none",
}

/**
 * The words for a refusal of a contract start date, or null for one that
 * isn't about it. Someone new is refused a month whose payroll is approved
 * as a month, not as one between two dates.
 */
export function contractStartRefusal(code: unknown, { creating = false }: { creating?: boolean } = {}): TranslationKey | null {
    if (typeof code !== "string") return null
    if (creating && code === "PAYROLL_MONTH_LOCKED") return "contract_start_month_locked"
    return REFUSAL_WORDS[code] ?? null
}

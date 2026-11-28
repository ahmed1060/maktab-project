/**
 * Asking for a salary advance (LATER_CHANGES_PLAN.md §7.5, step 3a; DESIGN.md
 * §5.5, Asking for a salary advance): money lent ahead of the salary and paid
 * back from payslips with no interest. Its installments, the limits measured
 * against the net pay, and what's said under each field.
 *
 * Pure, and safe for the dialog to import: what the dialog says is what the
 * server refuses, as the server checks it all again by these same rules.
 */

import { recoverableFrom } from "./debt-recovery"
import { deductionLines, figure, percentOf, type PayrollDeductionRule } from "./payroll-deductions"
import type { Minor } from "./payroll"
import type { SalaryAdvanceOverLimit } from "./salary-advance-policy"

/** The months it may be paid back over. */
export const ADVANCE_MONTHS = { min: 1, max: 24 } as const

/** A payroll month: the month whose payroll an installment is taken in. */
export type PayrollMonth = { year: number; month: number }

export const payrollMonthKey = (m: PayrollMonth) => `${m.year}-${String(m.month).padStart(2, "0")}`

export function payrollMonthOfKey(key: string): PayrollMonth | null {
    const m = /^(\d{4})-(\d{2})$/.exec(key)
    if (!m) return null
    const month = Number(m[2])
    return month >= 1 && month <= 12 ? { year: Number(m[1]), month } : null
}

export const monthAfter = (m: PayrollMonth): PayrollMonth => m.month === 12 ? { year: m.year + 1, month: 1 } : { year: m.year, month: m.month + 1 }

/**
 * The day the months worked first are up: so many months after the
 * contract starts, the same day of the month, or that month's last day
 * where it has fewer. Both are calendar days, "2026-11-15".
 */
export function serviceFrom(contractStart: string, months: number): string {
    const on = Number(contractStart.slice(0, 4)) * 12 + Number(contractStart.slice(5, 7)) - 1 + months
    const year = Math.floor(on / 12), month = on % 12 + 1
    const last = new Date(Date.UTC(year, month, 0)).getUTCDate()
    const day = Math.min(Number(contractStart.slice(8, 10)), last)
    return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`
}

export type Installment = PayrollMonth & { amountMinor: Minor }

/**
 * Each month's installment: the amount over the months, down to the
 * piastre, and the last taking the rounding, so together they're the
 * amount, and the last is the largest.
 */
export function installmentsOf(amountMinor: Minor, months: number, first: PayrollMonth): Installment[] {
    const each = Math.floor(amountMinor / months)
    const out: Installment[] = []
    let month = first
    for (let i = 0; i < months; i++) {
        out.push({ ...month, amountMinor: i === months - 1 ? amountMinor - each * (months - 1) : each })
        month = monthAfter(month)
    }
    return out
}

/** The largest of them: the last, which takes the rounding. */
export const largestInstallment = (amountMinor: Minor, months: number): Minor => amountMinor - Math.floor(amountMinor / months) * (months - 1)

/**
 * The net pay the limits are measured against, the owner's choice (27
 * November): the monthly salary less the payroll deductions, their own
 * where they have them, as a payslip takes them from it. Known before the
 * month's attendance, and the same each month.
 */
export function netPayOf(salaryMinor: Minor, rules: PayrollDeductionRule[]): Minor {
    const taken = deductionLines(salaryMinor, rules).reduce((sum, line) => sum + line.amountMinor, 0)
    return Math.max(0, salaryMinor - taken)
}

/**
 * A month of their other debts: what's still owed on their debts, as much
 * of it as a payslip takes back by the company's share for debts, and the
 * installments of their other salary advances still open.
 */
export function otherDebtsOf(input: { owedMinor: Minor; netMinor: Minor; recoveryPercent: number; installmentsMinor: Minor }): Minor {
    return Math.min(Math.max(0, input.owedMinor), recoverableFrom(input.netMinor, input.recoveryPercent)) + Math.max(0, input.installmentsMinor)
}

/** Why one can't be asked for, in place of the form. */
export type AdvanceClosed =
    /** Before the months worked first are up: they are, and from when it may be asked for. */
    | { reason: "SERVICE"; months: number; from: string }
    /** Only one at a time, and another is open: waiting, or being paid back. */
    | { reason: "OPEN"; status: "PENDING" | "APPROVED" }
    | { reason: "NO_SALARY" }
    | { reason: "NO_NET" }
    /** With Block, their other debts already take what all debts together may. */
    | { reason: "DEBTS"; percent: number }

/** What asking offers, as the server works it out for one person. */
export interface AdvanceOffer {
    closed: AdvanceClosed | null
    salaryMinor: Minor
    netMinor: Minor
    otherDebtsMinor: Minor
    /** The most one may ask for: the policy's months of the salary. */
    maxAmountMinor: Minor
    maxMonths: number
    installmentPercent: number
    debtsPercent: number
    overLimit: SalaryAdvanceOverLimit
    /** The payroll months the first installment may be in: this month's and next, or next alone. */
    firsts: PayrollMonth[]
    /** This month, where its payroll is approved, so next month's alone is offered. */
    approved: PayrollMonth | null
}

/** The most one may ask for: so many months of the salary, half up to the piastre. */
export const maxAmountOf = (salaryMinor: Minor, maxMonths: number): Minor => percentOf(salaryMinor, maxMonths * 100)

/**
 * The most an installment may be by the limits, and which limit decides:
 * its own share of the net pay, or what all debts together leave of theirs
 * after the other debts.
 */
export function installmentLimit(offer: Pick<AdvanceOffer, "netMinor" | "otherDebtsMinor" | "installmentPercent" | "debtsPercent">): { capMinor: Minor; by: "INSTALLMENT" | "DEBTS" } {
    const own = percentOf(offer.netMinor, offer.installmentPercent)
    const debts = Math.max(0, percentOf(offer.netMinor, offer.debtsPercent) - offer.otherDebtsMinor)
    return debts < own ? { capMinor: debts, by: "DEBTS" } : { capMinor: own, by: "INSTALLMENT" }
}

/** The fewest months whose largest installment the limit allows, or none where 24 can't. */
export function leastMonths(amountMinor: Minor, capMinor: Minor): number | null {
    for (let months = ADVANCE_MONTHS.min; months <= ADVANCE_MONTHS.max; months++) {
        if (largestInstallment(amountMinor, months) <= capMinor) return months
    }
    return null
}

/** The most the limits let 24 months pay back: each installment at the limit. */
export const mostPayable = (capMinor: Minor): Minor => capMinor * ADVANCE_MONTHS.max

/** The dialog's fields as typed. `first` is the payroll month's key, "2026-12". */
export interface AdvanceDraft {
    amount: string
    months: string
    first: string
}

export type AdvanceErrorKey =
    | "salary_advance_ask_amount_invalid" | "salary_advance_ask_amount_over" | "salary_advance_ask_amount_unpayable"
    | "salary_advance_ask_months_invalid" | "salary_advance_ask_months_few"
    | "salary_advance_ask_first_invalid"

export interface AdvanceCheck {
    errors: Partial<Record<keyof AdvanceDraft, AdvanceErrorKey>>
    /** As typed, once each is right as typed, whatever the limits say; 0 otherwise. */
    amountMinor: Minor
    months: number
    /** Which limit each installment is over: with Warn it may be sent so, and says so. */
    over: { installment: boolean; debts: boolean }
}

// Above 0 with up to two decimals, as a Decimal(12, 2) holds it.
const AMOUNT = /^\d{1,10}(\.\d{1,2})?$/
const WHOLE = /^\d{1,2}$/

/**
 * What's wrong with what's typed, under each field, and which limit it's
 * over. The amount above 0 and no more than the most one may ask for; the
 * months a whole number from 1 to 24; the first installment one of those
 * offered. With Block, fewer months than the limits allow are refused, and
 * an amount 24 months can't pay back within them is refused under the
 * amount; with Warn, they may be sent.
 */
export function advanceCheck(draft: AdvanceDraft, offer: AdvanceOffer): AdvanceCheck {
    const errors: AdvanceCheck["errors"] = {}
    const amountText = figure(draft.amount)
    const amountMinor = AMOUNT.test(amountText) ? Math.round(Number(amountText) * 100) : 0
    if (amountMinor <= 0) errors.amount = "salary_advance_ask_amount_invalid"
    else if (amountMinor > offer.maxAmountMinor) errors.amount = "salary_advance_ask_amount_over"

    const monthsText = figure(draft.months)
    const months = WHOLE.test(monthsText) ? Number(monthsText) : 0
    if (months < ADVANCE_MONTHS.min || months > ADVANCE_MONTHS.max) errors.months = "salary_advance_ask_months_invalid"

    if (!offer.firsts.some(m => payrollMonthKey(m) === draft.first)) errors.first = "salary_advance_ask_first_invalid"

    const over = { installment: false, debts: false }
    // Right as typed, whatever the limits say of it.
    const right = !errors.amount && !errors.months
    if (right) {
        const largest = largestInstallment(amountMinor, months)
        over.installment = largest > percentOf(offer.netMinor, offer.installmentPercent)
        over.debts = largest + offer.otherDebtsMinor > percentOf(offer.netMinor, offer.debtsPercent)
        if (offer.overLimit === "BLOCK" && (over.installment || over.debts)) {
            if (leastMonths(amountMinor, installmentLimit(offer).capMinor) === null) errors.amount = "salary_advance_ask_amount_unpayable"
            else errors.months = "salary_advance_ask_months_few"
        }
    }
    return { errors, amountMinor: right ? amountMinor : 0, months: right ? months : 0, over }
}

/** An amount as the language writes it, with two decimals: "10,000.00", «١٠٬٠٠٠٫٠٠». */
export function moneyText(minor: Minor, locale: string): string {
    return (minor / 100).toLocaleString(locale === "ar" ? "ar-EG" : "en-EG", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

/**
 * The consent, which the law asks for in writing, as the dialog shows it
 * and the request keeps it: the words, with the amount in the language's
 * digits.
 */
export function consentWords(dict: { salary_advance_consent: string }, amountMinor: Minor, locale: string): string {
    return dict.salary_advance_consent.replace("{amount}", moneyText(amountMinor, locale))
}

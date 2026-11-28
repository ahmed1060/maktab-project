/**
 * The rules a salary advance follows (LATER_CHANGES_PLAN.md §7.5, step 2;
 * DESIGN.md §5.5, Salary advances): how much one may ask for, after how long,
 * whether only one at a time, the most an installment and all debts together
 * may take of a month's net pay, and what happens over a limit.
 *
 * Pure, and safe for the settings card to import: what the card says is
 * wrong is what the server refuses. Nothing reads these yet; asking for one
 * comes in step 3.
 */

import { figure } from "./payroll-deductions"

export type SalaryAdvanceOverLimit = "BLOCK" | "WARN"
export const SALARY_ADVANCE_OVER_LIMIT: readonly SalaryAdvanceOverLimit[] = ["BLOCK", "WARN"]

export interface SalaryAdvancePolicy {
    /** The most one may ask for, in months of their salary. */
    maxMonths: number
    /** How long someone must have worked first, from their contract's start. */
    minServiceMonths: number
    /** Whether another may be asked for while one is being paid back. */
    oneOpen: boolean
    /** The most an installment may take of a month's net pay after the payroll deductions. */
    installmentPercent: number
    /** The most an installment and the recovery of their other debts may take together, of the same net pay. */
    debtsPercent: number
    /** Over either limit: kept from going over, or sent with a warning. */
    overLimit: SalaryAdvanceOverLimit
}

/**
 * As every company has them until it changes them: 10% and 25% are what
 * Egypt's labour law allows (articles 113 and 114, §7.9).
 */
export const SALARY_ADVANCE_POLICY_DEFAULTS: SalaryAdvancePolicy = {
    maxMonths: 2, minServiceMonths: 3, oneOpen: true, installmentPercent: 10, debtsPercent: 25, overLimit: "BLOCK",
}

export const MAX_MONTHS_LOW = 0.5
export const MAX_MONTHS_HIGH = 12
export const MAX_SERVICE_MONTHS = 120

/** The card's figures as typed. */
export interface SalaryAdvancePolicyDraft {
    maxMonths: string
    minServiceMonths: string
    oneOpen: boolean
    installmentPercent: string
    debtsPercent: string
    overLimit: SalaryAdvanceOverLimit
}

export type SalaryAdvancePolicyErrorKey =
    | "salary_advance_months_invalid" | "salary_advance_service_invalid"
    | "salary_advance_percent_invalid" | "salary_advance_debts_below"

export type SalaryAdvancePolicyErrors = Partial<Record<"maxMonths" | "minServiceMonths" | "installmentPercent" | "debtsPercent", SalaryAdvancePolicyErrorKey>>

// Up to two decimals, as a Decimal(4, 2) and a Decimal(5, 2) hold them.
const MONTHS = /^\d{1,2}(\.\d{1,2})?$/
const PERCENT = /^\d{1,3}(\.\d{1,2})?$/
const WHOLE = /^\d{1,3}$/

const validMonths = (text: string) => {
    const t = figure(text)
    return MONTHS.test(t) && Number(t) >= MAX_MONTHS_LOW && Number(t) <= MAX_MONTHS_HIGH
}
const validService = (text: string) => {
    const t = figure(text)
    return WHOLE.test(t) && Number(t) <= MAX_SERVICE_MONTHS
}
const validPercent = (text: string) => {
    const t = figure(text)
    return PERCENT.test(t) && Number(t) >= 1 && Number(t) <= 100
}

/**
 * What's wrong with the card's figures, each under its own field: months
 * from 0.5 to 12 and percentages from 1 to 100, each with up to two
 * decimals; the months worked first a whole number from 0 to 120; and all
 * debts together never below an installment's, as an installment alone
 * would then be over it. Nothing wrong is `{}`.
 */
export function salaryAdvancePolicyErrors(draft: SalaryAdvancePolicyDraft): SalaryAdvancePolicyErrors {
    const errors: SalaryAdvancePolicyErrors = {}
    if (!validMonths(draft.maxMonths)) errors.maxMonths = "salary_advance_months_invalid"
    if (!validService(draft.minServiceMonths)) errors.minServiceMonths = "salary_advance_service_invalid"
    const installment = validPercent(draft.installmentPercent)
    if (!installment) errors.installmentPercent = "salary_advance_percent_invalid"
    if (!validPercent(draft.debtsPercent)) errors.debtsPercent = "salary_advance_percent_invalid"
    else if (installment && Number(figure(draft.debtsPercent)) < Number(figure(draft.installmentPercent))) errors.debtsPercent = "salary_advance_debts_below"
    return errors
}

/** The rules as the card shows them. */
export function draftOfPolicy(policy: SalaryAdvancePolicy): SalaryAdvancePolicyDraft {
    return {
        maxMonths: String(policy.maxMonths),
        minServiceMonths: String(policy.minServiceMonths),
        oneOpen: policy.oneOpen,
        installmentPercent: String(policy.installmentPercent),
        debtsPercent: String(policy.debtsPercent),
        overLimit: policy.overLimit,
    }
}

/** The card's figures as numbers, once nothing's wrong with them. */
export function policyOfDraft(draft: SalaryAdvancePolicyDraft): SalaryAdvancePolicy {
    return {
        maxMonths: Number(figure(draft.maxMonths)),
        minServiceMonths: Number(figure(draft.minServiceMonths)),
        oneOpen: draft.oneOpen,
        installmentPercent: Number(figure(draft.installmentPercent)),
        debtsPercent: Number(figure(draft.debtsPercent)),
        overLimit: draft.overLimit,
    }
}

/** A figure typed as the one saved: "2.0" is 2. Empty is a change. */
const same = (text: string, saved: number) => figure(text) !== "" && Number(figure(text)) === saved

/** Whether what's on the card is what was saved. */
export function policyUnchanged(draft: SalaryAdvancePolicyDraft, saved: SalaryAdvancePolicy): boolean {
    return same(draft.maxMonths, saved.maxMonths)
        && same(draft.minServiceMonths, saved.minServiceMonths)
        && draft.oneOpen === saved.oneOpen
        && same(draft.installmentPercent, saved.installmentPercent)
        && same(draft.debtsPercent, saved.debtsPercent)
        && draft.overLimit === saved.overLimit
}

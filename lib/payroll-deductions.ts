/**
 * Payroll deductions (LATER_CHANGES_PLAN.md §7.12, PR 440): what a company
 * takes from every payslip before it's paid. Income tax and social
 * insurance, kept by what they are, and as many more as it names, each a
 * percentage of the month's pay before them or a fixed amount.
 *
 * Pure, like lib/register.ts, which calls it, and safe for the settings card
 * to import: what the card says is wrong is what the server refuses.
 */

import { toMinor, type Minor } from "./payroll"

export type PayrollDeductionKind = "INCOME_TAX" | "SOCIAL_INSURANCE" | "OTHER"
export type PayrollDeductionBasis = "PERCENT" | "AMOUNT"

/** A deduction as payroll needs it. `value` is a percentage, or an amount in major units. */
export interface PayrollDeductionRule {
    id: string
    kind: PayrollDeductionKind
    /** The company's own name for it; none for income tax and social insurance. */
    name: string | null
    basis: PayrollDeductionBasis
    value: number
    /** The card's order, among the company's own. */
    sortOrder: number
}

/**
 * Where a payslip line came from. Income tax and social insurance each have
 * their own, so the Payroll page and the payslip say them in the page's
 * language; the company's own are shown as it named them.
 */
export const PAYROLL_DEDUCTION_SOURCES = {
    INCOME_TAX: "INCOME_TAX",
    SOCIAL_INSURANCE: "SOCIAL_INSURANCE",
    OTHER: "PAYROLL_DEDUCTION",
} as const

export function deductionSource(kind: PayrollDeductionKind): string {
    return PAYROLL_DEDUCTION_SOURCES[kind]
}

/** Whether a payslip line is one of these, by where it came from. */
export function isPayrollDeductionSource(source: string): boolean {
    return (Object.values(PAYROLL_DEDUCTION_SOURCES) as string[]).includes(source)
}

/** The labels stored on a payslip line, in English, as its other lines' are. */
const BUILT_IN_LABEL: Record<Exclude<PayrollDeductionKind, "OTHER">, string> = {
    INCOME_TAX: "Income tax",
    SOCIAL_INSURANCE: "Social insurance",
}

/** How many of its own a company may have, after income tax and social insurance. */
export const MAX_MORE_DEDUCTIONS = 10
/** A deduction's name, as long as a person's or a client's may be. */
export const DEDUCTION_NAME_MAX = 40

const KIND_ORDER: Record<PayrollDeductionKind, number> = { INCOME_TAX: 0, SOCIAL_INSURANCE: 1, OTHER: 2 }

/** Income tax, then social insurance, then the company's own in the card's order. */
export function orderedDeductions(rules: PayrollDeductionRule[]): PayrollDeductionRule[] {
    return rules
        .map((rule, index) => ({ rule, index }))
        .sort((a, b) => KIND_ORDER[a.rule.kind] - KIND_ORDER[b.rule.kind]
            || a.rule.sortOrder - b.rule.sortOrder
            || a.index - b.index)
        .map(x => x.rule)
}

/**
 * A percentage of an amount, to the minor unit, half up. Worked in whole
 * numbers, as hundredths of a percent, so 12.5% of 1,234.56 is 154.32 and
 * never 154.31999.
 */
export function percentOf(baseMinor: Minor, percent: number): Minor {
    if (baseMinor <= 0 || percent <= 0) return 0
    const hundredths = Math.round(percent * 100)
    return Math.floor((baseMinor * hundredths * 2 + 10_000) / 20_000)
}

export interface DeductionLine {
    kind: "DEDUCTION"
    label: string
    amountMinor: Minor
    source: string
    sourceId: string
}

/**
 * The month's deductions, from the pay before them.
 *
 * Each percentage is of that same pay, not of what the one before it left,
 * as the owner decided (§7.12). And each takes no more than what's left, so
 * together they never take the net below 0: a deduction isn't a debt, and
 * a payslip that paid nothing has nothing to withhold. One at 0, or with
 * nothing left for it, prints no line.
 */
export function deductionLines(baseMinor: Minor, rules: PayrollDeductionRule[]): DeductionLine[] {
    let left = Math.max(0, baseMinor)
    const lines: DeductionLine[] = []
    for (const rule of orderedDeductions(rules)) {
        if (left <= 0) break
        const wanted = rule.basis === "PERCENT" ? percentOf(baseMinor, rule.value) : toMinor(rule.value)
        const amountMinor = Math.min(wanted, left)
        if (amountMinor <= 0) continue
        left -= amountMinor
        lines.push({
            kind: "DEDUCTION",
            label: rule.kind === "OTHER" ? (rule.name ?? "").trim() : BUILT_IN_LABEL[rule.kind],
            amountMinor,
            source: deductionSource(rule.kind),
            sourceId: rule.id,
        })
    }
    return lines
}

/** One of the company's own, as the card holds it: what's typed. */
export interface DeductionDraft {
    id?: string
    name: string
    basis: PayrollDeductionBasis
    value: string
}

export interface DeductionsDraft {
    incomeTax: string
    socialInsurance: string
    more: DeductionDraft[]
}

export type DeductionErrorKey =
    | "deduction_percent_invalid" | "deduction_amount_invalid"
    | "deduction_name_required" | "deduction_name_too_long" | "deduction_name_taken"
    | "deduction_too_many"

export interface DeductionErrors {
    incomeTax?: DeductionErrorKey
    socialInsurance?: DeductionErrorKey
    /** By the deduction's place on the card. */
    more?: Record<number, { name?: DeductionErrorKey; value?: DeductionErrorKey }>
    moreCount?: DeductionErrorKey
}

/**
 * A figure as typed, in digits a number reads: Arabic-Indic digits, and the
 * Arabic decimal mark, as Western ones, so «١٠٫٥» is 10.5 in either language.
 */
export function figure(text: string): string {
    return text.trim()
        .replace(/[\u0660-\u0669]/g, d => String(d.charCodeAt(0) - 0x0660))
        .replace(/[\u06F0-\u06F9]/g, d => String(d.charCodeAt(0) - 0x06F0))
        .replace(/\u066B/g, ".")
}

const PERCENT = /^\d{1,3}(\.\d{1,2})?$/
// What a Decimal(12, 2) holds.
const AMOUNT = /^\d{1,10}(\.\d{1,2})?$/

export function validPercent(text: string): boolean {
    const t = figure(text)
    return PERCENT.test(t) && Number(t) <= 100
}

export function validAmount(text: string): boolean {
    return AMOUNT.test(figure(text))
}

/** Two names are the same ignoring capitals and the spaces around them. */
export const sameDeductionName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase()

/**
 * What's wrong with the card's figures, each under its own field: a
 * percentage 0 to 100 with up to two decimals, an amount 0 or more with up
 * to two, a name that's there, short enough and not another's, and no more
 * than the most. Nothing wrong is `{}`.
 */
export function deductionErrors(draft: DeductionsDraft): DeductionErrors {
    const errors: DeductionErrors = {}
    if (!validPercent(draft.incomeTax)) errors.incomeTax = "deduction_percent_invalid"
    if (!validPercent(draft.socialInsurance)) errors.socialInsurance = "deduction_percent_invalid"
    if (draft.more.length > MAX_MORE_DEDUCTIONS) {
        errors.moreCount = "deduction_too_many"
        return errors
    }
    const more: NonNullable<DeductionErrors["more"]> = {}
    draft.more.forEach((d, i) => {
        const wrong: { name?: DeductionErrorKey; value?: DeductionErrorKey } = {}
        const name = d.name.trim()
        if (!name) wrong.name = "deduction_name_required"
        else if (name.length > DEDUCTION_NAME_MAX) wrong.name = "deduction_name_too_long"
        else if (draft.more.slice(0, i).some(e => sameDeductionName(e.name, d.name))) wrong.name = "deduction_name_taken"
        if (d.basis === "PERCENT" ? !validPercent(d.value) : !validAmount(d.value)) {
            wrong.value = d.basis === "PERCENT" ? "deduction_percent_invalid" : "deduction_amount_invalid"
        }
        if (wrong.name || wrong.value) more[i] = wrong
    })
    if (Object.keys(more).length > 0) errors.more = more
    return errors
}

/** Whether the card has nothing wrong. */
export const deductionsValid = (draft: DeductionsDraft) => Object.keys(deductionErrors(draft)).length === 0

/**
 * The deductions an approved month kept (PR 440), as stored with it. A month
 * approved before there were any kept none, and takes none.
 */
export function deductionsKept(stored: unknown): PayrollDeductionRule[] {
    if (!Array.isArray(stored)) return []
    return stored.filter((r): r is PayrollDeductionRule =>
        !!r && typeof r === "object"
        && typeof (r as PayrollDeductionRule).id === "string"
        && ["INCOME_TAX", "SOCIAL_INSURANCE", "OTHER"].includes((r as PayrollDeductionRule).kind)
        && ["PERCENT", "AMOUNT"].includes((r as PayrollDeductionRule).basis)
        && typeof (r as PayrollDeductionRule).value === "number")
}

/**
 * A person's own (LATER_CHANGES_PLAN.md §7.12, step 9b, PR 442): for one of
 * the company's deductions, their own figure in its place, in its kind, or
 * that it's not applied to them. As the company is nothing set.
 */
export type PersonDeductionMode = "COMPANY" | "OWN" | "NONE"

export interface PersonDeductionSetting {
    deductionId: string
    mode: "OWN" | "NONE"
    /** Their own, for OWN; none for NONE. */
    value: number | null
}

/**
 * The company's deductions as they reach one person: their own figure in
 * the company's place, and one not applied left out, in the company's
 * order. What's set for a deduction the company no longer has is nothing.
 */
export function rulesFor(rules: PayrollDeductionRule[], settings: PersonDeductionSetting[] = []): PayrollDeductionRule[] {
    if (settings.length === 0) return rules
    const set = new Map(settings.map(s => [s.deductionId, s]))
    return rules.flatMap(rule => {
        const s = set.get(rule.id)
        if (!s) return [rule]
        if (s.mode === "NONE") return []
        return [{ ...rule, value: s.value ?? 0 }]
    })
}

/**
 * One of the company's deductions, as a person's card holds it. `ref` is
 * income tax's or social insurance's kind, which every company has whether
 * or not it's saved one, or the company's own's id.
 */
export interface PersonDeductionDraft {
    ref: string
    /** How the company takes it, as the card was shown it. */
    basis: PayrollDeductionBasis
    mode: PersonDeductionMode
    /** Their own, as typed; only read for OWN. */
    value: string
}

/** One of the company's deductions on a person's card, with what's set for them. */
export interface PersonDeductionRow {
    /** Income tax's or social insurance's kind, or the company's own's id. */
    ref: string
    kind: PayrollDeductionKind
    name: string | null
    basis: PayrollDeductionBasis
    /** The company's figure. */
    company: number
    mode: PersonDeductionMode
    /** Their own, for OWN. */
    value: number | null
}

export interface PersonDeductionsView {
    deductions: PersonDeductionRow[]
}

/** What's wrong with a person's card, by each deduction's ref. Nothing wrong is `{}`. */
export type PersonDeductionErrors = Record<string, DeductionErrorKey>

/**
 * Their own figure, by the company card's rules: a percentage 0 to 100 with
 * up to two decimals, or an amount 0 or more with up to two. As the company
 * and not applied ask for nothing.
 */
export function personDeductionErrors(drafts: PersonDeductionDraft[]): PersonDeductionErrors {
    const errors: PersonDeductionErrors = {}
    for (const d of drafts) {
        if (d.mode !== "OWN") continue
        if (d.basis === "PERCENT" ? !validPercent(d.value) : !validAmount(d.value)) {
            errors[d.ref] = d.basis === "PERCENT" ? "deduction_percent_invalid" : "deduction_amount_invalid"
        }
    }
    return errors
}

/** Each person's, as an approved month stores them (PR 442): by person. */
export function peopleStored(people: Map<string, PersonDeductionSetting[]>): Record<string, PersonDeductionSetting[]> {
    return Object.fromEntries(people)
}

const isSetting = (s: unknown): s is PersonDeductionSetting =>
    !!s && typeof s === "object"
    && typeof (s as PersonDeductionSetting).deductionId === "string"
    && ((s as PersonDeductionSetting).mode === "NONE"
        || ((s as PersonDeductionSetting).mode === "OWN" && Number.isFinite((s as PersonDeductionSetting).value)))

/**
 * Each person's an approved month kept (PR 442), as stored with it. A month
 * approved before there were any kept none: everyone took the company's.
 */
export function peopleKept(stored: unknown): Map<string, PersonDeductionSetting[]> {
    const people = new Map<string, PersonDeductionSetting[]>()
    if (!stored || typeof stored !== "object" || Array.isArray(stored)) return people
    for (const [userId, settings] of Object.entries(stored as Record<string, unknown>)) {
        if (!Array.isArray(settings)) continue
        const kept = settings.filter(isSetting).map(s => ({ deductionId: s.deductionId, mode: s.mode, value: s.mode === "OWN" ? s.value : null }))
        if (kept.length > 0) people.set(userId, kept)
    }
    return people
}

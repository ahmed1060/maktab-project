import { cents } from "@/lib/task-costs"
import { countOf } from "@/lib/plural"
import type { TranslationKey } from "@/lib/translations"

/**
 * Client charges (CLIENTS_PLAN.md §6), as the Charged to clients tab and the
 * server both take them.
 */

/** A charge's statuses to filter by: Due, Collected, left off the bill, or all of them. */
export const CHARGE_STATUSES = ["due", "collected", "not_charged", "all"] as const
export type ChargeStatus = typeof CHARGE_STATUSES[number]

/** The largest service fee, so a mistyped one can't run the total into the millions. */
export const SERVICE_FEE_MAX = 1_000_000

/**
 * Paid | Service fee | Total (§6.3): typing the fee works out the total, and
 * typing the total works out the fee. Null for what can't be one: a fee below
 * nothing, or a total below what was paid.
 */
export function totalFor(paid: number, fee: number): number | null {
    if (!Number.isFinite(fee) || fee < 0 || fee > SERVICE_FEE_MAX) return null
    return cents(paid + cents(fee))
}

export function feeFor(paid: number, total: number): number | null {
    if (!Number.isFinite(total)) return null
    const fee = cents(cents(total) - paid)
    return fee < 0 || fee > SERVICE_FEE_MAX ? null : fee
}

/** What a charge is: Due, Collected, or left off its client's bill. */
export function chargeState(charge: { notCharged: boolean; collectedAt: string | Date | null }): "due" | "collected" | "not_charged" {
    if (charge.collectedAt) return "collected"
    return charge.notCharged ? "not_charged" : "due"
}

/**
 * Mark collected's confirmation (§6.4): exactly what it collects, from whom,
 * as "Collect 7 charges, 3,450.00 EGP, from Al Noor?".
 */
export function collectWording(t: (key: TranslationKey) => string, locale: string, count: number, amount: number, client: string) {
    const money = amount.toLocaleString(locale === "ar" ? "ar-EG" : "en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    const say = (key: TranslationKey) => t(key).replace("{charges}", countOf(t, locale, count, "charges")).replace("{amount}", money).replace("{client}", client)
    return { question: say("charges_collect_question"), button: say("charges_collect_button") }
}

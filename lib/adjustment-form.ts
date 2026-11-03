import type { TranslationKey } from '@/lib/translations'

/**
 * Add a bonus and Add a deduction (UI_PLAN.md §5 step 5): one form, saying
 * what each is, and its checks before anything is sent. They were two
 * copies, each saying "Failed to add bonus" whatever the server had said.
 */
export type AdjustmentKind = 'BONUS' | 'DEDUCTION'

/** As the server takes them (MAX_ADJUSTMENT_DAYS, lib/services/salary.service.ts). */
export const MAX_DAYS = 1000

export const COPY: Record<AdjustmentKind, { title: TranslationKey; hint: TranslationKey; button: TranslationKey; added: TranslationKey; path: string }> = {
    BONUS: { title: 'adj_new_bonus_title', hint: 'adj_new_bonus_hint', button: 'add_bonus', added: 'adj_new_bonus_added', path: 'bonus' },
    DEDUCTION: { title: 'adj_new_deduction_title', hint: 'adj_new_deduction_hint', button: 'add_deduction', added: 'adj_new_deduction_added', path: 'deduction' },
}

/**
 * What's wrong with the days typed: more than 0, up to MAX_DAYS, and to 2
 * decimal places, as they're kept. The browser's step of 0.01 said the last
 * until the form took over its checks; kept as 1.56, 1.555 would have
 * changed the pay by 1.555 days.
 */
export function daysError(text: string): 'adj_new_days_invalid' | 'adj_new_days_too_many' | 'adj_new_days_decimals' | null {
    const typed = text.trim()
    const n = typed ? Number(typed) : NaN
    if (!Number.isFinite(n) || n <= 0) return 'adj_new_days_invalid'
    if (n > MAX_DAYS) return 'adj_new_days_too_many'
    if (Math.round(n * 100) / 100 !== n) return 'adj_new_days_decimals'
    return null
}

/** The server's refusal of the days themselves, said under them; anything else is said above the buttons. */
export function refusedDays(body: { error?: string } | null): boolean {
    return !!body?.error?.startsWith('Invalid amount')
}

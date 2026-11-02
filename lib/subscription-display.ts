import type { SubscriptionState } from "@/lib/billing/state"
import type { StatusTone } from "@/components/ui/StatusBadge"
import type { TranslationKey } from "@/lib/translations"

/**
 * Presentation for a subscription state: its meaning, as a status badge's
 * tone, and its label key, in one place, so the companies list, the settings
 * page and anything added later cannot drift apart. Same pattern as
 * lib/recurrence.ts, for the same reason.
 *
 * The tones are the status badges' meaning colours (DESIGN.md §2.3): a trial
 * in progress, healthy, acting soon, stopped. They had colours of their own
 * (the Super Admin's pages part 3a).
 */
export const SUBSCRIPTION_TONE: Record<SubscriptionState, { tone: StatusTone; labelKey: TranslationKey }> = {
    TRIAL: { tone: 'progress', labelKey: 'state_trial' },
    ACTIVE: { tone: 'good', labelKey: 'state_active' },
    GRACE: { tone: 'waiting', labelKey: 'state_grace' },
    LOCKED: { tone: 'problem', labelKey: 'state_locked' },
    LIFETIME: { tone: 'good', labelKey: 'state_lifetime' },
}

/**
 * A company with no date is not in an unknown state — it is either LIFETIME,
 * which has no end, or grandfathered, which has no subscription at all. The
 * distinction matters in the UI: one is a premium customer, the other is a
 * company nobody has assigned a package to yet.
 */
export function isGrandfathered(state: SubscriptionState, date: string | Date | null): boolean {
    return state === 'ACTIVE' && date === null
}

export const TRIAL_PRESET_LABEL_KEY: Record<string, TranslationKey> = {
    TWO_DAYS: 'trial_2_days',
    SEVEN_DAYS: 'trial_7_days',
    FOURTEEN_DAYS: 'trial_14_days',
    ONE_MONTH: 'trial_1_month',
    THREE_MONTHS: 'trial_3_months',
}

/** The bundles a package grants, as label keys. Empty means Core only. */
export function bundleLabelKeys(pkg: {
    hasCompanyManagement: boolean
    hasHR: boolean
    hasAttendanceTerminals?: boolean
    hasAttendanceMobile?: boolean
} | null | undefined): TranslationKey[] {
    if (!pkg) return []
    const keys: TranslationKey[] = []
    if (pkg.hasCompanyManagement) keys.push('bundle_company_management')
    if (pkg.hasHR) keys.push('bundle_hr')
    if (pkg.hasAttendanceTerminals) keys.push('bundle_attendance_terminals')
    if (pkg.hasAttendanceMobile) keys.push('bundle_attendance_mobile')
    return keys
}

/**
 * What the platform charges, a package's price or a company's payment, in US
 * dollars, in the page's language and digits (the Super Admin's pages part
 * 3b): "$1,200.00". The old pages put a dollar sign before a number.
 */
export function platformMoney(n: number, locale: string): string {
    return n.toLocaleString(locale === 'ar' ? 'ar-EG' : 'en-GB', { style: 'currency', currency: 'USD', currencyDisplay: 'narrowSymbol' })
}

/**
 * What's wrong with an amount typed, as the server would say it: nothing
 * typed, not a number it takes (below zero, or zero where it must be more, or
 * more than the 12 digits it stores), or more than two decimal places, which
 * the database would round without a word. Null when it'll do.
 */
export function amountError(text: string, { zero }: { zero: boolean }): 'missing' | 'wrong' | 'places' | null {
    const typed = text.trim()
    if (typed === '') return 'missing'
    if (!/^(\d+(\.\d*)?|\.\d+)$/.test(typed)) return 'wrong'
    const n = Number(typed)
    if ((!zero && n === 0) || n > 9_999_999_999) return 'wrong'
    return Number(n.toFixed(2)) === n ? null : 'places'
}

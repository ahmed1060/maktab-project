import type { SubscriptionState } from "@/lib/billing/state"

/**
 * Presentation for a subscription state: colour and label key, in one place, so
 * the companies list, the settings page and anything added later cannot drift
 * apart. Same pattern as lib/recurrence.ts, for the same reason.
 *
 * Colours reuse the palette already in use across this app's badges: amber for
 * "acting soon", green for healthy, red for stopped.
 */
export const SUBSCRIPTION_STYLE: Record<SubscriptionState, { bg: string; color: string; labelKey: string }> = {
    TRIAL: { bg: '#e0f2fe', color: '#0369a1', labelKey: 'state_trial' },
    ACTIVE: { bg: '#dcfce7', color: '#166534', labelKey: 'state_active' },
    GRACE: { bg: '#fef3c7', color: '#b45309', labelKey: 'state_grace' },
    LOCKED: { bg: '#fee2e2', color: '#b91c1c', labelKey: 'state_locked' },
    LIFETIME: { bg: '#ede9fe', color: '#6d28d9', labelKey: 'state_lifetime' },
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

export const TRIAL_PRESET_LABEL_KEY: Record<string, string> = {
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
} | null | undefined): string[] {
    if (!pkg) return []
    const keys: string[] = []
    if (pkg.hasCompanyManagement) keys.push('bundle_company_management')
    if (pkg.hasHR) keys.push('bundle_hr')
    if (pkg.hasAttendanceTerminals) keys.push('bundle_attendance_terminals')
    if (pkg.hasAttendanceMobile) keys.push('bundle_attendance_mobile')
    return keys
}

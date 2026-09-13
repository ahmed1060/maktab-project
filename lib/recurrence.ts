import { addMonths, addYears } from './date-math'

// Shared badge styling for the ObligationRecurrence enum
// (ONE_TIME | DAILY | WEEKLY | MONTHLY | YEARLY), used by both the
// obligations list card and the obligation detail header so the two views
// agree on colour and label. An unrecognised value (or a row from before the
// column existed) looks up to undefined, and each caller renders no badge
// rather than a raw translation key.
export const RECURRENCE_STYLE: Record<string, { bg: string; color: string; labelKey: string }> = {
    ONE_TIME: { bg: '#f1f5f9', color: '#475569', labelKey: 'recurrence_one_time' },
    DAILY: { bg: '#ffedd5', color: '#c2410c', labelKey: 'recurrence_daily' },
    WEEKLY: { bg: '#e0f2fe', color: '#0369a1', labelKey: 'recurrence_weekly' },
    MONTHLY: { bg: '#ede9fe', color: '#5b21b6', labelKey: 'recurrence_monthly' },
    YEARLY: { bg: '#dcfce7', color: '#166534', labelKey: 'recurrence_yearly' },
}

/**
 * The deadline of the instance that follows `deadline`.
 *
 * MONTHLY and YEARLY clamp rather than overflow. The native `setMonth` turned
 * a 31 January monthly obligation into 3 March — February never got an
 * instance, and the deadline then drifted to the 3rd of every month
 * thereafter. `setFullYear` did the same to 29 February, landing on 1 March.
 *
 * DAILY and WEEKLY need no clamping: `setDate` rolls across month and year
 * boundaries correctly, since every day and every week is a fixed length.
 *
 * One caveat the clamp cannot fix: each instance is computed from the previous
 * instance's deadline, and nothing records the day-of-month the series was
 * created with. So a 31 January series becomes 28 February and then stays on
 * the 28th — it does not climb back to the 31st in March. That is strictly
 * better than skipping February and drifting to the 3rd forever, but restoring
 * the original day would need an anchor stored on the obligation.
 *
 * Returns null for a recurrence with no next instance, so a caller cannot
 * mistake "does not recur" for "recurs today".
 */
export function nextOccurrence(deadline: Date, recurrence: string): Date | null {
    switch (recurrence) {
        case 'DAILY': {
            const next = new Date(deadline.getTime())
            next.setDate(next.getDate() + 1)
            return next
        }
        case 'WEEKLY': {
            const next = new Date(deadline.getTime())
            next.setDate(next.getDate() + 7)
            return next
        }
        case 'MONTHLY': return addMonths(deadline, 1)
        case 'YEARLY': return addYears(deadline, 1)
        default: return null
    }
}

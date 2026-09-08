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

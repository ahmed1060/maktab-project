import { DonutChart } from '@/components/ui'
import { countOf } from '@/lib/plural'
import type { TranslationKey } from '@/lib/translations'

/**
 * Someone's day off credit as a donut (DESIGN.md §5.5): what's left and
 * what's used this year, in days and as shares of the whole. The dashboard
 * home and the Day Off page show the same one, so they can't disagree.
 *
 * Holds no state, so a server page and a client page can both use it, each
 * with its own `t`. Until the credit has loaded, the empty ring says so
 * instead of "No data available".
 */
export function DayOffCreditDonut({ remaining, used, t, locale, href, loading = false }: {
    /** Days left this year. */
    remaining: number
    /** Days used this year (lib/day-off-credit.ts). */
    used: number
    t: (key: TranslationKey) => string
    locale: string
    /** Where each legend row goes, if anywhere. */
    href?: string
    loading?: boolean
}) {
    const days = (n: number) => countOf(t, locale, n, 'days')
    const whole = remaining + used
    const percent = (n: number) =>
        new Intl.NumberFormat(locale === 'ar' ? 'ar-EG' : 'en-GB', { style: 'percent' }).format(whole > 0 ? n / whole : 0)
    return (
        <DonutChart
            label={t('credit_overview')}
            parts={[
                { key: 'left', label: t('remaining_credit'), value: remaining, count: days(remaining), share: percent(remaining), tone: 'good', href },
                { key: 'used', label: t('used_credit'), value: used, count: days(used), share: percent(used), tone: 'neutral', href },
            ]}
            total={days(whole)}
            totalLabel={t('total_label')}
            emptyLabel={t(loading ? 'loading' : 'no_data_available')}
        />
    )
}

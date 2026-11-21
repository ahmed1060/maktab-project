import { formatDay } from '@/components/records/types'
import { claimPeriod } from '@/lib/portal-tax'
import type { TaxClaimRow } from '@/lib/tax-claims'
import type { TranslationKey } from '@/lib/translations'

/** A day kept on one line, so a period breaks between its two days and not inside one. */
export const dayOnOneLine = (day: string, locale: string) => formatDay(day, locale).replace(/ /g, '\u00a0')

/**
 * A claim's period as the portal means it, in the page's language: a whole
 * year as "Year 2025", a whole month as "November 2025", one day, or from its
 * first day to its last; none where the portal gave no period (DESIGN.md
 * §5.5, The claims; PR 339). Each day, month and year is kept on one line.
 * The client's page and the tax position statement say it so (PR 352).
 */
export function claimPeriodWords(t: (key: TranslationKey) => string, locale: string, claim: Pick<TaxClaimRow, 'periodStart' | 'periodEnd'>): string | null {
    const intl = locale === 'ar' ? 'ar-EG' : 'en-GB'
    const oneLine = (s: string) => s.replace(/ /g, '\u00a0')
    const day = (d: string) => dayOnOneLine(d, locale)
    const p = claimPeriod(claim.periodStart, claim.periodEnd)
    if (!p) return null
    if (p.kind === 'year') return oneLine(t('portal_claim_year').replace('{year}', p.year.toLocaleString(intl, { useGrouping: false })))
    if (p.kind === 'month') return oneLine(new Date(Date.UTC(p.year, p.month - 1, 1)).toLocaleDateString(intl, { month: 'long', year: 'numeric', timeZone: 'UTC' }))
    if (p.kind === 'day') return day(p.day)
    return t('tax_period').replace('{from}', day(p.from)).replace('{to}', day(p.to))
}

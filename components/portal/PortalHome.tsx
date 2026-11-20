'use client'

import { ReceiptIcon } from '@phosphor-icons/react/ssr'
import { BarsByPart, Card, Columns, EmptyState, LargeFigure, Page, PageHeader, ShareBar, StatusBadge } from '@/components/ui'
import { formatDay } from '@/components/records/types'
import { useLanguage } from '@/context/LanguageContext'
import { countOf } from '@/lib/plural'
import { paidShare, type PortalTaxPosition } from '@/lib/portal-tax'
import type { TranslationKey } from '@/lib/translations'

/**
 * The client's area's first page: the client's tax position
 * (CLIENT_PORTAL_PLAN.md §6, §12 step 8c; DESIGN.md §5.5, A client's tax
 * position; PR 338). The client's name above Tax position, where the figures
 * come from and their day, what's owed, and two cards of bars, by item and by
 * how late, with a note at the end. Before the first upload, and with nothing
 * open in the file, an empty state says so.
 *
 * Its client and figures are the session's, read on the server (page.tsx).
 * The claims by item come with step 8d; the accountant, Contact the
 * accountant and Ask about this claim with step 9, so until then the note
 * says to contact the office.
 */
export function PortalHome({ client, position }: { client: string; position: PortalTaxPosition }) {
    const { t, locale } = useLanguage()
    const intl = locale === 'ar' ? 'ar-EG' : 'en-GB'
    // The currency is said once, after the large figure; the note says the rest are in it too.
    const money = (n: number) => n.toLocaleString(intl, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    const percent = (n: number) => n.toLocaleString(intl, { style: 'percent', maximumFractionDigits: 0 })
    // A day kept on one line.
    const day = (d: string) => formatDay(d, locale).replace(/ /g, '\u00a0')
    const { asOf, totals } = position

    if (!asOf) {
        return (
            <Page>
                <PageHeader overline={client} title={t('tax_position')} />
                <div className="ui-panel"><EmptyState icon={ReceiptIcon} title={t('portal_tax_none')} detail={t('portal_tax_none_detail')} /></div>
            </Page>
        )
    }

    const header = <PageHeader overline={client} title={t('tax_position')} subtitle={t('portal_tax_from').replace('{date}', day(asOf))} />
    if (totals.open === 0) {
        return (
            <Page>
                {header}
                <div className="ui-panel"><EmptyState icon={ReceiptIcon} title={t('tax_no_open_claims')} detail={t('tax_no_open_claims_detail').replace('{date}', day(asOf))} /></div>
            </Page>
        )
    }

    const claims = (n: number) => countOf(t, locale, n, 'claims')
    // "All open claims are late" is for more than one; one late claim of one is how many.
    const late = totals.late === 0 ? null
        : totals.late === totals.open && totals.open > 1 ? t('portal_tax_all_late')
            : t('portal_tax_some_late').replace('{count}', claims(totals.late))
    const share = paidShare(totals.paid, totals.original)

    return (
        <Page>
            {header}
            <Card title={t('tax_owed')}>
                <div className="ui-portal-owed">
                    <div className="ui-portal-owed-figure">
                        <LargeFigure value={money(totals.remaining)} unit={t('egp')} />
                        {late && <p className="ui-portal-owed-late"><StatusBadge tone="problem">{late}</StatusBadge></p>}
                    </div>
                    <div className="ui-portal-owed-paid">
                        <ShareBar
                            share={share}
                            line={t('portal_tax_share_paid').replace('{share}', percent(share))}
                            amounts={t('portal_tax_paid_of').replace('{paid}', money(totals.paid)).replace('{original}', money(totals.original))}
                        />
                        <dl className="ui-portal-facts">
                            <div className="ui-portal-fact"><dt>{t('tax_open_claims')}</dt><dd className="ui-num">{totals.open.toLocaleString(intl)}</dd></div>
                            <div className="ui-portal-fact"><dt>{t('tax_paid')}</dt><dd className="ui-num">{money(totals.paid)}</dd></div>
                            <div className="ui-portal-fact">
                                <dt>{t('portal_tax_oldest_delay')}</dt>
                                {/* The days kept with their number. */}
                                <dd className="ui-num">{totals.oldestDelay > 0 ? countOf(t, locale, totals.oldestDelay, 'days').replace(/ /g, '\u00a0') : t('portal_tax_no_delay')}</dd>
                            </div>
                        </dl>
                    </div>
                </div>
            </Card>
            <Columns>
                <Card title={t('portal_tax_by_item')}>
                    {/* The largest first: byItem's order, ties by name, which the bars keep. */}
                    <BarsByPart label={t('portal_tax_by_item')} parts={position.items.map(item => ({
                        key: item.item,
                        name: item.item,
                        value: item.remaining,
                        amount: money(item.remaining),
                        note: t('portal_tax_item_note').replace('{share}', percent(item.remaining / totals.remaining)).replace('{claims}', claims(item.claims.length)),
                    }))} />
                </Card>
                <Card title={t('portal_tax_how_late')}>
                    <BarsByPart label={t('portal_tax_how_late')} ordered parts={position.late.map(row => ({
                        key: row.group,
                        name: t(`portal_tax_late_${row.group}` as TranslationKey),
                        value: row.remaining,
                        amount: money(row.remaining),
                        note: row.count > 0 ? claims(row.count) : undefined,
                    }))} />
                </Card>
            </Columns>
            <p className="ui-hint ui-portal-note">{t('portal_tax_note').replace('{date}', day(asOf))}</p>
        </Page>
    )
}

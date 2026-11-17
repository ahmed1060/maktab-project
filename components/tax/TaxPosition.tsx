'use client'

import { Fragment, useState } from 'react'
import useSWR from 'swr'
import { CalendarBlankIcon, CalendarCheckIcon, CoinsIcon, HourglassIcon, ReceiptIcon, WarningCircleIcon } from '@phosphor-icons/react/ssr'
import { useLanguage } from '@/context/LanguageContext'
import { Button, DataList, EmptyState, ListCard, Pager, pageInRange, Section, StatusBadge, TotalTiles, type Column } from '@/components/ui'
import { formatDay } from '@/components/records/types'
import { fetcher } from '@/lib/swr-fetcher'
import { countOf } from '@/lib/plural'
import { useAdjustOnChange } from '@/lib/useAdjustOnChange'
import { claimBadges, taxClaimsUrl, TAX_PAGE, TAX_PREVIEW, type TaxClaimRow, type TaxPosition as Position } from '@/lib/tax-claims'

/**
 * A client's tax position, for the company's people (CLIENT_PORTAL_PLAN.md
 * §3.5; DESIGN.md §5.5, A client's tax position, for the company's people):
 * a section on the client's page with the day the figures are from, what's
 * owed, and its open claims on the Tax Authority's portal, the longest
 * overdue first. Five to start with, so the client's other sections stay in
 * reach, then all of them, 20 to a page.
 *
 * It only shows. The claims come from the portal's file, uploaded here in
 * the next step (§4.1).
 */
export default function TaxPosition({ clientId }: { clientId: string }) {
    const { t, locale } = useLanguage()
    const [all, setAll] = useState(false)
    const [page, setPage] = useState(1)
    // A page gone back to is asked for again, however lately it was read: what was kept of it may be an earlier file's.
    const { data, error, isValidating, mutate } = useSWR<{ data: Position }>(taxClaimsUrl(clientId, all, page), fetcher, { keepPreviousData: true, dedupingInterval: 0 })
    const body = data?.data
    // All of them are 20 to a page. On a page past the last, as the claims became fewer, it goes to the last there is.
    const pageCount = all ? Math.ceil((body?.total ?? 0) / TAX_PAGE) : 1
    useAdjustOnChange([pageCount], () => setPage(p => pageInRange(p, pageCount)))

    const intl = locale === 'ar' ? 'ar-EG' : 'en-GB'
    const money = (n: number) => `${n.toLocaleString(intl, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${t('egp')}`
    const count = (n: number) => n.toLocaleString(intl)
    const day = (d: string) => formatDay(d, locale)
    // A day kept on one line, so a period breaks between its two days and not inside one.
    const whole = (d: string) => day(d).replace(/ /g, '\u00a0')

    if (!body) {
        return (
            <Section title={t('tax_position')}>
                {error
                    ? <div className="ui-panel"><EmptyState icon={WarningCircleIcon} title={t('tax_position_failed')} action={<Button busy={isValidating} onClick={() => { void mutate() }}>{t('try_again')}</Button>} /></div>
                    : <div className="ui-panel" role="status"><EmptyState icon={HourglassIcon} title={t('tax_position_loading')} /></div>}
            </Section>
        )
    }

    const { position, totals, claims, total } = body
    if (!position) {
        return (
            <Section title={t('tax_position')}>
                <div className="ui-panel"><EmptyState icon={ReceiptIcon} title={t('tax_position_none')} detail={t('tax_position_none_detail')} /></div>
            </Section>
        )
    }

    // Who uploaded it is a name: kept apart from the words around it, whichever way they read.
    const [before, after = ''] = t(position.uploadedBy ? 'tax_figures_from_by' : 'tax_figures_from')
        .replace('{date}', day(position.asOf)).replace('{day}', day(position.uploadedOn)).split('{name}')

    const late = (c: TaxClaimRow) => countOf(t, locale, c.daysLate, 'days')
    // As it's typed into the portal: Latin digits, left to right.
    const number = (c: TaxClaimRow) => <bdi dir="ltr" className="ui-num">{c.claimNumber}</bdi>
    const period = (c: TaxClaimRow) => c.periodStart && c.periodEnd
        ? t('tax_period').replace('{from}', whole(c.periodStart)).replace('{to}', whole(c.periodEnd))
        : whole(c.periodStart || c.periodEnd || c.dueDate)
    const badges = (c: TaxClaimRow) => claimBadges(c).map((badge, i) => (
        <Fragment key={badge}>
            {i > 0 && ' '}
            <StatusBadge tone={badge === 'late' ? 'problem' : 'waiting'}>{t(badge === 'late' ? 'tax_badge_late' : 'tax_badge_partly_paid')}</StatusBadge>
        </Fragment>
    ))

    const columns: Column<TaxClaimRow>[] = [
        { key: 'number', header: t('tax_col_number'), cell: number },
        { key: 'item', header: t('tax_col_item'), cell: c => <bdi>{c.item}</bdi> },
        { key: 'period', header: t('tax_col_period'), cell: c => (c.periodStart || c.periodEnd ? period(c) : null) },
        { key: 'original', header: t('tax_col_original'), align: 'end', cell: c => <span className="ui-nowrap">{money(c.originalAmount)}</span> },
        { key: 'paid', header: t('tax_paid'), align: 'end', cell: c => <span className="ui-nowrap">{money(c.paidAmount)}</span> },
        { key: 'remaining', header: t('tax_col_remaining'), align: 'end', cell: c => <strong className="ui-nowrap">{money(c.remainingAmount)}</strong> },
        {
            key: 'due', header: t('tax_col_due'),
            cell: c => <><div className="ui-nowrap">{day(c.dueDate)}</div>{c.daysLate > 0 && <div className="ui-hint">{t('tax_days_late').replace('{days}', late(c))}</div>}</>,
        },
        { key: 'status', header: t('tax_col_status'), cell: badges },
    ]

    return (
        <Section title={t('tax_position')}>
            <p className="ui-hint">{before}{position.uploadedBy && <bdi>{position.uploadedBy}</bdi>}{after}</p>
            <TotalTiles items={[
                { label: t('tax_owed'), value: money(totals.remaining) },
                { label: t('tax_open_claims'), value: count(totals.open) },
                { label: t('tax_late_claims'), value: count(totals.late) },
                { label: t('tax_paid'), value: money(totals.paid) },
            ]} />
            <DataList
                caption={t('tax_claims_caption')}
                columns={columns}
                rows={claims}
                rowKey={c => c.id}
                card={c => (
                    <ListCard
                        title={<bdi>{c.item}</bdi>}
                        status={claimBadges(c).length > 0 ? <>{badges(c)}</> : undefined}
                        details={[
                            { icon: ReceiptIcon, text: number(c) },
                            ...(c.periodStart || c.periodEnd ? [{ icon: CalendarBlankIcon, text: period(c) }] : []),
                            {
                                icon: CalendarCheckIcon,
                                text: c.daysLate > 0
                                    ? t('tax_due_on_late').replace('{date}', day(c.dueDate)).replace('{days}', late(c))
                                    : t('tax_due_on').replace('{date}', day(c.dueDate)),
                            },
                            { icon: CoinsIcon, text: <span className="ui-num">{money(c.originalAmount)} − {money(c.paidAmount)} = <strong>{money(c.remainingAmount)}</strong></span> },
                        ]}
                    />
                )}
                // Show all claims stays where it is as it becomes Show fewer, with the focus on it.
                footer={total > TAX_PREVIEW ? (
                    <Pager
                        page={pageInRange(page, pageCount)}
                        pageCount={pageCount}
                        onPage={setPage}
                        summary={(
                            <Button size="sm" variant="quiet" aria-expanded={all} onClick={() => { setAll(!all); setPage(1) }}>
                                {all ? t('tax_show_fewer') : t('tax_show_all').replace('{count}', count(total))}
                            </Button>
                        )}
                    />
                ) : undefined}
                empty={<EmptyState icon={ReceiptIcon} title={t('tax_no_open_claims')} detail={t('tax_no_open_claims_detail').replace('{date}', day(position.asOf))} />}
            />
        </Section>
    )
}

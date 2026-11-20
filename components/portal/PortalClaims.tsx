'use client'

import { Fragment, useId, useState } from 'react'
import { CaretDownIcon, CaretRightIcon, ChatTextIcon } from '@phosphor-icons/react/ssr'
import { Icon, IconButton, StatusBadge } from '@/components/ui'
import { formatDay } from '@/components/records/types'
import { useLanguage } from '@/context/LanguageContext'
import type { ClaimAsked } from '@/lib/contact-message'
import { countOf } from '@/lib/plural'
import { claimPeriod, latestDueFirst, toggledItem, type ItemGroup, type PortalTaxPosition } from '@/lib/portal-tax'
import { claimBadges, type ClaimBadge, type TaxClaimRow } from '@/lib/tax-claims'
import type { TranslationKey } from '@/lib/translations'

/**
 * The client's claims by item (CLIENT_PORTAL_PLAN.md §6, §12 step 8d;
 * DESIGN.md §5.5, A client's tax position; PR 339), as the owner's mockup
 * draws them: a table on computers and cards on phones, each item opening to
 * its claims, the largest open at first, with a total at the foot. Where
 * the client's people can write to their accountant, each claim ends with
 * Ask about this claim (step 9d; PR 345).
 *
 * Both are drawn and the page's width shows one, as a DataList does; which
 * items are open is one choice for both.
 */
export function PortalClaims({ items, totals, onAsk }: {
    items: ItemGroup[]
    totals: PortalTaxPosition['totals']
    /** Where Contact the accountant is there: what a claim's Ask about this claim opens. */
    onAsk?: (asked: ClaimAsked) => void
}) {
    const { t, locale } = useLanguage()
    const intl = locale === 'ar' ? 'ar-EG' : 'en-GB'
    const base = useId()
    // The largest item is open at first, as the owner's mockup draws it.
    const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set(items.slice(0, 1).map(item => item.item)))
    const toggle = (item: string) => setOpen(now => toggledItem(now, item))

    const money = (n: number) => n.toLocaleString(intl, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    const count = (n: number) => n.toLocaleString(intl)
    const claims = (n: number) => countOf(t, locale, n, 'claims')
    // A day, a month or a year kept on one line.
    const oneLine = (s: string) => s.replace(/ /g, '\u00a0')
    const day = (d: string) => oneLine(formatDay(d, locale))
    const period = (c: TaxClaimRow): string | null => {
        const p = claimPeriod(c.periodStart, c.periodEnd)
        if (!p) return null
        if (p.kind === 'year') return oneLine(t('portal_claim_year').replace('{year}', p.year.toLocaleString(intl, { useGrouping: false })))
        if (p.kind === 'month') return oneLine(new Date(Date.UTC(p.year, p.month - 1, 1)).toLocaleDateString(intl, { month: 'long', year: 'numeric', timeZone: 'UTC' }))
        if (p.kind === 'day') return day(p.day)
        return t('tax_period').replace('{from}', day(p.from)).replace('{to}', day(p.to))
    }
    const badges = (list: ClaimBadge[]) => list.length > 0 && (
        <span className="ui-claims-badges">
            {list.map(badge => (
                <StatusBadge key={badge} tone={badge === 'late' ? 'problem' : 'waiting'}>{t(badge === 'late' ? 'tax_badge_late' : 'tax_badge_partly_paid')}</StatusBadge>
            ))}
        </span>
    )
    // A claim's badges, then Ask about this claim where there's one to write to, at the end side.
    const end = (c: TaxClaimRow, item: ItemGroup) => onAsk ? (
        <span className="ui-claim-end">
            {badges(claimBadges(c))}
            <IconButton
                icon={ChatTextIcon}
                className="ui-claim-ask"
                label={t('portal_claim_ask').replace('{number}', c.claimNumber)}
                tip={t('portal_claim_ask_tip')}
                aria-haspopup="dialog"
                onClick={() => onAsk({ claim: c, item: item.item })}
            />
        </span>
    ) : badges(claimBadges(c))
    // Down while open; to the end side while closed, turned in Arabic.
    const caret = (isOpen: boolean) => isOpen
        ? <Icon icon={CaretDownIcon} size={16} className="ui-claims-caret" />
        : <Icon icon={CaretRightIcon} size={16} directional className="ui-claims-caret" />
    const amounts = (original: number, paid: number, remaining: number) => (
        <dl className="ui-claim-amounts">
            <div><dt>{t('tax_col_original')}</dt><dd className="ui-num">{money(original)}</dd></div>
            <div><dt>{t('tax_paid')}</dt><dd className="ui-num">{money(paid)}</dd></div>
            <div className="ui-claim-amounts-remaining"><dt>{t('tax_col_remaining')}</dt><dd className="ui-num">{money(remaining)}</dd></div>
        </dl>
    )
    const heads: TranslationKey[] = ['tax_col_item', 'portal_claims_col_claims', 'tax_col_original', 'tax_paid', 'tax_col_remaining', 'portal_claims_col_earliest', 'tax_col_status']

    return (
        <section className="ui-panel ui-portal-claims" aria-labelledby={`${base}-title`}>
            <div className="ui-portal-claims-head">
                <h2 id={`${base}-title`} className="ui-card-title">{t('portal_claims')}</h2>
                <p className="ui-portal-claims-hint">{t('portal_claims_hint')}</p>
            </div>
            <div className="ui-table-scroll ui-claims-scroll">
                <table className="ui-claims-table">
                    <caption className="ui-visually-hidden">{t('portal_claims')}</caption>
                    <colgroup>
                        <col className="ui-claims-col-item" />
                        <col className="ui-claims-col-count" />
                        <col /><col /><col />
                        <col className="ui-claims-col-due" />
                        <col className="ui-claims-col-status" />
                    </colgroup>
                    <thead><tr>{heads.map(key => <th key={key} scope="col">{t(key)}</th>)}</tr></thead>
                    {items.map((item, i) => {
                        const isOpen = open.has(item.item)
                        return (
                            <Fragment key={item.item}>
                                <tbody className="ui-claims-item">
                                    {/* The whole row opens its claims. The button in it names the item and says
                                        whether it's open, for keyboards and screen readers; its click is the row's. */}
                                    <tr onClick={() => toggle(item.item)}>
                                        <th scope="row">
                                            <button type="button" className="ui-claims-toggle" aria-expanded={isOpen} aria-controls={`${base}-t${i}`}>{caret(isOpen)}{item.item}</button>
                                        </th>
                                        <td className="ui-num">{count(item.claims.length)}</td>
                                        <td className="ui-num">{money(item.original)}</td>
                                        <td className="ui-num">{money(item.paid)}</td>
                                        <td className="ui-num ui-claims-remaining">{money(item.remaining)}</td>
                                        <td>{day(item.earliestDue)}</td>
                                        <td>{badges(item.badges)}</td>
                                    </tr>
                                </tbody>
                                <tbody id={`${base}-t${i}`} className="ui-claims-of" hidden={!isOpen}>
                                    {latestDueFirst(item.claims).map(c => {
                                        const when = period(c)
                                        return (
                                            <tr key={c.id}>
                                                <th scope="row">
                                                    {/* As it's typed into the portal: Latin digits, left to right. */}
                                                    <span className="ui-claim-number" dir="ltr">{c.claimNumber}</span>
                                                    {when && <span className="ui-claim-period">{when}</span>}
                                                </th>
                                                <td />
                                                <td className="ui-num">{money(c.originalAmount)}</td>
                                                <td className="ui-num">{money(c.paidAmount)}</td>
                                                <td className="ui-num ui-claims-remaining">{money(c.remainingAmount)}</td>
                                                <td>{day(c.dueDate)}</td>
                                                <td>{end(c, item)}</td>
                                            </tr>
                                        )
                                    })}
                                </tbody>
                            </Fragment>
                        )
                    })}
                    <tfoot>
                        <tr>
                            <th scope="row">{t('portal_claims_total')}</th>
                            <td className="ui-num">{count(totals.open)}</td>
                            <td className="ui-num">{money(totals.original)}</td>
                            <td className="ui-num">{money(totals.paid)}</td>
                            <td className="ui-num">{money(totals.remaining)}</td>
                            <td />
                            <td />
                        </tr>
                    </tfoot>
                </table>
            </div>
            <div className="ui-claims-phone">
                <ul className="ui-claims-cards" aria-label={t('portal_claims')}>
                    {items.map((item, i) => {
                        const isOpen = open.has(item.item)
                        return (
                            <li key={item.item}>
                                <button type="button" className="ui-claims-card" aria-expanded={isOpen} aria-controls={`${base}-c${i}`} onClick={() => toggle(item.item)}>
                                    {caret(isOpen)}
                                    <span className="ui-claims-card-body">
                                        <span className="ui-claims-card-name">{item.item}</span>
                                        <span className="ui-claims-card-line">
                                            <span className="ui-claims-card-count">{claims(item.claims.length)}</span>
                                            <span className="ui-num ui-claims-card-remaining">{money(item.remaining)} <span className="ui-portal-fact-unit">{t('egp')}</span></span>
                                        </span>
                                        {badges(item.badges)}
                                    </span>
                                </button>
                                <ul id={`${base}-c${i}`} className="ui-claims-card-claims" aria-label={item.item} hidden={!isOpen}>
                                    {latestDueFirst(item.claims).map(c => {
                                        const when = period(c)
                                        return (
                                            <li key={c.id} className="ui-claim-card">
                                                <div className="ui-claim-card-top"><span className="ui-claim-number" dir="ltr">{c.claimNumber}</span>{end(c, item)}</div>
                                                <p className="ui-claim-card-when">
                                                    {when ? t('portal_claim_period_due').replace('{period}', when).replace('{date}', day(c.dueDate)) : t('portal_claim_due').replace('{date}', day(c.dueDate))}
                                                </p>
                                                {amounts(c.originalAmount, c.paidAmount, c.remainingAmount)}
                                            </li>
                                        )
                                    })}
                                </ul>
                            </li>
                        )
                    })}
                </ul>
                <div className="ui-claims-cards-total">
                    <p className="ui-claims-cards-total-title">{t('portal_claims_total_count').replace('{claims}', claims(totals.open))}</p>
                    {amounts(totals.original, totals.paid, totals.remaining)}
                </div>
            </div>
        </section>
    )
}

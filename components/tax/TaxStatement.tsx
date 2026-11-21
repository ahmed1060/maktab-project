'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { PrinterIcon, ReceiptIcon } from '@phosphor-icons/react/ssr'
import { Button, Details, DocumentSheet, EmptyState, Page, PageHeader } from '@/components/ui'
import { formatDay } from '@/components/records/types'
import { useLanguage } from '@/context/LanguageContext'
import { DEFAULT_POWERED_BY_NAME } from '@/lib/branding-defaults'
import { countOf } from '@/lib/plural'
import { latestDueFirst, paidShare } from '@/lib/portal-tax'
import { statementStatuses, statementTitle, type StatementStatus, type TaxStatement } from '@/lib/tax-statement'
import type { TaxClaimRow } from '@/lib/tax-claims'
import { claimPeriodWords, dayOnOneLine } from './claim-period'

const STATUS_WORDS = {
    late: 'tax_statement_status_late',
    partly_paid: 'tax_statement_status_partly_paid',
    not_due: 'tax_statement_status_not_due',
} as const satisfies Record<StatementStatus, string>

/**
 * The tax position statement's page (CLIENT_PORTAL_PLAN.md §8, §12 step 12;
 * DESIGN.md §5.5, Tax position statement; PR 352), opened in a tab of its
 * own: as any document is, its page header names it, with Print and Close
 * above the sheet, so neither is printed. Close closes the tab, and where
 * the browser won't let a page close its tab, such as one opened from its
 * address, it goes back to `home` instead.
 *
 * Before the first upload there's no statement: the page says what the
 * client's page says then. Once there is one, the page's title names the
 * PDF it's saved as, in the page's language: it comes with the page from the
 * server, and is set again here when the language is changed in the tab.
 */
export function TaxStatementPage({ statement, home }: { statement: TaxStatement; home: string }) {
    const { t, locale } = useLanguage()
    const router = useRouter()
    const { client, position } = statement
    const { asOf } = position
    const title = asOf ? statementTitle(t('tax_statement_file'), client, formatDay(asOf, locale)) : null
    useEffect(() => {
        if (title) document.title = title
    }, [title])
    const close = () => {
        window.close()
        window.setTimeout(() => router.replace(home), 300)
    }

    return (
        <Page>
            <PageHeader
                overline={client}
                title={t('tax_statement_title')}
                subtitle={asOf ? t('statement_pdf_hint') : undefined}
                action={<>
                    {asOf && <Button variant="primary" icon={PrinterIcon} onClick={() => window.print()}>{t('doc_print')}</Button>}
                    <Button onClick={close}>{t('close')}</Button>
                </>}
            />
            {asOf
                ? <TaxStatementSheet statement={statement} />
                : <div className="ui-panel"><EmptyState icon={ReceiptIcon} title={t('portal_tax_none')} detail={t('portal_tax_none_detail')} /></div>}
        </Page>
    )
}

/**
 * The sheet, as the owner's mockup draws it: the company's name, the client's
 * details, four facts, the open claims by item with each item's total and the
 * total in all, then the note and the signature. A table on computers and on
 * paper; on phones, each claim is a block of lines under its item. In the
 * page's language, digits too; each claim's number as it's typed into the
 * portal.
 */
export function TaxStatementSheet({ statement }: { statement: TaxStatement }) {
    const { t, locale } = useLanguage()
    const { company, client, accountant, position, signature } = statement
    const { totals, items, today } = position
    const asOf = position.asOf ?? today
    const intl = locale === 'ar' ? 'ar-EG' : 'en-GB'

    const money = (n: number) => n.toLocaleString(intl, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    const count = (n: number) => n.toLocaleString(intl)
    const percent = (n: number) => n.toLocaleString(intl, { style: 'percent', maximumFractionDigits: 0 })
    const claims = (n: number) => countOf(t, locale, n, 'claims')
    const longDay = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString(intl, { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })
    const day = (d: string) => formatDay(d, locale)
    const period = (c: TaxClaimRow) => claimPeriodWords(t, locale, c)
    const amounts = (original: number, paid: number) => t('tax_statement_card_amounts').replace('{original}', money(original)).replace('{paid}', money(paid))
    const total = t('portal_claims_total_count').replace('{claims}', claims(totals.open))

    // Late, with Partly paid under it; on a phone's card, on one line.
    const statuses = (c: TaxClaimRow) => statementStatuses(c).map(status => (
        <span key={status} className="ui-doc-status" data-status={status}>{t(STATUS_WORDS[status])}</span>
    ))
    const cardStatus = (c: TaxClaimRow) => {
        const [first, second] = statementStatuses(c)
        const word = <span className="ui-doc-status-word">{t(STATUS_WORDS[first])}</span>
        if (!second) return <span className="ui-doc-card-status" data-status={first}>{word}</span>
        const [before, after = ''] = t('tax_statement_card_late_partly').split('{late}')
        return <span className="ui-doc-card-status" data-status={first}>{before}{word}{after}</span>
    }

    const details = [
        { label: t('statement_client'), value: <bdi>{client}</bdi> },
        { label: t('tax_statement_as_of'), value: <>{longDay(asOf)}<span className="ui-detail-note">{t('tax_statement_from_portal')}</span></> },
        ...(accountant ? [{ label: t('tax_statement_accountant'), value: <bdi>{accountant}</bdi> }] : []),
        { label: t('tax_statement_printed_on'), value: longDay(today) },
    ]

    return (
        <DocumentSheet title={t('tax_statement_title')} company={company}>
            <Details items={details} columns={4} />

            <dl className="ui-doc-facts">
                <div className="ui-doc-fact"><dt>{t('portal_tax_owed')}</dt><dd>{money(totals.remaining)} <span className="ui-doc-fact-unit">{t('egp')}</span></dd></div>
                {/* As the client's page rounds it: never 100% while something is left to pay. */}
                <div className="ui-doc-fact"><dt>{t('tax_statement_paid')}</dt><dd>{money(totals.paid)} <span className="ui-doc-fact-unit">({percent(paidShare(totals.paid, totals.original))})</span></dd></div>
                <div className="ui-doc-fact"><dt>{t('portal_tax_open_claims')}</dt><dd>{count(totals.open)}</dd></div>
                <div className="ui-doc-fact" data-tone={totals.late > 0 ? 'problem' : undefined}><dt>{t('tax_statement_late')}</dt><dd>{count(totals.late)}</dd></div>
            </dl>

            {totals.open === 0
                ? <p className="ui-doc-empty">{t('tax_no_open_claims_detail').replace('{date}', longDay(asOf))}</p>
                : (
                    <div className="ui-doc-table-wrap">
                        <table className="ui-doc-table">
                            <caption>{t('tax_statement_claims')}</caption>
                            <thead>
                                <tr>
                                    <th scope="col">{t('tax_statement_col_claim')}</th>
                                    <th scope="col">{t('tax_col_due')}</th>
                                    <th scope="col" className="ui-end">{t('tax_col_original')}</th>
                                    <th scope="col" className="ui-end">{t('tax_paid')}</th>
                                    <th scope="col" className="ui-end">{t('tax_col_remaining')}</th>
                                    <th scope="col">{t('tax_col_status')}</th>
                                </tr>
                            </thead>
                            {/* Each item a part of its own, headed by its row, which prints with its first claim. */}
                            {items.map(item => (
                                <tbody key={item.item}>
                                    <tr className="ui-doc-group-row">
                                        <th scope="rowgroup" colSpan={6}><span className="ui-doc-group-name"><bdi>{item.item}</bdi><span className="ui-doc-group-count">{claims(item.claims.length)}</span></span></th>
                                    </tr>
                                    {latestDueFirst(item.claims).map(c => {
                                        const when = period(c)
                                        return (
                                            <tr key={c.id}>
                                                <td><bdi dir="ltr" className="ui-doc-cell-title">{c.claimNumber}</bdi>{when && <span className="ui-doc-cell-detail">{when}</span>}</td>
                                                <td className="ui-nowrap">{day(c.dueDate)}</td>
                                                <td className="ui-end">{money(c.originalAmount)}</td>
                                                <td className="ui-end">{money(c.paidAmount)}</td>
                                                <td className="ui-end ui-doc-remaining">{money(c.remainingAmount)}</td>
                                                <td>{statuses(c)}</td>
                                            </tr>
                                        )
                                    })}
                                    <tr className="ui-doc-item-total">
                                        <th scope="row" colSpan={2}>{t('tax_statement_item_total')}</th>
                                        <td className="ui-end">{money(item.original)}</td>
                                        <td className="ui-end">{money(item.paid)}</td>
                                        <td className="ui-end">{money(item.remaining)}</td>
                                        <td></td>
                                    </tr>
                                </tbody>
                            ))}
                            <tfoot>
                                <tr className="ui-doc-grand-total">
                                    <th scope="row" colSpan={2}>{total}</th>
                                    <td className="ui-end">{money(totals.original)}</td>
                                    <td className="ui-end">{money(totals.paid)}</td>
                                    <td className="ui-end">{money(totals.remaining)}</td>
                                    <td></td>
                                </tr>
                            </tfoot>
                        </table>
                        <div className="ui-doc-cards-groups">
                            {items.map(item => (
                                <section key={item.item} className="ui-doc-cards-group">
                                    <p className="ui-doc-cards-group-head"><bdi>{item.item}</bdi><span className="ui-doc-group-count">{claims(item.claims.length)}</span></p>
                                    <ul className="ui-doc-cards" aria-label={item.item}>
                                        {latestDueFirst(item.claims).map(c => {
                                            const when = period(c)
                                            const due = dayOnOneLine(c.dueDate, locale)
                                            return (
                                                <li key={c.id} className="ui-doc-card">
                                                    <span className="ui-doc-card-head"><bdi dir="ltr">{c.claimNumber}</bdi><bdi className="ui-doc-amount">{money(c.remainingAmount)}</bdi></span>
                                                    <span className="ui-doc-card-detail">{when ? t('portal_claim_period_due').replace('{period}', when).replace('{date}', due) : t('portal_claim_due').replace('{date}', due)}</span>
                                                    <span className="ui-doc-card-detail">{amounts(c.originalAmount, c.paidAmount)}</span>
                                                    {cardStatus(c)}
                                                </li>
                                            )
                                        })}
                                    </ul>
                                    <p className="ui-doc-cards-item-total"><span>{t('tax_statement_item_total')}</span><bdi className="ui-doc-amount">{money(item.remaining)}</bdi></p>
                                </section>
                            ))}
                            <div className="ui-doc-cards-foot">
                                <p className="ui-doc-cards-total"><span>{total}</span><bdi className="ui-doc-amount">{money(totals.remaining)}</bdi></p>
                                <p className="ui-doc-card-detail">{amounts(totals.original, totals.paid)}</p>
                            </div>
                        </div>
                    </div>
                )}

            <footer className="ui-doc-foot">
                <p>{t('tax_statement_note').replace('{date}', longDay(asOf))}</p>
                {/* The name is left as it is by a browser's translation, as the app's own signature is. */}
                {signature.show && <p className="ui-doc-signature"><span>{t('powered_by')}</span> <span translate="no">{signature.name.trim() || DEFAULT_POWERED_BY_NAME}</span></p>}
            </footer>
        </DocumentSheet>
    )
}

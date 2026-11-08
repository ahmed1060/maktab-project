'use client'

import type { ReactNode } from 'react'
import { useLanguage } from '@/context/LanguageContext'
import { Details, DocGroup, DocLine, DocNote, DocTable, DocTotal, DocumentSheet, FileChip, type DocColumn } from '@/components/ui'
import { calendarDay } from '@/lib/calendar-day'
import { countOf } from '@/lib/plural'
import { statementNote, type Statement, type StatementCharge } from '@/lib/client-statement'

const intl = (locale: string) => (locale === 'ar' ? 'ar-EG' : 'en-GB')

/**
 * A client's statement as a document (DESIGN.md §5.5, Client statement;
 * CLIENTS_PLAN.md §6.9): the company's sheet for the client, the period and
 * the day it was issued; the period's charges in a document's table; what
 * they come to, what was collected, and all that's still due; a note that
 * says so; and, with receipts, each one's photo under its number. In the
 * page's language, digits too.
 */
export function StatementSheet({ statement, withReceipts }: { statement: Statement; withReceipts: boolean }) {
    const { t, locale } = useLanguage()
    const { client, period, totals, charges } = statement

    const money = (n: number) => new Intl.NumberFormat(locale === 'ar' ? 'ar-EG' : 'en-EG', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)
    const number = (n: number) => n.toLocaleString(intl(locale))
    // A day without its year where the period's in one, as the period says it.
    const year = period.from.slice(0, 4)
    const oneYear = year === period.to.slice(0, 4)
    const short = new Intl.DateTimeFormat(intl(locale), { day: 'numeric', month: 'short' })
    const shortWithYear = new Intl.DateTimeFormat(intl(locale), { day: 'numeric', month: 'short', year: 'numeric' })
    const long = new Intl.DateTimeFormat(intl(locale), { day: 'numeric', month: 'long', year: 'numeric' })
    const day = (iso: string) => (oneYear && iso.slice(0, 4) === year ? short : shortWithYear).format(calendarDay(iso))
    const longDay = (iso: string) => long.format(calendarDay(iso))
    const range = period.from === period.to ? longDay(period.from) : long.formatRange(calendarDay(period.from), calendarDay(period.to))

    const what = (c: StatementCharge) => c.description || t('no_description')
    const receiptName = (n: number) => t('statement_receipt').replace('{n}', number(n))
    const receiptRef = (c: StatementCharge): ReactNode => c.receipt
        ? <a href={`#receipt-${c.receipt.number}`}>{receiptName(c.receipt.number)}</a>
        : t('statement_no_receipt')
    const status = (c: StatementCharge): ReactNode => c.collectedOn
        ? t('charges_collected_on').replace('{date}', day(c.collectedOn))
        : <span className="ui-doc-due">{t('charges_status_due')}</span>

    const columns: DocColumn<StatementCharge>[] = [
        { key: 'day', header: t('statement_col_date'), cell: c => day(c.day) },
        {
            key: 'charge', header: t('statement_col_charge'),
            cell: c => <>
                <span className="ui-doc-cell-title">{what(c)}</span>
                <span className="ui-doc-cell-detail"><bdi>{c.task.title}</bdi></span>
                {withReceipts && <span className="ui-doc-cell-detail">{receiptRef(c)}</span>}
            </>,
        },
        { key: 'paid', header: t('charges_col_paid'), amount: true, cell: c => money(c.paid), foot: money(totals.paid) },
        { key: 'fee', header: t('charges_col_fee'), amount: true, cell: c => money(c.fee), foot: money(totals.fees) },
        { key: 'total', header: t('charges_col_total'), amount: true, cell: c => money(c.total), foot: money(totals.charged) },
        { key: 'status', header: t('charges_col_status'), cell: status },
    ]
    // On phones: its day; what it is, with its total; then the rest.
    const card = (c: StatementCharge) => <>
        <span className="ui-doc-card-day">{day(c.day)}</span>
        <span className="ui-doc-card-head"><span>{what(c)}</span><bdi className="ui-doc-amount">{money(c.total)}</bdi></span>
        <span className="ui-doc-card-detail"><bdi>{c.task.title}</bdi></span>
        <span className="ui-doc-card-detail">{t('statement_card_amounts').replace('{paid}', money(c.paid)).replace('{fee}', money(c.fee))}</span>
        <span className="ui-doc-card-foot"><span>{status(c)}</span>{withReceipts && <span>{receiptRef(c)}</span>}</span>
    </>

    const note = statementNote(totals)
    const said = t(note.key)
        .replace('{amount}', money(totals.stillDue))
        .replace('{charges}', countOf(t, locale, totals.dueCount, 'charges'))
        .replace('{older}', countOf(t, locale, totals.dueBeforeCount, 'charges'))
    const receipts = withReceipts ? charges.filter(c => c.receipt) : []

    return (
        <DocumentSheet title={t('statement_title')} company={statement.company}>
            <Details items={[
                { label: t('statement_client'), value: <><bdi>{client.name}</bdi><span className="ui-detail-note"><bdi>{client.ownerName}</bdi></span></> },
                { label: t('doc_period'), value: range },
                { label: t('statement_issued_on'), value: longDay(statement.issuedOn) },
            ]} />

            {charges.length > 0
                ? <DocTable caption={t('statement_charges')} columns={columns} rows={charges} rowKey={c => c.id} card={card} footLabel={countOf(t, locale, charges.length, 'charges')} />
                : <p className="ui-doc-empty">{t('statement_none')}</p>}

            <DocGroup>
                <DocLine label={t('statement_charged')} amount={money(totals.charged)} />
                {/* Taken off, so a minus sign, but none on nothing (PR 155). */}
                <DocLine label={t('statement_collected')} amount={money(totals.collected)} minus={totals.collected !== 0} />
                {totals.dueBefore > 0 && <DocLine label={t('statement_due_before').replace('{date}', longDay(period.from))} amount={money(totals.dueBefore)} />}
                <DocTotal label={t('statement_due')} amount={money(totals.stillDue)} />
            </DocGroup>

            <DocNote tone={note.tone}>{said}</DocNote>

            {receipts.length > 0 && (
                <section className="ui-doc-receipts">
                    <h2 className="ui-doc-group-title">{t('statement_receipts')}</h2>
                    {/* On paper, a page of them says whose they are. */}
                    <p className="ui-doc-print-only ui-doc-receipts-for">{t('statement_receipts_for').replace('{client}', client.name).replace('{period}', range)}</p>
                    <div className="ui-doc-receipt-grid">
                        {receipts.map(c => {
                            const receipt = c.receipt!
                            return (
                                <figure key={c.id} id={`receipt-${receipt.number}`} className="ui-doc-receipt">
                                    <figcaption>
                                        <span className="ui-doc-receipt-number">{receiptName(receipt.number)}</span>
                                        <span>{t('statement_receipt_what').replace('{what}', what(c)).replace('{date}', day(c.day))}</span>
                                        <span>{t('statement_receipt_paid').replace('{amount}', money(c.paid))}</span>
                                    </figcaption>
                                    {receipt.pdf
                                        ? (
                                            // A file of its own: opened from here, and not printed.
                                            <div className="ui-doc-receipt-file">
                                                <span className="ui-doc-screen-only"><FileChip name={t('statement_receipt_open')} href={receipt.url} /></span>
                                                <p className="ui-doc-print-only">{t('statement_receipt_pdf')}</p>
                                            </div>
                                        )
                                        // eslint-disable-next-line @next/next/no-img-element -- a receipt's own photo, whole, at whatever size it was taken
                                        : <img className="ui-doc-receipt-photo" src={receipt.url} alt={t('statement_receipt_alt').replace('{n}', number(receipt.number))} />}
                                </figure>
                            )
                        })}
                    </div>
                </section>
            )}
        </DocumentSheet>
    )
}

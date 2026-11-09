'use client'

import type { ReactNode } from 'react'
import { useLanguage } from '@/context/LanguageContext'
import { Details, DocGroup, DocLine, DocNote, DocTable, DocTotal, DocumentSheet, FileChip, type DocColumn } from '@/components/ui'
import { fill } from '@/components/attendance-calendar/fill'
import { calendarDay } from '@/lib/calendar-day'
import { countOf } from '@/lib/plural'
import { receiptsByName, statementNote, type Statement, type StatementCharge, type StatementName, type StatementView } from '@/lib/client-statement'

const intl = (locale: string) => (locale === 'ar' ? 'ar-EG' : 'en-GB')

/**
 * A client's statement as a document (DESIGN.md §5.5, Client statement;
 * CLIENTS_PLAN.md §6.9): the company's sheet for the client, the period and
 * the day it was issued; the period's charges in a document's table; what
 * they come to, what was collected, and all that's still due; a note that
 * says so; and, with receipts, each one's photo under its number. In the
 * page's language, digits too.
 *
 * By cost name, the same charges added up by what they're called in place
 * of their own table, highest total first, and the receipts under each name.
 */
export function StatementSheet({ statement, withReceipts, view = 'every' }: { statement: Statement; withReceipts: boolean; view?: StatementView }) {
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
        { key: 'day', header: t('statement_col_date'), nowrap: true, cell: c => day(c.day) },
        {
            key: 'charge', header: t('statement_col_charge'),
            cell: c => <>
                <span className="ui-doc-cell-title"><bdi>{what(c)}</bdi></span>
                <span className="ui-doc-cell-detail"><bdi>{c.task.title}</bdi></span>
                {withReceipts && <span className="ui-doc-cell-detail">{receiptRef(c)}</span>}
            </>,
        },
        { key: 'paid', header: t('charges_col_paid'), amount: true, cell: c => money(c.paid), foot: money(totals.paid) },
        { key: 'fee', header: t('charges_col_fee'), amount: true, cell: c => money(c.fee), foot: money(totals.fees) },
        { key: 'total', header: t('charges_col_total'), amount: true, cell: c => money(c.total), foot: money(totals.charged) },
        { key: 'status', header: t('charges_col_status'), nowrap: true, cell: status },
    ]
    // On phones: its day; what it is, with its total; then the rest.
    const card = (c: StatementCharge) => <>
        <span className="ui-doc-card-day">{day(c.day)}</span>
        <span className="ui-doc-card-head"><bdi>{what(c)}</bdi><bdi className="ui-doc-amount">{money(c.total)}</bdi></span>
        <span className="ui-doc-card-detail"><bdi>{c.task.title}</bdi></span>
        <span className="ui-doc-card-detail">{t('statement_card_amounts').replace('{paid}', money(c.paid)).replace('{fee}', money(c.fee))}</span>
        <span className="ui-doc-card-foot"><span>{status(c)}</span>{withReceipts && <span>{receiptRef(c)}</span>}</span>
    </>

    // By cost name: each name, how many, and their amounts.
    const nameOf = (n: StatementName): ReactNode => (n.name === null ? t('statement_no_name') : <bdi>{n.name}</bdi>)
    const nameColumns: DocColumn<StatementName>[] = [
        // Breaking inside a long word, as a charge's title does, rather than push the amounts out.
        { key: 'name', header: t('statement_col_cost_name'), cell: n => <span className="ui-doc-cell-title">{nameOf(n)}</span> },
        { key: 'count', header: t('statement_col_count'), amount: true, cell: n => number(n.ids.length), foot: number(charges.length) },
        { key: 'paid', header: t('charges_col_paid'), amount: true, cell: n => money(n.paid), foot: money(totals.paid) },
        { key: 'fee', header: t('charges_col_fee'), amount: true, cell: n => money(n.fee), foot: money(totals.fees) },
        { key: 'total', header: t('charges_col_total'), amount: true, cell: n => money(n.total), foot: money(totals.charged) },
    ]
    const nameCard = (n: StatementName) => <>
        <span className="ui-doc-card-head">{n.name === null ? <span>{t('statement_no_name')}</span> : <bdi>{n.name}</bdi>}<bdi className="ui-doc-amount">{money(n.total)}</bdi></span>
        <span className="ui-doc-card-detail">{countOf(t, locale, n.ids.length, 'charges')}</span>
        <span className="ui-doc-card-detail">{t('statement_card_amounts').replace('{paid}', money(n.paid)).replace('{fee}', money(n.fee))}</span>
    </>
    const byName = view === 'name'

    const note = statementNote(totals)
    const said = t(note.key)
        .replace('{amount}', money(totals.stillDue))
        .replace('{charges}', countOf(t, locale, totals.dueCount, 'charges'))
        .replace('{older}', countOf(t, locale, totals.dueBeforeCount, 'charges'))
    const receipts = withReceipts ? charges.filter(c => c.receipt) : []
    // A receipt's photo, whole, under its number, what it was and what was paid.
    const figure = (c: StatementCharge, n: number, said: ReactNode) => {
        const receipt = c.receipt!
        return (
            <figure key={c.id} id={`receipt-${n}`} className="ui-doc-receipt">
                <figcaption>
                    <span className="ui-doc-receipt-number">{receiptName(n)}</span>
                    <span>{said}</span>
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
                    : <img className="ui-doc-receipt-photo" src={receipt.url} alt={t('statement_receipt_alt').replace('{n}', number(n))} />}
            </figure>
        )
    }

    return (
        <DocumentSheet title={t(byName ? 'statement_kind_by_name' : 'statement_kind_every')} company={statement.company}>
            <Details items={[
                { label: t('statement_client'), value: <><bdi>{client.name}</bdi><span className="ui-detail-note"><bdi>{client.ownerName}</bdi></span></> },
                { label: t('doc_period'), value: range },
                { label: t('statement_issued_on'), value: longDay(statement.issuedOn) },
            ]} />

            {charges.length === 0
                ? <p className="ui-doc-empty">{t('statement_none')}</p>
                : byName
                    ? <DocTable caption={t('statement_charges_by_name')} columns={nameColumns} rows={statement.names} rowKey={n => n.key} card={nameCard} footLabel={countOf(t, locale, statement.names.length, 'names')} />
                    : <DocTable caption={t('statement_charges')} columns={columns} rows={charges} rowKey={c => c.id} card={card} footLabel={countOf(t, locale, charges.length, 'charges')} />}

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
                    <p className="ui-doc-print-only ui-doc-receipts-for">{fill(t('statement_receipts_for'), { client: <bdi>{client.name}</bdi>, period: range })}</p>
                    {byName
                        // Under each name, in the table's order, numbered that way.
                        ? receiptsByName(statement.names, charges).map(group => (
                            <section key={group.name.key} className="ui-doc-receipt-group">
                                <h3 className="ui-doc-receipt-group-title">{fill(t('statement_receipts_group'), { name: nameOf(group.name), count: countOf(t, locale, group.receipts.length, 'receipts') })}</h3>
                                <div className="ui-doc-receipt-grid">
                                    {group.receipts.map(({ charge: c, number: n }) => figure(c, n, fill(t('statement_receipt_when'), { date: day(c.day), task: <bdi>{c.task.title}</bdi> })))}
                                </div>
                                {group.missing.map(c => (
                                    <p key={c.id} className="ui-doc-receipt-missing">{fill(t('statement_no_receipt_for'), { date: day(c.day), task: <bdi>{c.task.title}</bdi> })}</p>
                                ))}
                            </section>
                        ))
                        : (
                            <div className="ui-doc-receipt-grid">
                                {receipts.map(c => figure(c, c.receipt!.number, fill(t('statement_receipt_what'), { what: <bdi>{what(c)}</bdi>, date: day(c.day) })))}
                            </div>
                        )}
                </section>
            )}
        </DocumentSheet>
    )
}

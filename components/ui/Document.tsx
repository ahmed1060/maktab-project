import type { ReactNode } from 'react'
import type { StatusTone } from './StatusBadge'

/**
 * A document (DESIGN.md §5.5): a paper the app issues, such as a payslip or a
 * settlement statement, read on screen and printed.
 *
 * The sheet is all that prints: the page header around it, with Print and
 * anything else that acts on it, is hidden by the print styles (app/
 * globals.css, `.print-document`), so a button never ends up on paper. One
 * sheet for every document, so two from one employer look like it.
 */
export function DocumentSheet({ title, company, children }: {
    /** The document's name, such as "Payslip". */
    title: ReactNode
    company: { name: string; logoUrl?: string | null }
    children: ReactNode
}) {
    return (
        <article className="ui-panel ui-doc print-document">
            <header className="ui-doc-head">
                <div>
                    <p className="ui-doc-company">{company.name}</p>
                    <p className="ui-doc-kind">{title}</p>
                </div>
                {company.logoUrl && (
                    // eslint-disable-next-line @next/next/no-img-element -- the company's own logo, at whatever size it was uploaded
                    <img src={company.logoUrl} alt="" className="ui-doc-logo" />
                )}
            </header>
            {children}
        </article>
    )
}

/**
 * A group of lines, such as Earnings, under its heading: the lines and their
 * total kept together. Without a heading, it's only that, such as a
 * settlement's two sides and their net.
 */
export function DocGroup({ title, children }: { title?: ReactNode; children: ReactNode }) {
    if (!title) return <div className="ui-doc-group">{children}</div>
    return (
        <section className="ui-doc-group">
            <h2 className="ui-doc-group-title">{title}</h2>
            {children}
        </section>
    )
}

/** A line: its label on the start side, its amount on the end side. One taken off has a minus sign. */
export function DocLine({ label, amount, minus = false }: { label: ReactNode; amount: string; minus?: boolean }) {
    return (
        <div className="ui-doc-line">
            <span>{label}</span>
            <bdi className="ui-doc-amount">{minus ? '−' : ''}{amount}</bdi>
        </div>
    )
}

/** A total, under a rule. The figure the document is for, such as the net, is its last. */
export function DocTotal({ label, amount, minus = false }: { label: ReactNode; amount: string; minus?: boolean }) {
    return (
        <div className="ui-doc-line ui-doc-total">
            <span>{label}</span>
            <bdi className="ui-doc-amount">{minus ? '−' : ''}{amount}</bdi>
        </div>
    )
}

/** A column of a document's table: its heading, its cells, and its sum in the foot, if it has one. */
export type DocColumn<T> = {
    key: string
    header: string
    /** An amount: on the end side, in even-width digits. */
    amount?: boolean
    /** Kept on one line, such as a day: the column saying what a row is wraps instead. */
    nowrap?: boolean
    cell: (row: T) => ReactNode
    foot?: string
}

/**
 * A document's lines with several amounts each (DESIGN.md §5.5, A document's
 * table), such as a client statement's charges: a table on computers and on
 * paper, and on phones a block of lines for each row, from `card`. Its foot
 * says what it sums, `footLabel`, such as how many, then each column's sum.
 */
export function DocTable<T>({ caption, columns, rows, rowKey, card, footLabel }: {
    caption: string
    columns: DocColumn<T>[]
    rows: T[]
    rowKey: (row: T) => string
    card: (row: T) => ReactNode
    footLabel?: ReactNode
}) {
    const firstSum = columns.findIndex(c => c.foot !== undefined)
    const end = (c: DocColumn<T>) => (c.amount ? 'ui-end' : undefined)
    const cellClass = (c: DocColumn<T>) => end(c) ?? (c.nowrap ? 'ui-nowrap' : undefined)
    return (
        <div className="ui-doc-table-wrap">
            <table className="ui-doc-table">
                <caption>{caption}</caption>
                <thead>
                    <tr>{columns.map(c => <th key={c.key} scope="col" className={end(c)}>{c.header}</th>)}</tr>
                </thead>
                <tbody>
                    {rows.map(row => <tr key={rowKey(row)}>{columns.map(c => <td key={c.key} className={cellClass(c)}>{c.cell(row)}</td>)}</tr>)}
                </tbody>
                {footLabel !== undefined && firstSum > 0 && (
                    <tfoot>
                        <tr>
                            <th scope="row" colSpan={firstSum}>{footLabel}</th>
                            {columns.slice(firstSum).map(c => <td key={c.key} className={end(c)}>{c.foot}</td>)}
                        </tr>
                    </tfoot>
                )}
            </table>
            <ul className="ui-doc-cards" aria-label={caption}>
                {rows.map(row => <li key={rowKey(row)} className="ui-doc-card">{card(row)}</li>)}
            </ul>
            {footLabel !== undefined && (
                <div className="ui-doc-cards-foot">
                    <p className="ui-doc-cards-count">{footLabel}</p>
                    {columns.filter(c => c.foot !== undefined).map(c => <DocLine key={c.key} label={c.header} amount={c.foot!} />)}
                </div>
            )}
        </div>
    )
}

/**
 * What to know about the document, with its meaning's colour as a bar on its
 * start edge (§2.3). The words say it; a bar prints where a fill wouldn't.
 */
export function DocNote({ tone, children }: { tone: StatusTone; children: ReactNode }) {
    return <p className="ui-doc-note" data-tone={tone}>{children}</p>
}

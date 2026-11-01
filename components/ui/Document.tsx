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

/**
 * What to know about the document, with its meaning's colour as a bar on its
 * start edge (§2.3). The words say it; a bar prints where a fill wouldn't.
 */
export function DocNote({ tone, children }: { tone: StatusTone; children: ReactNode }) {
    return <p className="ui-doc-note" data-tone={tone}>{children}</p>
}

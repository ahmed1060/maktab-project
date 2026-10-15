import Link from 'next/link'
import type { ReactNode } from 'react'
import { Icon, type PhosphorIcon } from './Icon'
import { cx } from './cx'

/**
 * The smaller building blocks (DESIGN.md §5.5): the page header and layout,
 * sections, panels and cards, rows, total tiles and the empty state. None of
 * them holds state, so server pages use them as they are.
 */

/**
 * The page's title, an optional one-line subtitle, and its primary action on
 * the end side, with at most one secondary action beside it.
 */
export function PageHeader({ title, subtitle, action }: { title: ReactNode; subtitle?: ReactNode; action?: ReactNode }) {
    return (
        <header className="ui-page-header">
            <div>
                <h1 className="ui-page-title">{title}</h1>
                {subtitle && <p className="ui-page-subtitle">{subtitle}</p>}
            </div>
            {action && <div className="ui-page-actions">{action}</div>}
        </header>
    )
}

/** A page's parts, stacked with the space between sections. */
export function Page({ children }: { children: ReactNode }) {
    return <div className="ui-page">{children}</div>
}

/** Sections side by side on computers, one under the other on phones. */
export function Columns({ children }: { children: ReactNode }) {
    return <div className="ui-columns">{children}</div>
}

/** A part of a page made of several panels, under its heading, with an optional link such as "View all". */
export function Section({ title, action, children }: { title: ReactNode; action?: ReactNode; children: ReactNode }) {
    return (
        <section className="ui-section">
            <div className="ui-section-head">
                <h2 className="ui-section-title">{title}</h2>
                {action}
            </div>
            {children}
        </section>
    )
}

/** A quiet link on the end of a section's heading, such as "View all". */
export function SectionLink({ href, children }: { href: string; children: ReactNode }) {
    return <Link href={href} className="ui-btn ui-btn-quiet ui-btn-sm">{children}</Link>
}

/** A short list in a panel, a row per item. A full list with filters and pages is a DataList. */
export function Rows({ label, children }: { label: string; children: ReactNode }) {
    return <ul className="ui-panel ui-rows" aria-label={label}>{children}</ul>
}

/**
 * One row: the title and an optional detail line on the start side, and its
 * status, date or count on the end side. A row with `href` is a link.
 */
export function Row({ href, title, detail, detailIcon, end, tone }: {
    href?: string
    title: ReactNode
    detail?: ReactNode
    detailIcon?: PhosphorIcon
    end?: ReactNode
    tone?: 'overdue'
}) {
    const inside = (
        <>
            <span className="ui-row-main">
                <span className="ui-item-title">{title}</span>
                {detail && <span className="ui-item-detail">{detailIcon && <Icon icon={detailIcon} size={16} />}{detail}</span>}
            </span>
            {end && <span className="ui-row-end">{end}</span>}
        </>
    )
    return (
        <li data-tone={tone}>
            {href ? <Link href={href} className="ui-row">{inside}</Link> : <div className="ui-row">{inside}</div>}
        </li>
    )
}

/** A level-1 panel with nothing inside it set: for lists and other blocks that lay out their own insides. */
export function Panel({ children, className }: { children: ReactNode; className?: string }) {
    return <div className={cx('ui-panel', className)}>{children}</div>
}

/** A panel with its own padding, for things that aren't lists, such as a settings section. */
export function Card({ title, actions, children, className }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
    return (
        <section className={cx('ui-panel ui-card', className)}>
            {(title || actions) && (
                <div className="ui-card-head">
                    {title && <h2 className="ui-card-title">{title}</h2>}
                    {actions}
                </div>
            )}
            {children}
        </section>
    )
}

export type Tile = {
    label: ReactNode
    value: ReactNode
    /** A short line under the value, such as "This month". */
    note?: ReactNode
    /** The list the tile counts: the whole tile goes there. */
    href?: string
}

/** Totals above a list: up to four in a row on computers, two on phones. */
export function TotalTiles({ items }: { items: Tile[] }) {
    return (
        <dl className="ui-tiles">
            {items.map((item, i) => (
                <div key={i} className="ui-panel ui-tile">
                    <dt>{item.href ? <Link href={item.href} className="ui-tile-link">{item.label}</Link> : item.label}</dt>
                    <dd>{item.value}</dd>
                    {item.note && <dd className="ui-tile-note">{item.note}</dd>}
                </div>
            ))}
        </dl>
    )
}

/** What's missing, and the button to add one: an empty list is a place to start. */
export function EmptyState({ icon, title, action }: { icon: PhosphorIcon; title: ReactNode; action?: ReactNode }) {
    return (
        <div className="ui-empty">
            <Icon icon={icon} size={40} />
            <p className="ui-empty-title">{title}</p>
            {action}
        </div>
    )
}

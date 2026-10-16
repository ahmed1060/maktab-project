import Link from 'next/link'
import type { ReactNode } from 'react'
import { ArrowLeftIcon } from '@phosphor-icons/react/ssr'
import { Icon, type PhosphorIcon } from './Icon'
import type { StatusTone } from './StatusBadge'
import { cx } from './cx'

/**
 * The smaller building blocks (DESIGN.md §5.5): the page header and layout,
 * sections, panels and cards, rows, total tiles and the empty state. None of
 * them holds state, so server pages use them as they are.
 */

/**
 * The page's title, an optional one-line subtitle, and its primary action on
 * the end side, with at most one secondary action beside it. A page that
 * belongs to another, such as a client's page under Clients, has a back link
 * to it above the title.
 */
export function PageHeader({ title, subtitle, action, back }: {
    title: ReactNode
    subtitle?: ReactNode
    action?: ReactNode
    back?: { href: string; label: ReactNode }
}) {
    return (
        <header className="ui-page-header">
            <div className="ui-page-heading">
                {back && (
                    <Link href={back.href} className="ui-back-link" prefetch={false}>
                        <Icon icon={ArrowLeftIcon} size={16} directional />
                        {back.label}
                    </Link>
                )}
                <h1 className="ui-page-title">{title}</h1>
                {subtitle && <p className="ui-page-subtitle">{subtitle}</p>}
            </div>
            {action && <div className="ui-page-actions">{action}</div>}
        </header>
    )
}

/**
 * An item's facts on its own page, such as a client's owner and phone: each
 * a label above its value, up to three in a row on computers.
 */
export function Details({ items }: { items: { label: ReactNode; value: ReactNode }[] }) {
    return (
        <dl className="ui-details">
            {items.map((item, i) => (
                <div key={i} className="ui-detail">
                    <dt>{item.label}</dt>
                    <dd>{item.value}</dd>
                </div>
            ))}
        </dl>
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

/**
 * When items in a list are picked: how many, what can be done to all of them,
 * and Clear selection on the end side. The page shows it only while something
 * is picked.
 */
export function SelectionBar({ count, children, clear }: { count: ReactNode; children: ReactNode; clear: ReactNode }) {
    return (
        <div className="ui-panel ui-selectionbar">
            <span className="ui-selectionbar-count" aria-live="polite">{count}</span>
            {children}
            <span className="ui-selectionbar-clear">{clear}</span>
        </div>
    )
}

export type DonutPart = {
    key: string
    label: ReactNode
    value: number
    /** The part's meaning, which decides its colour (DESIGN.md §2.3). */
    tone: StatusTone
    /** The value as the page writes it, such as "٣" or "2 days". */
    count?: ReactNode
    /** Its share of the total as the page writes it, such as "30%" or "٣٠٪". */
    share?: ReactNode
    /** What the part counts: its legend row goes there. */
    href?: string
}

/**
 * How a whole splits into a few parts (DESIGN.md §5.5): a thin ring of
 * rounded, separated parts in the chart colours, the total in its middle, and
 * a legend with each part's word, count and share. The legend is what screen
 * readers read; the ring is a picture of it.
 *
 * The ring has an arc for every part, an empty one too, in the legend's
 * order, so legend row n and arc n are the same part: pointing at a row fades
 * the other arcs in the stylesheet, with no script.
 */
export function DonutChart({ label, parts, total, totalLabel, emptyLabel }: {
    /** What the chart shows, naming the legend for screen readers. */
    label: string
    parts: DonutPart[]
    /** The total, as the page writes it; null while it isn't known (§5.5). */
    total: ReactNode
    totalLabel: ReactNode
    /** Said in place of the legend when there's nothing to count. */
    emptyLabel: ReactNode
}) {
    const values = parts.map(p => Math.max(0, p.value))
    // A total with its unit, such as "12 days", steps down a size to stay
    // clear of the ring.
    const longTotal = typeof total === 'string' && [...total].length > 5
    const sum = values.reduce((a, b) => a + b, 0)
    const arcs = donutArcs(values)
    // A part with the same meaning as an earlier one takes a deeper shade of
    // it, so Approved and Completed read as two.
    const seen = new Set<StatusTone>()
    const shade = parts.map((p, i) => {
        if (values[i] === 0) return undefined
        const again = seen.has(p.tone)
        seen.add(p.tone)
        return again ? '2' : undefined
    })
    return (
        <div className="ui-panel ui-donut">
            <div className="ui-donut-ring">
                <svg viewBox="0 0 100 100" aria-hidden="true" focusable="false">
                    {sum === 0
                        ? <circle className="ui-donut-track" cx="50" cy="50" r={RADIUS} />
                        : (
                            <g transform="rotate(-90 50 50)">
                                {parts.map((p, i) => (
                                    <circle
                                        key={p.key}
                                        className="ui-donut-arc"
                                        data-tone={p.tone}
                                        data-shade={shade[i]}
                                        data-empty={values[i] === 0 || undefined}
                                        cx="50" cy="50" r={RADIUS}
                                        strokeDasharray={arcs[i]?.dash}
                                        strokeDashoffset={arcs[i]?.offset}
                                    />
                                ))}
                            </g>
                        )}
                </svg>
                {total != null && (
                    <div className={cx('ui-donut-total', longTotal && 'ui-donut-total-long')}>
                        <strong>{total}</strong>
                        <span>{totalLabel}</span>
                    </div>
                )}
            </div>
            {sum === 0 ? <p className="ui-donut-empty">{emptyLabel}</p> : (
                <ul className="ui-donut-legend" aria-label={label}>
                    {parts.map((p, i) => {
                        // The spaces keep a screen reader from running the
                        // word, the count and the share together.
                        const inside = (
                            <>
                                <span className="ui-donut-mark" data-tone={p.tone} data-shade={shade[i]} aria-hidden="true" />
                                <span className="ui-donut-label">{p.label}</span>{' '}
                                <span className="ui-donut-count">{p.count ?? p.value}</span>
                                {p.share !== undefined && <>{' '}<span className="ui-donut-share">{p.share}</span></>}
                            </>
                        )
                        return (
                            <li key={p.key} data-empty={values[i] === 0 || undefined}>
                                {p.href ? <Link href={p.href} className="ui-donut-row">{inside}</Link> : <div className="ui-donut-row">{inside}</div>}
                            </li>
                        )
                    })}
                </ul>
            )}
        </div>
    )
}

/** The ring's radius and thickness in its 100-wide box: 160px across, 16px thick. */
const RADIUS = 44
const STROKE = 10
const RING = 2 * Math.PI * RADIUS
/** The clear space between two parts, along the ring. */
const GAP = 3

/**
 * Each part's dash along the ring, worked out before drawing rather than
 * added up while drawing, so a cached piece of a render can't land at the
 * wrong angle. A part's rounded ends reach half the ring's thickness past
 * its dash, so the dash is shorter by that and by the gap. One part alone is
 * the whole ring, with no gap and no ends.
 */
export function donutArcs(values: number[]): ({ dash?: string; offset?: number } | undefined)[] {
    const sum = values.reduce((a, b) => a + Math.max(0, b), 0)
    const drawn = values.filter(v => v > 0).length
    let start = 0
    return values.map(v => {
        if (v <= 0 || sum === 0) return undefined
        if (drawn === 1) return {}
        const length = (v / sum) * RING
        const dash = Math.max(0, length - GAP - STROKE)
        const at = start + GAP / 2 + STROKE / 2
        start += length
        return { dash: `${round(dash)} ${round(RING)}`, offset: -round(at) }
    })
}

const round = (n: number) => Math.round(n * 1000) / 1000

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

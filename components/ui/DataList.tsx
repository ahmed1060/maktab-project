'use client'

import type { ReactNode } from 'react'
import { WarningCircleIcon } from '@phosphor-icons/react/ssr'
import { useLanguage } from '@/context/LanguageContext'
import { Icon, type PhosphorIcon } from './Icon'
import { cx } from './cx'

/**
 * A list (DESIGN.md §5.4): a table on computers and a card per item on
 * phones, both in one panel, with the pager in its footer. Both views are in
 * the page and the stylesheet shows one, so nothing waits on measuring the
 * screen and the server's page is the one the browser keeps.
 *
 * Each row and card carries `data-key`, its row key, for a page that scrolls
 * to one (`visibleRow`): an id would be on the page twice.
 */

/** The row or card for this key that's showing at this width, to scroll to. */
export function visibleRow(key: string): HTMLElement | null {
    const all = document.querySelectorAll<HTMLElement>(`.ui-list [data-key="${CSS.escape(key)}"]`)
    return [...all].find(el => el.offsetParent !== null) ?? null
}

export type Column<T> = {
    key: string
    header: string
    cell: (row: T) => ReactNode
    /** Actions and amounts go at the end. */
    align?: 'start' | 'end'
    /** For an actions column: the header is read out but not shown. */
    hideHeader?: boolean
}

/** How a row stands out: overdue, or selected, such as the one a notification opened. */
export type RowTone = 'overdue' | 'selected'

export function DataList<T>({ caption, columns, rows, rowKey, card, tone, footer, empty }: {
    /** What the list is, for screen readers ("Tasks"). */
    caption: string
    columns: Column<T>[]
    rows: T[]
    rowKey: (row: T) => string
    /** The item as a phone card, usually a ListCard. */
    card: (row: T) => ReactNode
    tone?: (row: T) => RowTone | undefined
    /** Usually the Pager. */
    footer?: ReactNode
    /** Shown instead of the list when there are no rows, usually an EmptyState. */
    empty?: ReactNode
}) {
    if (rows.length === 0 && empty) return <div className="ui-panel">{empty}</div>
    return (
        <div className="ui-panel ui-list">
            <table className="ui-table">
                <caption className="ui-visually-hidden">{caption}</caption>
                <thead>
                    <tr>
                        {columns.map(c => (
                            <th key={c.key} scope="col" className={c.align === 'end' ? 'ui-end' : undefined}>
                                {c.hideHeader ? <span className="ui-visually-hidden">{c.header}</span> : c.header}
                            </th>
                        ))}
                    </tr>
                </thead>
                <tbody>
                    {rows.map(row => (
                        <tr key={rowKey(row)} data-key={rowKey(row)} data-tone={tone?.(row)}>
                            {columns.map(c => <td key={c.key} className={c.align === 'end' ? 'ui-end' : undefined}>{c.cell(row)}</td>)}
                        </tr>
                    ))}
                </tbody>
            </table>
            <ul className="ui-cards" aria-label={caption}>
                {rows.map(row => <li key={rowKey(row)} data-key={rowKey(row)} data-tone={tone?.(row)}>{card(row)}</li>)}
            </ul>
            {footer}
        </div>
    )
}

/** The first column: the item's title, and one detail line below it with its icon. */
export function ItemTitle({ title, detail, detailIcon }: { title: ReactNode; detail?: ReactNode; detailIcon?: PhosphorIcon }) {
    return (
        <>
            <div className="ui-item-title">{title}</div>
            {detail && <div className="ui-item-detail">{detailIcon && <Icon icon={detailIcon} size={16} />}{detail}</div>}
        </>
    )
}

/**
 * A date something is due. Overdue says so in words beside the warning icon,
 * so it never rests on the red alone (DESIGN.md §2.3).
 */
export function DueDate({ children, overdue = false }: { children: ReactNode; overdue?: boolean }) {
    const { t } = useLanguage()
    return (
        <span className="ui-due" data-overdue={overdue || undefined}>
            {overdue && <Icon icon={WarningCircleIcon} size={16} />}
            {children}
            {overdue && <span>{t('ui_overdue')}</span>}
        </span>
    )
}

/** An item as a phone card: title and status, a line per detail, then a footer line. */
export function ListCard({ title, status, details = [], foot, className }: {
    title: ReactNode
    status?: ReactNode
    details?: { icon: PhosphorIcon; text: ReactNode }[]
    foot?: ReactNode
    className?: string
}) {
    return (
        <div className={cx('ui-list-card', className)}>
            <div className="ui-list-card-top">
                <span className="ui-item-title">{title}</span>
                {status}
            </div>
            {details.map((d, i) => <div key={i} className="ui-meta"><Icon icon={d.icon} size={16} />{d.text}</div>)}
            {foot && <div className="ui-list-card-foot">{foot}</div>}
        </div>
    )
}

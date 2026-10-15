import type { ReactNode } from 'react'
import { Icon, type PhosphorIcon } from './Icon'
import { cx } from './cx'

/**
 * The smaller building blocks (DESIGN.md §5.5): the page header, panels and
 * cards, total tiles and the empty state.
 */

/** The page's title, an optional one-line subtitle, and its one primary action on the end side. */
export function PageHeader({ title, subtitle, action }: { title: ReactNode; subtitle?: ReactNode; action?: ReactNode }) {
    return (
        <header className="ui-page-header">
            <div>
                <h1 className="ui-page-title">{title}</h1>
                {subtitle && <p className="ui-page-subtitle">{subtitle}</p>}
            </div>
            {action}
        </header>
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

/** Totals above a list: up to four in a row on computers, two on phones. */
export function TotalTiles({ items }: { items: { label: ReactNode; value: ReactNode }[] }) {
    return (
        <dl className="ui-tiles">
            {items.map((item, i) => (
                <div key={i} className="ui-panel ui-tile">
                    <dt>{item.label}</dt>
                    <dd>{item.value}</dd>
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

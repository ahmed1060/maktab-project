import { useId, type ReactNode } from 'react'
import { Icon, type PhosphorIcon } from './Icon'

/**
 * A note above a list's filter bar (DESIGN.md §5.3; LATER_CHANGES_PLAN.md
 * §3.1, step 5, PR 405), such as how many names are still missing a
 * language: a panel with a round neutral icon, a title naming it, and a
 * line saying what happens. The page shows it while it's so.
 */
export function ListNote({ icon, title, children }: { icon: PhosphorIcon; title: ReactNode; children: ReactNode }) {
    const id = useId()
    return (
        <section className="ui-panel ui-list-note" aria-labelledby={id}>
            <span className="ui-list-note-icon"><Icon icon={icon} size={18} /></span>
            <div className="ui-list-note-body">
                <h2 className="ui-list-note-title" id={id}>{title}</h2>
                <p className="ui-list-note-text">{children}</p>
            </div>
        </section>
    )
}

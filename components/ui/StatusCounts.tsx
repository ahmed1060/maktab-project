import { CheckIcon } from '@phosphor-icons/react/ssr'
import { Button } from './Button'
import { Icon } from './Icon'
import type { StatusTone } from './StatusBadge'

/** One status's pill: its word, how many have it, and its badge's meaning. */
export type StatusCount<K extends string> = { key: K; word: string; tone: StatusTone; count: string }

/**
 * Status counts (DESIGN.md §5.5; LATER_CHANGES_PLAN.md §6, PR 384): how many
 * of a list's people have each status, as a row of pills above the list, the
 * word first and its count after, in the status's badge colours. Each pill
 * is a button that shows only its status: pressed, it has a tick and the
 * brand ring, says so to screen readers, and a line under the row says so
 * too, with Show everyone. Pressed again, it shows everyone.
 */
export function StatusCounts<K extends string>({ label, items, pressed, onPress, showing, showEveryone }: {
    /** What the row is, for screen readers, such as "People by status". */
    label: string
    items: StatusCount<K>[]
    pressed: K | null
    onPress: (key: K | null) => void
    /** The line while one is pressed, such as "Showing online people only." */
    showing: string
    showEveryone: string
}) {
    return (
        <div className="ui-status-counts">
            <div role="group" aria-label={label} className="ui-status-counts-row">
                {items.map(item => {
                    const on = item.key === pressed
                    return (
                        <button key={item.key} type="button" className={`ui-status-count ui-badge-${item.tone}`} aria-pressed={on} onClick={() => onPress(on ? null : item.key)}>
                            {on && <Icon icon={CheckIcon} size={16} weight="bold" />}
                            <span>{item.word}</span><span className="ui-status-count-n">{item.count}</span>
                        </button>
                    )
                })}
            </div>
            {pressed && (
                <p className="ui-hint ui-status-counts-line" role="status">{showing} <Button variant="quiet" size="sm" onClick={() => onPress(null)}>{showEveryone}</Button></p>
            )}
        </div>
    )
}

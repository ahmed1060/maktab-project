import type { Icon as PhosphorIcon, IconWeight } from '@phosphor-icons/react'
import { cx } from './cx'

export type { PhosphorIcon }

/**
 * A Phosphor icon (DESIGN.md §6), imported one at a time from
 * '@phosphor-icons/react/ssr', which works in server and client components.
 *
 * Decorative unless it has a label: beside its word, an icon adds nothing for
 * a screen reader. A `directional` icon (an arrow, a chevron, back or next)
 * mirrors in Arabic; nothing else ever does.
 */
export function Icon({ icon: Glyph, size = 18, weight = 'regular', directional = false, label, className }: {
    icon: PhosphorIcon
    size?: number
    weight?: IconWeight
    directional?: boolean
    label?: string
    className?: string
}) {
    const names = cx('ui-icon', directional && 'ui-flip', className)
    return label
        ? <Glyph size={size} weight={weight} className={names} role="img" aria-label={label} />
        : <Glyph size={size} weight={weight} className={names} aria-hidden="true" focusable="false" />
}

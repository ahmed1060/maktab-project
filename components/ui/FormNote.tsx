import type { ReactNode } from 'react'
import { TranslateIcon } from '@phosphor-icons/react/ssr'
import { Icon, type PhosphorIcon } from './Icon'

/**
 * A note at the top of a form (DESIGN.md §5.3; LATER_CHANGES_PLAN.md §3.1,
 * step 4b, PR 403), such as a name saved in one language asked for in the
 * other: what's so, beside a round neutral icon, over a hairline. It's part
 * of the form, read in its place, and goes once what it says is done.
 */
export function FormNote({ icon = TranslateIcon, children }: { icon?: PhosphorIcon; children: ReactNode }) {
    return (
        <div className="ui-form-note">
            <span className="ui-form-note-icon"><Icon icon={icon} size={18} /></span>
            <p className="ui-form-note-text">{children}</p>
        </div>
    )
}

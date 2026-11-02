import { Fragment, type ReactNode } from 'react'

/**
 * A sentence from the translations with its blanks filled by what's given,
 * which can be elements: a schedule's name inside <bdi>, kept apart from
 * the words around it so its own direction can't reorder them (the audit on
 * company settings part 3a). "{name} from {date}" with a name and a date.
 */
export function fill(template: string, values: Record<string, ReactNode>): ReactNode {
    return template.split(/(\{\w+\})/).map((part, i) => {
        const key = /^\{(\w+)\}$/.exec(part)?.[1]
        return <Fragment key={i}>{key !== undefined && key in values ? values[key] : part}</Fragment>
    })
}

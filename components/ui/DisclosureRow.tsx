'use client'

import { useId, type ReactNode } from 'react'
import { CaretDownIcon } from '@phosphor-icons/react/ssr'
import { Icon } from './Icon'

/**
 * A row that opens to show its item's lines below it, such as a person's pay
 * on Payroll (DESIGN.md §5.5, Rows). Its title and detail are the button that
 * opens it, which says whether it's open, with a caret that turns. Its own
 * links and buttons, such as a payslip's, go at its end, beside the button
 * and never inside it. The page keeps which rows are open.
 *
 * The lines are there while it's closed, hidden, so the button always names
 * what it opens.
 */
export function DisclosureRow({ title, detail, end, open, onToggle, label, lines }: {
    title: ReactNode
    detail?: ReactNode
    end?: ReactNode
    open: boolean
    onToggle: () => void
    /** What the lines are, for screen readers ("Hana Ali's pay"). */
    label: string
    /** Each with its amount or value at the end. */
    lines: { label: ReactNode; value: ReactNode }[]
}) {
    const id = useId()
    return (
        <li>
            <div className="ui-row">
                <button type="button" className="ui-row-main ui-row-toggle" aria-expanded={open} aria-controls={id} onClick={onToggle}>
                    <span className="ui-item-title">{title}<Icon icon={CaretDownIcon} size={16} className="ui-row-caret" /></span>
                    {detail && <span className="ui-item-detail">{detail}</span>}
                </button>
                {end && <span className="ui-row-end">{end}</span>}
            </div>
            <ul id={id} className="ui-row-lines" aria-label={label} hidden={!open}>
                {lines.map((line, i) => <li key={i}><span>{line.label}</span><span className="ui-num">{line.value}</span></li>)}
            </ul>
        </li>
    )
}

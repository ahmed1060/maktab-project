'use client'

import { Icon, type PhosphorIcon } from './Icon'

export type SegmentedOption<T extends string> = {
    value: T
    label: string
    /** A shorter label, shown in its place on a phone's top bar (DESIGN.md §5.1): the label stays its name. */
    short?: string
    /** The option's own language, when it's written in one other than the page's. */
    lang?: string
    icon?: PhosphorIcon
}

/**
 * A switch between two or three choices, all of them in view and the one in
 * use marked (DESIGN.md §5.1): the language switch and the theme switch.
 *
 * Named by `label`, or by a visible label's id in `labelledBy`. `fixedOrder`
 * keeps the options in their order in Arabic too, for a switch that is about
 * language rather than in one: it would otherwise swap sides the moment it's
 * used, moving the option just picked to the other end.
 */
export function Segmented<T extends string>({ value, options, onChange, label, labelledBy, disabled = false, fixedOrder = false }: {
    value: T
    options: SegmentedOption<T>[]
    onChange: (value: T) => void
    label?: string
    labelledBy?: string
    disabled?: boolean
    fixedOrder?: boolean
}) {
    return (
        <div role="group" aria-label={labelledBy ? undefined : label} aria-labelledby={labelledBy} className="ui-segmented" dir={fixedOrder ? 'ltr' : undefined}>
            {options.map(o => (
                <button key={o.value} type="button" className="ui-segmented-option" aria-pressed={o.value === value} lang={o.lang} aria-label={o.short ? o.label : undefined}
                    disabled={disabled} onClick={() => { if (o.value !== value) onChange(o.value) }}>
                    {o.icon && <Icon icon={o.icon} size={16} />}
                    {o.short
                        ? <><span className="ui-segmented-long">{o.label}</span><span className="ui-segmented-short" aria-hidden="true">{o.short}</span></>
                        : o.label}
                </button>
            ))}
        </div>
    )
}

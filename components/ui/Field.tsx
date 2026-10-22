'use client'

import { useId, type ComponentPropsWithoutRef, type ReactNode } from 'react'
import { CaretDownIcon, MagnifyingGlassIcon } from '@phosphor-icons/react/ssr'
import { Icon, type PhosphorIcon } from './Icon'
import { cx } from './cx'

/** What a control needs from its Field: the id its label points at, and its hint or error. */
export type FieldControlProps = { id: string; 'aria-describedby'?: string; 'aria-invalid'?: true }

/**
 * A label, a control, and a hint or an error (DESIGN.md §5.3). The label is
 * always there; `hideLabel` keeps it for screen readers only, which is for the
 * filter bar alone, where what a control shows already names it.
 */
export function Field({ label, hint, error, hideLabel = false, className, children }: {
    label: ReactNode
    hint?: ReactNode
    error?: ReactNode
    hideLabel?: boolean
    className?: string
    children: (control: FieldControlProps) => ReactNode
}) {
    const id = useId()
    const note = error ? `${id}-error` : hint ? `${id}-hint` : undefined
    return (
        <div className={cx('ui-field', className)}>
            <label htmlFor={id} className={hideLabel ? 'ui-visually-hidden' : 'ui-label'}>{label}</label>
            {children({ id, 'aria-describedby': note, 'aria-invalid': error ? true : undefined })}
            {error ? <span id={note} className="ui-error">{error}</span> : hint && <span id={note} className="ui-hint">{hint}</span>}
        </div>
    )
}

export function TextInput({ icon, className, ...rest }: { icon?: PhosphorIcon } & ComponentPropsWithoutRef<'input'>) {
    return (
        <span className={cx('ui-control', icon && 'has-start-icon')}>
            {icon && <Icon icon={icon} size={16} />}
            <input className={cx('ui-input', className)} {...rest} />
        </span>
    )
}

/** A field for more than one line. */
export function TextArea({ className, ...rest }: ComponentPropsWithoutRef<'textarea'>) {
    return <textarea className={cx('ui-input ui-textarea', className)} {...rest} />
}

/**
 * A choice between a few options, as radio buttons under a visible group
 * label. `warning` says why an option can't be picked, or what picking one
 * means, beside the group.
 */
export function Choice<V extends string>({ legend, name, value, onChange, options, warning }: {
    legend: ReactNode
    name: string
    value: V
    onChange: (value: V) => void
    options: { value: V; label: ReactNode; disabled?: boolean }[]
    warning?: ReactNode
}) {
    const id = useId()
    return (
        <fieldset className="ui-choices" aria-describedby={warning ? `${id}-warning` : undefined}>
            <legend className="ui-label">{legend}</legend>
            {options.map(o => (
                <label key={o.value} className="ui-choice" data-disabled={o.disabled || undefined}>
                    <input type="radio" className="ui-radio" name={name} value={o.value} checked={value === o.value} disabled={o.disabled} onChange={() => onChange(o.value)} />
                    {o.label}
                </label>
            ))}
            {warning && <span id={`${id}-warning`} className="ui-error">{warning}</span>}
        </fieldset>
    )
}

export function SearchInput(props: Omit<ComponentPropsWithoutRef<'input'>, 'type'>) {
    return <TextInput icon={MagnifyingGlassIcon} type="search" {...props} />
}

/** An option; one that can't be picked yet stays listed, greyed, with why in its label (DESIGN.md §5.3). */
export type SelectOption = { value: string; label: string; disabled?: boolean }

const option = (o: SelectOption) => <option key={o.value} value={o.value} disabled={o.disabled}>{o.label}</option>

/**
 * A select. `groups` follow the options, each under its own heading, as a
 * client's locations and then the shared ones (DESIGN.md §5.3); a group with
 * none is left out.
 */
export function Select({ icon, options, groups = [], className, id, ...rest }: {
    icon?: PhosphorIcon
    options: SelectOption[]
    groups?: { label: string; options: SelectOption[] }[]
} & Omit<ComponentPropsWithoutRef<'select'>, 'children'>) {
    return (
        <span className={cx('ui-control', icon && 'has-start-icon')}>
            {icon && <Icon icon={icon} size={16} />}
            {/* The id is the Field's label's, written out so it's plain the select has one. */}
            <select id={id} className={cx('ui-select', className)} {...rest}>
                {options.map(option)}
                {groups.filter(g => g.options.length > 0).map(g => <optgroup key={g.label} label={g.label}>{g.options.map(option)}</optgroup>)}
            </select>
            <Icon icon={CaretDownIcon} size={16} className="ui-icon-end" />
        </span>
    )
}

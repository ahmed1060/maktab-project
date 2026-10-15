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

export function SearchInput(props: Omit<ComponentPropsWithoutRef<'input'>, 'type'>) {
    return <TextInput icon={MagnifyingGlassIcon} type="search" {...props} />
}

export type SelectOption = { value: string; label: string }

export function Select({ icon, options, className, id, ...rest }: { icon?: PhosphorIcon; options: SelectOption[] } & Omit<ComponentPropsWithoutRef<'select'>, 'children'>) {
    return (
        <span className={cx('ui-control', icon && 'has-start-icon')}>
            {icon && <Icon icon={icon} size={16} />}
            {/* The id is the Field's label's, written out so it's plain the select has one. */}
            <select id={id} className={cx('ui-select', className)} {...rest}>
                {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            <Icon icon={CaretDownIcon} size={16} className="ui-icon-end" />
        </span>
    )
}

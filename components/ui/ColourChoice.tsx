'use client'

import { useId, useState, type CSSProperties, type ReactNode } from 'react'
import { EXAMPLE_BRAND_CODE, readBrandHex } from '@/lib/brand-colour'
import { useAdjustOnChange } from '@/lib/useAdjustOnChange'
import { Field, TextInput } from './Field'

/**
 * A colour choice (DESIGN.md §5.3): round swatches, each a radio button named
 * by its colour for screen readers, "Use the default" first where there's one,
 * and a field for a colour code below.
 *
 * `value` is the chosen colour as #rrggbb, null for the default, or undefined
 * while the typed code isn't a colour. A typed code that matches a swatch
 * selects it.
 */
export function ColourChoice({ legend, value, onChange, swatches, defaultOption, codeLabel, codeHint, invalidCode, disabled = false }: {
    legend: ReactNode
    value: string | null | undefined
    onChange: (value: string | null | undefined) => void
    swatches: { value: string; label: string }[]
    /** "Use the default", with the default's colour, for a setting that can go back to it. */
    defaultOption?: { label: ReactNode; colour: string }
    codeLabel: ReactNode
    codeHint?: ReactNode
    /** Said under the code field when what's typed isn't a colour code. */
    invalidCode: ReactNode
    disabled?: boolean
}) {
    const name = useId()
    const [code, setCode] = useState(value ?? '')
    // A swatch picked, or the saved colour arriving: the field shows it. Not
    // while the field holds a code of its own, which is what set the value.
    useAdjustOnChange([value], () => {
        if (value === null) setCode('')
        else if (typeof value === 'string' && readBrandHex(code) !== value) setCode(value)
    })
    const typedBad = code.trim() !== '' && readBrandHex(code) === null

    const swatch = (colour: string) => <span className="ui-swatch" style={{ ['--swatch' as string]: colour } as CSSProperties} aria-hidden="true" />
    return (
        <div className="ui-colour-choice">
            <fieldset className="ui-swatches" disabled={disabled}>
                <legend className="ui-label">{legend}</legend>
                <div className="ui-swatch-row">
                    {defaultOption && (
                        <label className="ui-swatch-option ui-swatch-default">
                            <input type="radio" name={name} className="ui-visually-hidden" checked={value === null} onChange={() => onChange(null)} />
                            {swatch(defaultOption.colour)}
                            <span>{defaultOption.label}</span>
                        </label>
                    )}
                    {swatches.map(s => (
                        <label key={s.value} className="ui-swatch-option" title={s.label}>
                            <input type="radio" name={name} className="ui-visually-hidden" checked={value === s.value} onChange={() => onChange(s.value)} />
                            {swatch(s.value)}
                            <span className="ui-visually-hidden">{s.label}</span>
                        </label>
                    ))}
                </div>
            </fieldset>
            <Field label={codeLabel} hint={codeHint} error={typedBad ? invalidCode : undefined}>{p => (
                <TextInput
                    {...p}
                    className="ui-colour-code"
                    value={code}
                    disabled={disabled}
                    name="colour-code"
                    dir="ltr"
                    translate="no"
                    spellCheck={false}
                    autoComplete="off"
                    maxLength={7}
                    placeholder={EXAMPLE_BRAND_CODE}
                    onChange={e => {
                        setCode(e.target.value)
                        onChange(readBrandHex(e.target.value) ?? undefined)
                    }}
                />
            )}</Field>
        </div>
    )
}

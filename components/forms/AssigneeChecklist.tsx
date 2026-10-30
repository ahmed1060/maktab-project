'use client'

import { useState } from 'react'
import { useLanguage } from '@/context/LanguageContext'
import { Field, SearchInput } from '@/components/ui'
import type { TranslationKey } from '@/lib/translations'

export type Assignable = { id: string; firstName: string; lastName: string; role?: string | null }

/**
 * Who a task or an obligation is for (DESIGN.md §5.3, a pick of several from
 * a long list): as many as it needs, found by name, each with their role.
 * `people` is undefined while they load, and null when they couldn't be.
 */
export default function AssigneeChecklist({ people, value, onChange, disabled = false, error, id }: {
    people: Assignable[] | null | undefined
    value: string[]
    onChange: (ids: string[]) => void
    disabled?: boolean
    error?: string
    /** For the form to put the focus here when it's the first thing wrong. */
    id?: string
}) {
    const { t } = useLanguage()
    const [searchTerm, setSearchTerm] = useState('')
    const errorId = id ? `${id}-error` : undefined
    const shown = (people ?? []).filter(u => `${u.firstName} ${u.lastName}`.toLowerCase().includes(searchTerm.toLowerCase()))
    return (
        <fieldset id={id} className="ui-field ui-fieldset" aria-describedby={error ? errorId : undefined}>
            <legend className="ui-label">{t('assignees_label')}</legend>
            <Field label={t('assignees_search')} hideLabel>{p => (
                <SearchInput {...p} autoComplete="off" placeholder={t('assignees_search')} value={searchTerm} onChange={e => setSearchTerm(e.target.value)} />
            )}</Field>
            <div className="ui-checklist">
                {people === undefined
                    ? <p className="ui-hint" role="status">{t('loading')}</p>
                    : people === null
                        ? <p className="ui-error" role="alert">{t('failed_load_employees')}</p>
                        : shown.length === 0
                            ? <p className="ui-hint">{t('assignees_none_match')}</p>
                            : shown.map(u => (
                                <label key={u.id} className="ui-choice">
                                    <input
                                        type="checkbox"
                                        className="ui-check"
                                        checked={value.includes(u.id)}
                                        disabled={disabled}
                                        onChange={e => onChange(e.target.checked ? [...value, u.id] : value.filter(picked => picked !== u.id))}
                                    />
                                    <bdi>{u.firstName} {u.lastName}</bdi>
                                    {u.role && <span className="ui-hint">{t(`role_${String(u.role).toLowerCase()}` as TranslationKey)}</span>}
                                </label>
                            ))}
            </div>
            {error && <span id={errorId} className="ui-error">{error}</span>}
        </fieldset>
    )
}

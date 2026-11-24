'use client'

import { useState, type ReactNode } from 'react'
import { WarningCircleIcon } from '@phosphor-icons/react/ssr'
import { useLanguage } from '@/context/LanguageContext'
import { Button, EmptyState, Field, SearchInput } from '@/components/ui'
import { byNameIn, personMatches, personName } from '@/lib/names'
import type { Locale, TranslationKey } from '@/lib/translations'

/** Who can be picked: their names, each in Arabic too where the list has it (PR 412), and their role. */
export type Assignable = { id: string; firstName: string; lastName: string; firstNameAr?: string | null; lastNameAr?: string | null; role?: string | null }

const ROLE_ORDER: Record<string, number> = { EMPLOYEE: 1, TEAM_LEADER: 2, ADMIN: 3, SUPER_ADMIN: 4 }

/**
 * Who New task and New obligation offer, in their order: employees, then
 * team leaders, Admins and Super Admins, each in the page's order (PR 412):
 * on an Arabic page the ones with an Arabic name first, in Arabic order,
 * then the rest by their English first name, as before.
 */
export function assigneesByRole<P extends Assignable>(people: readonly P[], locale: Locale): P[] {
    const inPageOrder = byNameIn(locale)
    return [...people].sort((a, b) => ((ROLE_ORDER[a.role ?? ''] || 99) - (ROLE_ORDER[b.role ?? ''] || 99)) || inPageOrder(a, b) || a.firstName.localeCompare(b.firstName))
}

/**
 * Who a task or an obligation is for (DESIGN.md §5.3, a pick of several from
 * a long list): as many as it needs, found by name, each with their role.
 * `people` is undefined while they load, and null when they couldn't be,
 * which offers Try again as a list that didn't load does (DESIGN.md §5.5).
 */
export default function AssigneeChecklist({ people, value, onChange, onRetry, retrying = false, disabled = false, error, id, legend }: {
    people: Assignable[] | null | undefined
    /** What the people are picked for; "Assigned to" unless said, as for a task. */
    legend?: ReactNode
    onRetry: () => void
    /** While Try again is trying. */
    retrying?: boolean
    value: string[]
    onChange: (ids: string[]) => void
    disabled?: boolean
    error?: string
    /** For the form to put the focus here when it's the first thing wrong. */
    id?: string
}) {
    const { t, locale } = useLanguage()
    const [searchTerm, setSearchTerm] = useState('')
    const errorId = id ? `${id}-error` : undefined
    // In the page's language, or the one it has (PR 412). A name in one
    // part, as the attendance calendar has them, gets no space after it.
    const nameOf = (u: Assignable) => personName(u, locale)
    // Found by either language, as the people are in the order they're given.
    const shown = (people ?? []).filter(u => personMatches(u, searchTerm))
    return (
        <fieldset id={id} className="ui-field ui-fieldset" aria-describedby={error ? errorId : undefined}>
            <legend className="ui-label">{legend ?? t('assignees_label')}</legend>
            <Field label={t('assignees_search')} hideLabel>{p => (
                <SearchInput {...p} autoComplete="off" placeholder={t('assignees_search')} value={searchTerm} onChange={e => setSearchTerm(e.target.value)} />
            )}</Field>
            <div className="ui-checklist">
                {people === undefined
                    ? <p className="ui-hint" role="status">{t('loading')}</p>
                    : people === null
                        ? <EmptyState
                            icon={WarningCircleIcon}
                            title={<span role="alert">{t('failed_load_employees')}</span>}
                            action={<Button busy={retrying} onClick={onRetry}>{t('try_again')}</Button>}
                        />
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
                                    <bdi>{nameOf(u)}</bdi>
                                    {u.role && <span className="ui-hint">{t(`role_${String(u.role).toLowerCase()}` as TranslationKey)}</span>}
                                </label>
                            ))}
            </div>
            {error && <span id={errorId} className="ui-error">{error}</span>}
        </fieldset>
    )
}

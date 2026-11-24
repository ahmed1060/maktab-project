'use client'

import { useEffect, useId, useState, type KeyboardEvent, type ReactNode } from 'react'
import useSWR from 'swr'
import { useLanguage } from '@/context/LanguageContext'
import { countOf } from '@/lib/plural'
import { fetcher } from '@/lib/swr-fetcher'
import {
    fieldsInOrder, sourceOf, spellingOptions, suggestionPath, toSuggest,
    type NameLanguage, type SpellingOption, type TwoNames,
} from '@/lib/names/name-fields'
import type { Suggestion } from '@/lib/names/suggest'
import { Button } from './Button'
import { pickerKey } from './NamePicker'

/** How long after the last key the suggestion is asked (DESIGN.md §5.3). */
const ASK_AFTER_MS = 300

/**
 * A name in English and in Arabic (DESIGN.md §5.3; LATER_CHANGES_PLAN.md
 * §3.1, step 4a, PR 402), such as an employee's first or last name: a group
 * under the name's label, with a field for each language, the page's
 * language first on the start side, each in its own direction. When one is
 * typed and the other is empty, the empty one offers what it may be, asked
 * of the server (GET /api/names/suggest): a button to use it, where it
 * comes from beside it, and a word Nizmo guessed underlined with dots and
 * said under it. Focused, the empty one opens its spellings. Nothing goes in
 * a field until the button is pressed, a spelling picked or the name typed.
 */
export function NameFields({ label, name, value, onChange, max, errors = {}, kind = 'person', companyId, disabled }: {
    label: ReactNode
    /** The fields' names, as a form finds the first one wrong: the English one's, and with "Ar" the Arabic one's. */
    name: string
    value: TwoNames
    onChange: (value: TwoNames) => void
    max: number
    /** What's wrong with each, under it (lib/names/name-fields.ts, mistakeKey). */
    errors?: Partial<Record<NameLanguage, string>>
    kind?: 'person' | 'business'
    /** The Super Admin's company in view, whose spellings come first. */
    companyId?: string | null
    disabled?: boolean
}) {
    const { t, locale } = useLanguage()
    const id = useId()
    const asked = toSuggest(value)
    const wanted = asked ? suggestionPath(asked, kind, companyId) : null
    // Asked a moment after the last key; what was asked before is no one's once it changes.
    const [path, setPath] = useState<string | null>(null)
    useEffect(() => {
        const timer = setTimeout(() => setPath(wanted), wanted ? ASK_AFTER_MS : 0)
        return () => clearTimeout(timer)
    }, [wanted])
    const { data } = useSWR<{ data: Suggestion | null }>(path, fetcher)
    const suggestion = path === wanted ? data?.data ?? null : null

    const digits = (n: number) => n.toLocaleString(locale === 'ar' ? 'ar-EG' : 'en-GB')
    const used = (n: number) => t('ui_characters_used').replace('{used}', digits(n)).replace('{max}', digits(max))
    const use = (language: NameLanguage, text: string) => onChange({ ...value, [language]: text })

    return (
        <fieldset className="ui-name-fields" disabled={disabled}>
            <legend className="ui-name-fields-label">{label}</legend>
            <div className="ui-name-fields-row">
                {fieldsInOrder(locale).map(language => (
                    <OneLanguage
                        key={language}
                        id={`${id}-${language}`}
                        language={language}
                        name={language === 'en' ? name : `${name}Ar`}
                        text={value[language]}
                        onText={text => use(language, text)}
                        max={max}
                        hint={used(value[language].length)}
                        error={errors[language]}
                        suggestion={asked?.to === language ? suggestion : null}
                        typed={asked?.name ?? ''}
                        disabled={disabled}
                    />
                ))}
            </div>
        </fieldset>
    )
}

/** One language's field: its label, the field, what's wrong or how much it holds, and what it may be. */
function OneLanguage({ id, language, name, text, onText, max, hint, error, suggestion, typed, disabled }: {
    id: string
    language: NameLanguage
    name: string
    text: string
    onText: (text: string) => void
    max: number
    hint: string
    error?: string
    suggestion: Suggestion | null
    typed: string
    disabled?: boolean
}) {
    const { t, locale } = useLanguage()
    const [open, setOpen] = useState(false)
    const direction = language === 'ar' ? 'rtl' : 'ltr'
    const options: SpellingOption[] = suggestion ? spellingOptions(suggestion) : []
    // What's under the keys, in the list it was moved in: another list, as
    // the other field's name changes, starts with nothing under them (Codex, PR 402).
    const list = options.map(option => option.text).join('\n')
    const [held, setHeld] = useState({ list: '', at: -1 })
    const under = held.list === list ? held.at : -1
    const setUnder = (at: number) => setHeld({ list, at })
    const shown = open && options.length > 0
    const noteId = `${id}-note`
    const offerId = `${id}-offer`
    const guessId = `${id}-guess`
    const listId = `${id}-list`
    const optionId = (i: number) => `${listId}-${i}`
    const source = suggestion && sourceOf(suggestion)
    const guesses = suggestion?.guesses ?? []
    const quoted = (word: string) => (locale === 'ar' ? `«${word}»` : `“${word}”`)
    const detail = (option: SpellingOption) => (option.uses ? countOf(t, locale, option.uses, 'used_for') : option.usual ? t('name_usual_spelling') : '')

    const pick = (option: SpellingOption) => {
        onText(option.text)
        setOpen(false)
        setUnder(-1)
    }
    const keys = (e: KeyboardEvent<HTMLInputElement>) => {
        const next = pickerKey(e, { shown, active: under, count: options.length })
        if (!next) return
        if ('close' in next) setOpen(false)
        else if ('move' in next) { setOpen(true); setUnder(next.move) }
        else pick(options[next.choose])
    }
    const [before, after] = t('name_use').split('{name}')
    const said = source === 'usual' ? t('name_usual_spelling') : source ? countOf(t, locale, source.uses, 'used_for') : ''

    return (
        <div className="ui-field">
            <label htmlFor={id} className="ui-label">{t(language === 'en' ? 'name_in_english' : 'name_in_arabic')}</label>
            <div className="ui-namepicker">
                <span className="ui-control">
                    <input
                        id={id}
                        name={name}
                        className="ui-input"
                        type="text"
                        dir={direction}
                        lang={language}
                        autoComplete="off"
                        spellCheck={false}
                        maxLength={max}
                        value={text}
                        disabled={disabled}
                        aria-invalid={error ? true : undefined}
                        aria-describedby={[noteId, suggestion && offerId, guesses.length > 0 && guessId].filter(Boolean).join(' ')}
                        {...(options.length > 0 ? {
                            role: 'combobox',
                            'aria-autocomplete': 'list' as const,
                            'aria-expanded': shown,
                            'aria-controls': listId,
                            'aria-activedescendant': shown && under >= 0 ? optionId(under) : undefined,
                        } : {})}
                        // Typing closes its spellings; emptied, they open again.
                        onChange={e => { onText(e.target.value); setUnder(-1); setOpen(!e.target.value) }}
                        onFocus={() => setOpen(true)}
                        onBlur={() => setOpen(false)}
                        onKeyDown={keys}
                    />
                </span>
                {options.length > 0 && (
                    <ul id={listId} role="listbox" className="ui-suggestions" aria-label={t('name_spellings').replace('{name}', typed)} hidden={!shown}>
                        {options.map((option, i) => (
                            <li key={option.text} id={optionId(i)} role="option" aria-selected={under === i} className="ui-suggestion ui-spelling"
                                // Kept from taking the focus, so the field doesn't close the list first.
                                onMouseDown={e => e.preventDefault()} onClick={() => pick(option)}>
                                <bdi dir={direction}>{option.text}</bdi>
                                <span className="ui-spelling-detail">{detail(option)}</span>
                            </li>
                        ))}
                    </ul>
                )}
            </div>
            {error ? <span id={noteId} className="ui-error">{error}</span> : <span id={noteId} className="ui-hint">{hint}</span>}
            {suggestion && (
                <div id={offerId} className="ui-name-offer">
                    <Button size="sm" className="ui-name-use" disabled={disabled} onClick={() => { onText(suggestion.text); setOpen(false) }}>
                        {/* One run of text, so the button's gap doesn't part the quotes from the name. */}
                        <span>
                            {before}
                            <bdi dir={direction}>
                                {suggestion.words.map((word, i) => (
                                    <span key={i}>
                                        {i > 0 && ' '}
                                        <span className={word.from === 'rules' ? 'ui-name-guessed' : undefined}>{word.text}</span>
                                    </span>
                                ))}
                            </bdi>
                            {after}
                        </span>
                    </Button>
                    {said && <span className="ui-hint">{said}</span>}
                </div>
            )}
            {/* Said to a screen reader as it's offered, while the other field is being typed in. */}
            <span className="ui-visually-hidden" aria-live="polite">{suggestion ? [t('name_use').replace('{name}', suggestion.text), said].filter(Boolean).join('. ') : ''}</span>
            {suggestion && guesses.length > 0 && (
                <span id={guessId} className="ui-name-guess">
                    {guesses.length === 1
                        ? t('name_guess').replace('{word}', guesses[0])
                        : t('name_guesses').replace('{words}', guesses.map(quoted).join(locale === 'ar' ? '، ' : ', '))}
                </span>
            )}
        </div>
    )
}

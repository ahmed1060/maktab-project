'use client'

import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { PlusIcon } from '@phosphor-icons/react/ssr'
import { useLanguage } from '@/context/LanguageContext'
import { countOf } from '@/lib/plural'
import { Icon } from './Icon'
import type { FieldControlProps } from './Field'

/** A name as typed, and the one it was picked as from the list; none for one typed. */
export type PickedName = { text: string; entryId: string | null }
export type ListedName = { id: string; name: string }

const SAME = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase()
/** How long after the last key the list is asked (DESIGN.md §5.3). */
const ASK_AFTER_MS = 200

/** The name with the part typed in bold. */
function marked(name: string, typed: string): ReactNode {
    const at = name.toLowerCase().indexOf(typed.trim().toLowerCase())
    if (!typed.trim() || at < 0) return name
    const end = at + typed.trim().length
    return <>{name.slice(0, at)}<strong>{name.slice(at, end)}</strong>{name.slice(end)}</>
}

/** The list's last answer: to what was typed, from which list. */
export type Answer = { for: string; by: unknown; names: ListedName[] }

/**
 * The suggestions for what's typed now: the last answer while it's to this,
 * else those of its names that still contain it, until the list answers;
 * none from another list (another company's). The one under the keys counts
 * only for what was typed when the keys moved to it, so typed over, Enter
 * is the form's again rather than picking a name for what was typed before
 * (Codex review of PR 105).
 */
export function shownSuggestions(answer: Answer, under: { for: string; index: number }, typed: string, by: unknown) {
    if (answer.by !== by) return { names: [] as ListedName[], active: -1 }
    const names = answer.for === typed ? answer.names : answer.names.filter(n => n.name.toLowerCase().includes(typed.toLowerCase()))
    return { names, active: under.for === typed ? under.index : -1 }
}

/**
 * Whether a name just added goes in the field: only while the field still
 * holds what was added, unpicked, with the same list. Typed over while it
 * was added, or a cost added and the next one begun, the field keeps
 * what's in it now; the name is on the list all the same (Codex review of
 * PR 105).
 */
export function addLands(asked: { text: string; by: unknown }, now: { value: PickedName; by: unknown }) {
    return now.by === asked.by && !now.value.entryId && SAME(now.value.text, asked.text)
}

/** The field as it is now: what it holds, and its form's callbacks this render. */
export type FieldNow = { value: PickedName; onAdd?: (name: string) => Promise<ListedName>; onChange: (value: PickedName) => void }

/**
 * "+ Add": adds what's typed, then fills the field with the name if it
 * still holds what was added (addLands), through the form as it is by then:
 * the onChange of that render, not of the one Add was pressed in, which put
 * back what else the form held then, such as a description edited meanwhile
 * in Edit task details (Codex review of PR 105). Whether it filled the field;
 * an add that failed throws, while the field still holds what it was for.
 */
export async function addAndFill(typed: string, now: () => FieldNow): Promise<boolean> {
    const by = now().onAdd
    if (!by) return false
    const lands = () => addLands({ text: typed, by }, { value: now().value, by: now().onAdd })
    try {
        const name = await by(typed)
        if (!lands()) return false
        now().onChange({ text: name.name, entryId: name.id })
        return true
    } catch (e) {
        if (lands()) throw e
        return false
    }
}

type KeyPress = { key: string; preventDefault: () => void; stopPropagation: () => void }
type KeyAction = { close: true } | { move: number } | { choose: number } | null

/**
 * What a key in the field does, with `count` suggestions and the one under
 * the keys at `active` (-1 for none). Escape closes the suggestions, and
 * only them: a dialog around the field gets the next one (Codex review of PR
 * 105; it closed Edit task details too, and what was typed in it).
 */
export function pickerKey(e: KeyPress, { shown, active, count }: { shown: boolean; active: number; count: number }): KeyAction {
    if (e.key === 'Escape' && shown) { e.preventDefault(); e.stopPropagation(); return { close: true } }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        if (!count) return { move: -1 }
        return { move: e.key === 'ArrowDown' ? (active + 1) % count : (active <= 0 ? count - 1 : active - 1) }
    }
    // Enter picks what's under the keys; with nothing under them, it's the form's.
    if (e.key === 'Enter' && shown && active >= 0) { e.preventDefault(); return { choose: active } }
    return null
}

/**
 * A name typed or picked from a saved list (DESIGN.md §5.3), such as a task's
 * title or a cost's name (CLIENTS_PLAN.md §5): a text field that suggests the
 * list's names as it's typed. What's typed is kept as it is when nothing is
 * picked; picking a name links the field to it, and typing again unlinks it.
 * With `onAdd`, the last line offers "+ Add 'X' to the list" for a name that
 * isn't on it, the only way one is added.
 */
export function NamePicker({ value, onChange, suggest, onAdd, addLabel, failedLabel, maxLength, placeholder, disabled, id, ...field }: {
    value: PickedName
    onChange: (value: PickedName) => void
    /** The list's names that contain what's typed. */
    suggest: (typed: string) => Promise<ListedName[]>
    /** Adds what's typed to the list and gives back the name; none for whoever may not add. */
    onAdd?: (name: string) => Promise<ListedName>
    /** "+ Add '{name}' to the list": the name typed goes where `{name}` is, kept in its own direction. */
    addLabel: string
    /** What a failed add says, when the server gives no reason. */
    failedLabel: string
    maxLength?: number
    placeholder?: string
    disabled?: boolean
} & FieldControlProps) {
    const { t, locale } = useLanguage()
    const listId = useId()
    const [answer, setAnswer] = useState<Answer>({ for: '', by: null, names: [] })
    const [open, setOpen] = useState(false)
    const [under, setUnder] = useState({ for: '', index: -1 })
    const [adding, setAdding] = useState(false)
    const [problem, setProblem] = useState<string | null>(null)
    const asked = useRef(0)
    const typed = value.text.trim()
    // The field and its form as they are now, for an add that answers after they changed.
    const latest = useRef<FieldNow>({ value, onAdd, onChange })
    useEffect(() => { latest.current = { value, onAdd, onChange } })

    // The list, asked a moment after the last key; an answer to an older
    // question than the last is dropped.
    useEffect(() => {
        if (!open || !typed || value.entryId) return
        const ask = ++asked.current
        const timer = setTimeout(() => {
            const answered = (names: ListedName[]) => {
                if (ask !== asked.current) return
                setAnswer({ for: typed, by: suggest, names })
                setUnder({ for: typed, index: -1 })
            }
            suggest(typed).then(answered, () => answered([]))
        }, ASK_AFTER_MS)
        return () => clearTimeout(timer)
    }, [typed, open, value.entryId, suggest])

    const { names, active } = shownSuggestions(answer, under, typed, suggest)
    const offerAdd = !!onAdd && !!typed && !names.some(n => SAME(n.name, typed))
    const shown = open && !!typed && !value.entryId && (names.length > 0 || offerAdd)
    const count = names.length + (offerAdd ? 1 : 0)
    const optionId = (i: number) => `${listId}-${i}`

    const pick = (n: ListedName) => {
        onChange({ text: n.name, entryId: n.id })
        setOpen(false)
        setProblem(null)
    }
    const add = async () => {
        if (!onAdd || adding) return
        setAdding(true)
        setProblem(null)
        try {
            if (await addAndFill(typed, () => latest.current)) setOpen(false)
        } catch (e) {
            setProblem(e instanceof Error && e.message ? e.message : failedLabel)
        } finally {
            setAdding(false)
        }
    }
    const choose = (i: number) => (i < names.length ? pick(names[i]) : void add())

    const keys = (e: KeyboardEvent<HTMLInputElement>) => {
        const next = pickerKey(e, { shown, active, count })
        if (!next) return
        if ('close' in next) setOpen(false)
        else if ('move' in next) { setOpen(true); if (next.move >= 0) setUnder({ for: typed, index: next.move }) }
        else choose(next.choose)
    }

    return (
        <div className="ui-namepicker">
            <span className="ui-control">
                <input
                    {...field}
                    id={id}
                    className="ui-input"
                    role="combobox"
                    aria-autocomplete="list"
                    aria-expanded={shown}
                    aria-controls={listId}
                    aria-activedescendant={shown && active >= 0 ? optionId(active) : undefined}
                    autoComplete="off"
                    value={value.text}
                    maxLength={maxLength}
                    placeholder={placeholder}
                    disabled={disabled}
                    onChange={e => { onChange({ text: e.target.value, entryId: null }); setOpen(true); setProblem(null) }}
                    onFocus={() => setOpen(true)}
                    onBlur={() => setOpen(false)}
                    onKeyDown={keys}
                />
            </span>
            <ul id={listId} role="listbox" className="ui-suggestions" hidden={!shown}>
                {names.map((n, i) => (
                    <li key={n.id} id={optionId(i)} role="option" aria-selected={active === i} className="ui-suggestion"
                        // Kept from taking the focus, so the field doesn't close the list first.
                        onMouseDown={e => e.preventDefault()} onClick={() => pick(n)}>
                        <bdi>{marked(n.name, typed)}</bdi>
                    </li>
                ))}
                {offerAdd && (
                    <li id={optionId(names.length)} role="option" aria-selected={active === names.length} aria-disabled={adding || undefined} className="ui-suggestion ui-suggestion-add"
                        onMouseDown={e => e.preventDefault()} onClick={() => void add()}>
                        <Icon icon={PlusIcon} size={16} />
                        <span>{addLabel.split('{name}').map((part, i) => <span key={i}>{i > 0 && <bdi>{typed}</bdi>}{part}</span>)}</span>
                    </li>
                )}
            </ul>
            {problem && <span className="ui-error" role="alert">{problem}</span>}
            {/* How many it suggests, said once they come, as they come without a key pressed. */}
            <span className="ui-visually-hidden" aria-live="polite">{shown && names.length > 0 ? countOf(t, locale, names.length, 'names') : ''}</span>
        </div>
    )
}

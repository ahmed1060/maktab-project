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
    const [names, setNames] = useState<ListedName[]>([])
    const [open, setOpen] = useState(false)
    const [active, setActive] = useState(-1)
    const [adding, setAdding] = useState(false)
    const [problem, setProblem] = useState<string | null>(null)
    const asked = useRef(0)
    const typed = value.text.trim()

    // The list, asked a moment after the last key; an answer to an older
    // question than the last is dropped.
    useEffect(() => {
        if (!open || !typed || value.entryId) return
        const ask = ++asked.current
        const timer = setTimeout(() => {
            suggest(typed).then(found => { if (ask === asked.current) { setNames(found); setActive(-1) } }, () => { if (ask === asked.current) setNames([]) })
        }, ASK_AFTER_MS)
        return () => clearTimeout(timer)
    }, [typed, open, value.entryId, suggest])

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
            pick(await onAdd(typed))
        } catch (e) {
            setProblem(e instanceof Error && e.message ? e.message : failedLabel)
        } finally {
            setAdding(false)
        }
    }
    const choose = (i: number) => (i < names.length ? pick(names[i]) : void add())

    const keys = (e: KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Escape' && shown) { e.preventDefault(); setOpen(false); return }
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault()
            setOpen(true)
            if (count) setActive(a => (e.key === 'ArrowDown' ? (a + 1) % count : (a <= 0 ? count - 1 : a - 1)))
            return
        }
        // Enter picks what's under the keys; with nothing under them, it's the form's.
        if (e.key === 'Enter' && shown && active >= 0) { e.preventDefault(); choose(active) }
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

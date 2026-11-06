'use client'

import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react'
import { useLanguage } from '@/context/LanguageContext'
import { pickerKey, type FieldControlProps } from '@/components/ui'
import { countOf } from '@/lib/plural'
import { foundPlaces, placeSearchUrl, searchable, type FoundPlace } from '@/lib/place-search'

/** How long after the last key it asks: each question is a request to HERE. */
const ASK_AFTER_MS = 800

/** The last answer: to what was typed, the places it found, and whether the search failed. */
type Answer = { for: string; places: FoundPlace[]; failed: boolean }

/**
 * A place search, in a place on the map (DESIGN.md §5.3): a text field that
 * suggests places as it's typed, in the list a name from a saved list has
 * (NamePicker), with its keys. Picking one gives the place to drop the pin
 * on. What's typed is only a search, and is never saved.
 */
export default function PlaceSearch({ onPick, placeholder, id, ...field }: {
    onPick: (place: FoundPlace) => void
    placeholder?: string
} & FieldControlProps) {
    const { t, locale } = useLanguage()
    const hereKey = process.env.NEXT_PUBLIC_HERE_API_KEY
    const listId = useId()
    const [typed, setTyped] = useState('')
    // The name of the place picked, which isn't asked about again.
    const [picked, setPicked] = useState<string | null>(null)
    const [last, setLast] = useState<Answer>({ for: '', places: [], failed: false })
    const [open, setOpen] = useState(false)
    const [under, setUnder] = useState({ for: '', index: -1 })
    const asked = useRef(0)
    const text = typed.trim()
    const asking = searchable(text) && text !== picked

    // Asked a moment after the last key; an answer to an older question
    // than the last is dropped. With no key, there's no one to ask.
    useEffect(() => {
        if (!asking) return
        const ask = ++asked.current
        const timer = setTimeout(() => {
            const answer = (next: Answer) => {
                if (ask !== asked.current) return
                setLast(next)
                setUnder({ for: text, index: -1 })
            }
            if (!hereKey) return void answer({ for: text, places: [], failed: true })
            fetch(placeSearchUrl(text, hereKey))
                .then(res => (res.ok ? res.json() : Promise.reject(new Error(`HERE answered ${res.status}`))))
                .then(data => answer({ for: text, places: foundPlaces(data), failed: false }), () => answer({ for: text, places: [], failed: true }))
        }, ASK_AFTER_MS)
        return () => clearTimeout(timer)
    }, [text, asking, hereKey])

    const answered = asking && last.for === text
    // Until the answer to what's typed now comes, the last one's places that still have it in their names.
    const places = !asking ? [] : answered ? last.places : last.places.filter(p => p.name.toLowerCase().includes(text.toLowerCase()))
    const shown = open && places.length > 0
    // The one under the keys counts only for what was typed when they moved to it.
    const active = shown && under.for === text ? under.index : -1
    const note = !answered ? '' : last.failed ? t('place_search_failed') : last.places.length === 0 ? t('place_search_none') : ''
    const optionId = (i: number) => `${listId}-${i}`

    const pick = (p: FoundPlace) => {
        setTyped(p.name)
        setPicked(p.name)
        setOpen(false)
        onPick(p)
    }
    const keys = (e: KeyboardEvent<HTMLInputElement>) => {
        const next = pickerKey(e, { shown, active, count: places.length })
        if (!next) return
        if ('close' in next) setOpen(false)
        else if ('move' in next) { setOpen(true); if (next.move >= 0) setUnder({ for: text, index: next.move }) }
        else pick(places[next.choose])
    }

    return (
        <div className="ui-place-search">
            <span className="ui-control" data-busy={(asking && !answered) || undefined}>
                <input
                    id={id}
                    {...field}
                    className="ui-input"
                    type="text"
                    role="combobox"
                    aria-autocomplete="list"
                    aria-expanded={shown}
                    aria-controls={listId}
                    aria-activedescendant={active >= 0 ? optionId(active) : undefined}
                    // Its own suggestions open here; the browser's would cover them.
                    autoComplete="off"
                    spellCheck={false}
                    // A place's name keeps its own direction, whichever language the page is in (DESIGN.md §7).
                    dir="auto"
                    value={typed}
                    placeholder={placeholder}
                    onChange={e => { setTyped(e.target.value); setOpen(true) }}
                    onFocus={() => setOpen(true)}
                    onBlur={() => setOpen(false)}
                    onKeyDown={keys}
                />
            </span>
            <ul id={listId} role="listbox" aria-label={t('place_search_list')} className="ui-suggestions" hidden={!shown}>
                {places.map((p, i) => (
                    <li key={p.id} id={optionId(i)} role="option" aria-selected={active === i} className="ui-suggestion"
                        // Kept from taking the focus, so the field doesn't close the list first.
                        onMouseDown={e => e.preventDefault()} onClick={() => pick(p)}>
                        <span className="ui-suggestion-text">
                            <bdi>{p.name}</bdi>
                            {p.address && <bdi className="ui-suggestion-detail">{p.address}</bdi>}
                        </span>
                    </li>
                ))}
            </ul>
            {/* When nothing matches, or the search isn't answering: what to do instead. */}
            <p className="ui-hint ui-place-search-note" role="status">{note}</p>
            {/* How many it suggests, said once they come, as they come without a key pressed. */}
            <span className="ui-visually-hidden" aria-live="polite">{shown ? countOf(t, locale, places.length, 'places') : ''}</span>
        </div>
    )
}

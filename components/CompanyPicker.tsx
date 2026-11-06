'use client'

import { useEffect, useId, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent, type RefObject } from 'react'
import { BuildingsIcon, CaretDownIcon, CheckIcon } from '@phosphor-icons/react/ssr'
import { useLanguage } from '@/context/LanguageContext'
import { Icon, SearchInput, initials } from '@/components/ui'
import { moveOption } from '@/lib/listbox-keys'

/** A company the Super Admin can put in view. */
export type PickerCompany = { id: string; name: string }
/** A row of the picker's list: a company, or All companies (no id). */
export type PickerOption = { id: string | null; name: string }

/**
 * What the list holds (DESIGN.md §5.1): with nothing typed, All companies and
 * then every company; with something typed, the companies whose names have it
 * in them, capitals or not, and All companies no longer.
 */
export function pickerOptions(companies: PickerCompany[], query: string, allLabel: string): PickerOption[] {
    const q = query.trim().toLocaleLowerCase()
    if (!q) return [{ id: null, name: allLabel }, ...companies]
    return companies.filter(c => c.name.toLocaleLowerCase().includes(q))
}

/**
 * Where the up and down arrows take the row they're on, from the search field.
 * Home, End and every other key are left to what's typed.
 */
export function moveActive(active: number, key: string, count: number): number | null {
    return key === 'ArrowDown' || key === 'ArrowUp' ? moveOption(active, key, count) : null
}

/** A company's initials on a tile, or the buildings icon for All companies. */
function CompanyTile({ option, large = false }: { option: PickerOption; large?: boolean }) {
    return (
        <span className={large ? 'ui-company-tile ui-company-tile-32' : 'ui-company-tile'} aria-hidden="true">
            {option.id === null ? <Icon icon={BuildingsIcon} size={16} /> : initials(option.name)}
        </span>
    )
}

/**
 * The picker at the top bar's start (DESIGN.md §5.1): the company in view's
 * tile, "Company in view" over its name, and a caret; on a phone, the tile
 * alone (CSS). Named with the company, so what it says on screen is in its name.
 */
export function CompanyPickerButton({ inView, open, listId, onToggle, onKeyDown, onPointerDown, buttonRef }: {
    inView: PickerOption
    open: boolean
    listId: string
    onToggle: () => void
    onKeyDown: (e: KeyboardEvent<HTMLButtonElement>) => void
    onPointerDown?: (e: ReactPointerEvent<HTMLButtonElement>) => void
    buttonRef?: RefObject<HTMLButtonElement | null>
}) {
    const { t } = useLanguage()
    return (
        <button type="button" ref={buttonRef} className="ui-company-picker-button" aria-haspopup="listbox" aria-expanded={open} aria-controls={open ? listId : undefined}
            aria-label={t('company_switcher_label').replace('{name}', () => inView.name)} onClick={onToggle} onKeyDown={onKeyDown} onPointerDown={onPointerDown}>
            <CompanyTile option={inView} large />
            <span className="ui-company-picker-who"><span className="ui-company-picker-label">{t('company_in_view')}</span><span className="ui-company-picker-name"><bdi>{inView.name}</bdi></span></span>
            <Icon icon={CaretDownIcon} size={16} className="ui-company-picker-caret" />
        </button>
    )
}

/**
 * The picker's panel (DESIGN.md §5.1): a search field that keeps the focus,
 * pointing screen readers at the row the arrows are on, over the list. When no
 * company has what's typed, it says so outside the list, where it's heard.
 */
export function CompanyPickerPanel({ inputId, listId, query, onQuery, options, active, inViewId, onActive, onPick, onKeyDown, inputRef }: {
    inputId: string
    listId: string
    query: string
    onQuery: (query: string) => void
    options: PickerOption[]
    active: number
    inViewId: string | null
    onActive: (i: number) => void
    onPick: (id: string | null) => void
    onKeyDown: (e: KeyboardEvent<HTMLInputElement>) => void
    inputRef?: RefObject<HTMLInputElement | null>
}) {
    const { t } = useLanguage()
    return (
        <div className="ui-company-picker-panel">
            <label htmlFor={inputId} className="ui-company-picker-find">{t('find_company')}</label>
            <SearchInput id={inputId} ref={inputRef} role="combobox" aria-expanded={true} aria-controls={listId} aria-autocomplete="list"
                aria-activedescendant={options[active] ? `${listId}-${active}` : undefined} autoComplete="off" spellCheck={false}
                placeholder={t('find_company_placeholder')} value={query} onChange={e => onQuery(e.target.value)} onKeyDown={onKeyDown} />
            {/* A click on a row leaves the focus in the search field. */}
            <div id={listId} role="listbox" aria-label={t('companies')} className="ui-company-picker-list" onMouseDown={e => e.preventDefault()}>
                {options.map((o, i) => (
                    <div key={o.id ?? 'all'} id={`${listId}-${i}`} role="option" aria-selected={i === active} aria-current={o.id === inViewId || undefined} className="ui-company-picker-option" data-in-view={o.id === inViewId || undefined}
                        onMouseMove={() => onActive(i)} onClick={() => onPick(o.id)}>
                        <CompanyTile option={o} />
                        <span className="ui-company-picker-option-name"><bdi>{o.name}</bdi></span>
                        {o.id === inViewId && <Icon icon={CheckIcon} size={16} className="ui-company-picker-check" />}
                    </div>
                ))}
            </div>
            <p className="ui-company-picker-none" role="status">{options.length === 0 ? t('no_company_matches') : ''}</p>
        </div>
    )
}

/**
 * The Super Admin's company picker (DESIGN.md §5.1). It opens with the focus
 * in the search field, on the company in view, but from a tap without it, as
 * a phone's keyboard would cover the list; the search field is there to tap.
 * Escape, a click outside it, or the focus leaving it closes it, and Escape
 * and a pick give the focus back to the picker.
 */
export default function CompanyPicker({ companies, inViewId, onPick }: {
    companies: PickerCompany[]
    inViewId: string | null
    onPick: (id: string | null) => void
}) {
    const { t } = useLanguage()
    const [open, setOpen] = useState(false)
    const [query, setQuery] = useState('')
    const [active, setActive] = useState(0)
    const box = useRef<HTMLDivElement>(null)
    const buttonRef = useRef<HTMLButtonElement>(null)
    const inputRef = useRef<HTMLInputElement>(null)
    // Whether a tap, rather than a click or a key, opened it.
    const tapped = useRef(false)
    const listId = useId()
    const inputId = useId()

    const all = pickerOptions(companies, '', t('all_companies'))
    const options = pickerOptions(companies, query, t('all_companies'))
    const inView = all.find(o => o.id === inViewId) ?? all[0]

    const openPanel = () => { setQuery(''); setActive(Math.max(0, all.findIndex(o => o.id === inViewId))); setOpen(true) }
    const close = () => { setOpen(false); buttonRef.current?.focus() }
    const pick = (id: string | null) => { onPick(id); close() }

    useEffect(() => { if (open && !tapped.current) inputRef.current?.focus() }, [open])

    // The row the arrows are on stays in sight as the list scrolls.
    useEffect(() => {
        if (open) document.getElementById(`${listId}-${active}`)?.scrollIntoView({ block: 'nearest' })
    }, [open, active, listId])

    // A click or a tap outside it closes it.
    useEffect(() => {
        if (!open) return
        const outside = (e: PointerEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false) }
        document.addEventListener('pointerdown', outside)
        return () => document.removeEventListener('pointerdown', outside)
    }, [open])

    const onButtonKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
        tapped.current = false
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); openPanel() }
    }
    const onInputKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
        const next = moveActive(active, e.key, options.length)
        if (next !== null) { e.preventDefault(); setActive(next); return }
        if (e.key === 'Enter' && options[active]) { e.preventDefault(); pick(options[active].id) }
    }

    return (
        // Escape closes it from anywhere in it, the picker included, where
        // the focus can be after a tap. The focus leaving it closes it, Tab out
        // of the search field among them. With no element to go to (a click
        // on nothing), it stays open until the click outside closes it.
        <div ref={box} className="ui-company-picker"
            onKeyDown={e => { if (e.key === 'Escape' && open) { e.preventDefault(); e.stopPropagation(); close() } }}
            onBlur={e => { if (e.relatedTarget && !box.current?.contains(e.relatedTarget as Node)) setOpen(false) }}>
            <CompanyPickerButton inView={inView} open={open} listId={listId} onToggle={() => open ? setOpen(false) : openPanel()} onKeyDown={onButtonKeyDown}
                onPointerDown={e => { tapped.current = e.pointerType === 'touch' }} buttonRef={buttonRef} />
            {open && (
                <CompanyPickerPanel inputId={inputId} listId={listId} query={query} onQuery={q => { setQuery(q); setActive(0) }} options={options} active={active} inViewId={inViewId}
                    onActive={setActive} onPick={pick} onKeyDown={onInputKeyDown} inputRef={inputRef} />
            )}
        </div>
    )
}

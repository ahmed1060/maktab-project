'use client'

import Link from 'next/link'
import { useEffect, useRef, type KeyboardEvent, type ReactNode, type RefObject } from 'react'

/**
 * Tabs (DESIGN.md §5.5): text with a brand-coloured line under the selected
 * one. On a phone the row scrolls sideways within itself, and opens on the
 * picked tab when it's past the row's edge.
 *
 * `Tabs` switches what's shown on the page. The arrow keys move between tabs
 * the way the page reads, so in Arabic the left arrow goes to the next one.
 * `TabLinks` goes to other pages.
 */
export type TabItem<V extends string> = {
    value: V
    label: ReactNode
    /** The id of the panel this tab shows. */
    controls?: string
}

/**
 * A row of more tabs than fit scrolls (DESIGN.md §5.5). Opened on one past
 * its edge, by a link or a reload, the row scrolls to show it: the row
 * alone, never the page (PR 274).
 */
function usePickedInView(row: RefObject<HTMLElement | null>, picked: string | undefined) {
    useEffect(() => {
        const el = row.current
        const tab = el?.querySelector<HTMLElement>('[aria-selected="true"], [aria-current="page"]')
        if (!el || !tab || el.scrollWidth <= el.clientWidth) return
        const by = scrollToShow(el.getBoundingClientRect(), tab.getBoundingClientRect())
        if (by !== 0) el.scrollBy({ left: by, behavior: 'instant' })
    }, [row, picked])
}

/**
 * How far to scroll a row, rightwards, so a tab shows whole: nothing when it
 * does already. The same sum whichever way the page reads: scrolling by a
 * positive amount shows more of the right side in both.
 */
export function scrollToShow(row: { left: number; right: number }, tab: { left: number; right: number }): number {
    if (tab.left < row.left) return tab.left - row.left
    if (tab.right > row.right) return tab.right - row.right
    return 0
}

export function Tabs<V extends string>({ label, items, value, onChange, idPrefix = 'tab' }: {
    /** What the tabs choose between, for screen readers. */
    label: string
    items: TabItem<V>[]
    value: V
    onChange: (value: V) => void
    idPrefix?: string
}) {
    const list = useRef<HTMLDivElement>(null)
    const move = (to: number) => {
        const next = items[(to + items.length) % items.length]
        onChange(next.value)
        list.current?.querySelector<HTMLButtonElement>(`[data-value="${CSS.escape(next.value)}"]`)?.focus()
    }
    const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
        const at = items.findIndex(i => i.value === value)
        const rtl = getComputedStyle(e.currentTarget).direction === 'rtl'
        const forward = rtl ? 'ArrowLeft' : 'ArrowRight'
        const back = rtl ? 'ArrowRight' : 'ArrowLeft'
        if (e.key === forward) move(at + 1)
        else if (e.key === back) move(at - 1)
        else if (e.key === 'Home') move(0)
        else if (e.key === 'End') move(items.length - 1)
        else return
        e.preventDefault()
    }
    usePickedInView(list, value)
    return (
        <div ref={list} role="tablist" aria-label={label} className="ui-tabs" onKeyDown={onKeyDown}>
            {items.map(item => {
                const selected = item.value === value
                return (
                    <button
                        key={item.value}
                        type="button"
                        role="tab"
                        id={`${idPrefix}-${item.value}`}
                        data-value={item.value}
                        className="ui-tab"
                        aria-selected={selected}
                        aria-controls={item.controls}
                        tabIndex={selected ? 0 : -1}
                        onClick={() => onChange(item.value)}
                    >
                        {item.label}
                    </button>
                )
            })}
        </div>
    )
}

export function TabLinks({ label, items }: { label: string; items: { href: string; label: ReactNode; current: boolean }[] }) {
    const row = useRef<HTMLElement>(null)
    usePickedInView(row, items.find(item => item.current)?.href)
    return (
        <nav ref={row} aria-label={label} className="ui-tablinks">
            {items.map(item => (
                <Link key={item.href} href={item.href} className="ui-tab" aria-current={item.current ? 'page' : undefined}>{item.label}</Link>
            ))}
        </nav>
    )
}

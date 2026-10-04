'use client'
import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type RefObject } from 'react'
import { isoOf, monthOf, moveDay } from '@/lib/calendar-keys'
import { trapTab } from '@/lib/focus-trap'

/**
 * What a calendar pop-up needs to work from the keyboard (WCAG 2.1.1, audit
 * of 4 October 2026): focus goes into it on opening, to the chosen day or
 * else the first one that can be chosen; the arrows move between days (and
 * months); Escape closes it; Tab stays inside while it's open; and focus
 * goes back to whatever opened it. The pop-ups are drawn at the end of the
 * page, so without this, Tab from the opener went past them to the rest of
 * the page.
 */
export function usePickerKeyboard(opts: {
    isOpen: boolean
    close: () => void
    currentMonth: Date
    setCurrentMonth: (d: Date) => void
    isDisabled: (iso: string) => boolean
    rtl: boolean
    /** The pop-up's element, when the picker already keeps a ref to it. */
    popupRef?: RefObject<HTMLDivElement | null>
}) {
    const { isOpen, close, currentMonth, setCurrentMonth, isDisabled, rtl } = opts
    const ownRef = useRef<HTMLDivElement>(null)
    const popupRef = opts.popupRef ?? ownRef
    const returnTo = useRef<HTMLElement | null>(null)
    const [focusIso, setFocusIso] = useState<string | null>(null)
    const [moved, setMoved] = useState(0)

    /** Call when opening, with the day to start on. Shows its month. */
    const opened = useCallback((startIso: string) => {
        returnTo.current = document.activeElement as HTMLElement | null
        setFocusIso(startIso)
        setCurrentMonth(monthOf(startIso))
        setMoved(n => n + 1)
    }, [setCurrentMonth])

    // Focus the day once it is drawn: on opening and after each arrow key, not
    // when the month buttons are used (that would pull focus off them).
    useEffect(() => {
        if (!isOpen || !focusIso) return
        const day = popupRef.current?.querySelector<HTMLElement>(`[data-date="${focusIso}"]`)
        day?.focus()
    }, [isOpen, moved]) // eslint-disable-line react-hooks/exhaustive-deps

    // Back to the opener once closed, however it was closed.
    const wasOpen = useRef(false)
    useEffect(() => {
        if (wasOpen.current && !isOpen) returnTo.current?.focus?.()
        wasOpen.current = isOpen
    }, [isOpen])

    const onPopupKeyDown = (e: KeyboardEvent) => {
        if (e.key === 'Escape') {
            e.stopPropagation()
            close()
            return
        }
        trapTab(e, popupRef.current, document.activeElement)
    }

    const onGridKeyDown = (e: KeyboardEvent) => {
        const from = focusIso ?? isoOf(currentMonth)
        const to = moveDay(from, e.key, rtl)
        if (!to) return
        e.preventDefault()
        setFocusIso(to)
        const month = monthOf(to)
        if (month.getTime() !== new Date(currentMonth.getFullYear(), currentMonth.getMonth(), 1).getTime()) setCurrentMonth(month)
        setMoved(n => n + 1)
    }

    /**
     * Props for a day's button. One day is in the Tab order: the focused one,
     * or the first of the month shown when the focused day is in another.
     * Days that can't be chosen stay focusable (aria-disabled) so the arrows
     * can pass over them; their click must do nothing.
     */
    const shownIsos = (() => {
        const y = currentMonth.getFullYear(), m = currentMonth.getMonth()
        return { first: isoOf(new Date(y, m, 1)), inMonth: (iso: string) => iso.startsWith(`${y}-${String(m + 1).padStart(2, '0')}-`) }
    })()
    const active = focusIso && shownIsos.inMonth(focusIso) ? focusIso : shownIsos.first
    const dayProps = (iso: string, selected: boolean) => ({
        'data-date': iso,
        tabIndex: iso === active ? 0 : -1,
        'aria-disabled': isDisabled(iso) || undefined,
        'aria-pressed': selected,
        onFocus: () => setFocusIso(iso),
    })

    const popupProps = {
        ref: popupRef,
        role: 'dialog' as const,
        'aria-modal': true,
        onKeyDown: onPopupKeyDown,
    }

    return { opened, popupProps, gridProps: { onKeyDown: onGridKeyDown }, dayProps }
}

/** The day to start on: the chosen one if it can be chosen, else today, else the first allowed. */
export function startDay(chosen: string | null, minIso: string | null, maxIso: string | null): string {
    const today = isoOf(new Date())
    const ok = (iso: string) => (!minIso || iso >= minIso) && (!maxIso || iso <= maxIso)
    if (chosen && ok(chosen)) return chosen
    if (ok(today)) return today
    if (minIso && today < minIso) return minIso
    return maxIso ?? today
}

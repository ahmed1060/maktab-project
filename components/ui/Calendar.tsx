'use client'

import { createPortal } from 'react-dom'
import { useEffect, useLayoutEffect, useRef, type ReactNode, type RefObject } from 'react'
import { CaretLeftIcon, CaretRightIcon } from '@phosphor-icons/react/ssr'
import { useLanguage } from '@/context/LanguageContext'
import { useHydrated } from '@/lib/useHydrated'
import { useNow } from '@/lib/useNow'
import { isoOf } from '@/lib/calendar-keys'
import { calendarPlace } from '@/lib/calendar-place'
import { dayLabel, dayNumber, monthCells, monthTitle, weekdays } from '@/lib/calendar-text'
import type { PickerKeys } from '@/lib/usePickerKeyboard'
import { Button } from './Button'
import { Icon } from './Icon'

/**
 * Puts a calendar against its field (lib/calendar-place.ts), as custom
 * properties the CSS uses on a computer only: on a phone it's in the middle
 * of the screen whatever they say.
 */
function placeAgainst(panel: HTMLElement | null, field: HTMLElement | null) {
    if (!panel || !field) return
    const view = document.documentElement
    const spot = calendarPlace(field.getBoundingClientRect(), { width: panel.offsetWidth, height: panel.offsetHeight },
        { width: view.clientWidth, height: view.clientHeight }, getComputedStyle(field).direction === 'rtl')
    panel.style.setProperty('--calendar-start', `${spot.start}px`)
    if (spot.top !== undefined) {
        panel.style.setProperty('--calendar-top', `${spot.top}px`)
        panel.style.removeProperty('--calendar-bottom')
    } else {
        panel.style.setProperty('--calendar-bottom', `${spot.bottom}px`)
        panel.style.removeProperty('--calendar-top')
    }
}

/** How a day looks: picked (a date, or a range's first or last day), or between a range's ends. */
export type DayLook = { picked?: boolean; inRange?: boolean }

/**
 * A date field's calendar (DESIGN.md §5.3), drawn on the page's body so a
 * dialog's edge can't cut it off. On a computer it's fixed under its field,
 * from its start edge, or above it when there's no room below, and follows
 * the field as the page scrolls; a click elsewhere closes it and goes on to
 * what was clicked. On a phone the CSS puts it in the middle of the screen
 * over the dimmed page, and a tap on that closes it without reaching what's
 * under it.
 *
 * The keyboard is usePickerKeyboard's (lib/usePickerKeyboard.ts): focus goes
 * in on opening, Tab stays inside, Escape closes it, and the focus goes back
 * to the field.
 */
export function CalendarPopup({ open, onClose, opener, keys, label, children }: {
    open: boolean
    onClose: () => void
    /** The field's button: placed against, and a press on it isn't a click elsewhere. */
    opener: RefObject<HTMLElement | null>
    keys: PickerKeys
    /** What it's for, as the field's label says. */
    label: string
    children: ReactNode
}) {
    const mounted = useHydrated()
    const layer = useRef<HTMLDivElement>(null)
    const popup = keys.popupProps.ref
    const close = useRef(onClose)
    useEffect(() => { close.current = onClose })

    // Before it's painted, and after each redraw: another month can be a row taller.
    useLayoutEffect(() => { if (open && mounted) placeAgainst(popup.current, opener.current) })

    useEffect(() => {
        if (!open) return
        let frame = 0
        const follow = () => {
            cancelAnimationFrame(frame)
            frame = requestAnimationFrame(() => placeAgainst(popup.current, opener.current))
        }
        const outside = (e: PointerEvent) => {
            const target = e.target as Node
            // The dimmed page on a phone closes it on its own click, below.
            if (popup.current?.contains(target) || opener.current?.contains(target) || target === layer.current) return
            close.current()
        }
        window.addEventListener('scroll', follow, true)
        window.addEventListener('resize', follow)
        document.addEventListener('pointerdown', outside)
        return () => {
            cancelAnimationFrame(frame)
            window.removeEventListener('scroll', follow, true)
            window.removeEventListener('resize', follow)
            document.removeEventListener('pointerdown', outside)
        }
    }, [open, opener, popup])

    if (!open || !mounted) return null
    return createPortal(
        <div ref={layer} className="ui-calendar-layer" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
            {/* A click inside goes no further up the page than the calendar. */}
            <div {...keys.popupProps} aria-label={label} className="ui-calendar" onClick={e => e.stopPropagation()}>
                {children}
            </div>
        </div>,
        document.body,
    )
}

/**
 * A month of the calendar: the month and year between the month before (on
 * the start side, as the pager's previous page is) and the month after; the
 * days of the week from Sunday; and a button for each day, read out as the
 * whole date, in the page's digits.
 */
export function CalendarMonth({ month, onMonth, today, look, onPick, keys }: {
    /** The first of the month shown. */
    month: Date
    onMonth: (month: Date) => void
    /** Today, "YYYY-MM-DD"; the browser's own day when not given. */
    today?: string
    look: (iso: string) => DayLook
    onPick: (iso: string) => void
    keys: PickerKeys
}) {
    const { t, locale } = useLanguage()
    const now = useNow()
    const todayIso = today ?? isoOf(new Date(now))
    const step = (by: number) => onMonth(new Date(month.getFullYear(), month.getMonth() + by, 1))

    return (
        <>
            <div className="ui-calendar-head">
                <Button variant="quiet" size="sm" className="ui-calendar-step" aria-label={t('calendar_prev_month')} onClick={() => step(-1)}>
                    <Icon icon={CaretLeftIcon} size={16} directional />
                </Button>
                <span className="ui-calendar-title" aria-live="polite">{monthTitle(month, locale)}</span>
                <Button variant="quiet" size="sm" className="ui-calendar-step" aria-label={t('calendar_next_month')} onClick={() => step(1)}>
                    <Icon icon={CaretRightIcon} size={16} directional />
                </Button>
            </div>
            <div className="ui-calendar-weekdays">
                {weekdays(locale).map(day => (
                    <span key={day.full}><span aria-hidden="true">{day.short}</span><span className="ui-visually-hidden">{day.full}</span></span>
                ))}
            </div>
            <div {...keys.gridProps} className="ui-calendar-days">
                {monthCells(month).map((iso, i) => {
                    if (!iso) return <span key={`blank-${i}`} aria-hidden="true" />
                    const day = look(iso)
                    const isToday = iso === todayIso
                    return (
                        <button key={iso} type="button" {...keys.dayProps(iso, !!day.picked)} className="ui-calendar-day"
                            data-picked={day.picked || undefined} data-in-range={(!day.picked && day.inRange) || undefined}
                            data-today={isToday || undefined} aria-current={isToday ? 'date' : undefined}
                            aria-label={dayLabel(iso, locale)} onClick={() => onPick(iso)}>
                            {dayNumber(iso, locale)}
                        </button>
                    )
                })}
            </div>
        </>
    )
}

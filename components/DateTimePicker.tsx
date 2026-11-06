'use client'
import { useState, useRef, useId } from 'react'
import { CalendarBlankIcon } from '@phosphor-icons/react/ssr'
import { useLanguage } from '@/context/LanguageContext'
import { usePickerKeyboard, startDay } from '@/lib/usePickerKeyboard'
import { useHydrated } from '@/lib/useHydrated'
import { dateTimeText } from '@/lib/calendar-text'
import { atTime, dayOf, endsBefore, isBefore, onDay, timeOf } from '@/lib/date-time'
import { Button } from '@/components/ui/Button'
import { CalendarMonth, CalendarPopup } from '@/components/ui/Calendar'
import { Field, TextInput } from '@/components/ui/Field'
import { Icon } from '@/components/ui/Icon'

interface DateTimePickerProps {
    /** An ISO time, or empty. */
    value: string
    onChange: (value: string) => void
    label: string
    /** The earliest time allowed, an ISO time: a deadline's is 3 hours from now (lib/deadline.ts). */
    min?: string
    /** In a table: the label is read out but not shown (DESIGN.md §5.3). */
    hideLabel?: boolean
    /** What's wrong with it, under it as a field's error is. */
    error?: string
}

/**
 * A date and a time, such as a deadline (DESIGN.md §5.3): a field whose
 * button shows them in the page's language and opens the date fields'
 * calendar, with the time under its days in the browser's own time field.
 * Picking a day keeps the time and leaves the calendar open for it; Done
 * closes it.
 */
export default function DateTimePicker({ value, onChange, label, min, hideLabel = false, error }: DateTimePickerProps) {
    const { t, locale } = useLanguage()
    const [isOpen, setIsOpen] = useState(false)
    // The month shown: the day to start on's, once it opens.
    const [currentMonth, setCurrentMonth] = useState(() => new Date())
    const opener = useRef<HTMLButtonElement>(null)
    const popupRef = useRef<HTMLDivElement>(null)
    const openerId = useId()
    // A day can't be picked once all of it is before the earliest time allowed.
    const isDayDisabled = (iso: string) => !!min && endsBefore(iso, min)
    const keys = usePickerKeyboard({ isOpen, close: () => setIsOpen(false), currentMonth, setCurrentMonth, isDisabled: isDayDisabled, rtl: locale === 'ar', popupRef })
    // The day it holds, on the browser's clock.
    const picked = dayOf(value)
    // The day to start on: the one it holds, or today, or the earliest allowed.
    const firstDay = () => startDay(picked, min ? dayOf(min) : null, null)
    const toggleOpen = () => {
        if (isOpen) return setIsOpen(false)
        keys.opened(firstDay())
        setIsOpen(true)
    }

    const pick = (iso: string) => {
        if (isDayDisabled(iso)) return
        onChange(onDay(value, iso))
    }

    const tooEarly = !!min && isBefore(value, min)
    const shown = dateTimeText(value, locale)
    // Said once in the browser, as SafeDate's dates are: the server's Intl
    // can write it otherwise, and the page would be drawn again.
    const hydrated = useHydrated()
    const described = error ? `${openerId}-error` : undefined

    return (
        <div className="ui-field">
            <label htmlFor={openerId} className={hideLabel ? 'ui-visually-hidden' : 'ui-label'}>{label}</label>
            <span className="ui-control has-start-icon">
                <Icon icon={CalendarBlankIcon} size={16} />
                <button type="button" id={openerId} aria-haspopup="dialog" aria-expanded={isOpen} ref={opener} onClick={toggleOpen}
                    className="ui-input ui-date-trigger" data-empty={shown === null ? true : undefined} data-invalid={error ? true : undefined}
                    aria-describedby={described}>
                    {shown === null ? t('select_deadline') : hydrated ? shown : null}
                </button>
            </span>
            {error && <span id={`${openerId}-error`} className="ui-error">{error}</span>}
            <CalendarPopup open={isOpen} onClose={() => setIsOpen(false)} opener={opener} keys={keys} label={label}>
                <CalendarMonth month={currentMonth} onMonth={setCurrentMonth} keys={keys} onPick={pick} look={iso => ({ picked: iso === picked })} />
                <div className="ui-calendar-foot ui-calendar-time">
                    <Field label={t('time_label')} error={tooEarly ? t('deadline_too_soon') : undefined}>{p => (
                        <TextInput {...p} type="time" name="time" step={300} autoComplete="off" value={timeOf(value)}
                            onChange={e => onChange(atTime(value, e.target.value, firstDay()))} />
                    )}</Field>
                    {/* Off while the time is too early, though the focus can still reach it,
                        so Tab moves through the time's hour and minute as it does elsewhere. */}
                    <Button size="sm" className="ui-calendar-done" aria-disabled={tooEarly || undefined} onClick={() => { if (!tooEarly) setIsOpen(false) }}>
                        {t('done')}
                    </Button>
                </div>
            </CalendarPopup>
        </div>
    )
}

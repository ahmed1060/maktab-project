'use client'
import { useState, useRef, useId } from 'react'
import { CalendarBlankIcon } from '@phosphor-icons/react/ssr'
import { useLanguage } from '@/context/LanguageContext'
import { usePickerKeyboard, startDay } from '@/lib/usePickerKeyboard'
import { useHydrated } from '@/lib/useHydrated'
import { dayIso, dayText } from '@/lib/calendar-text'
import { Button } from '@/components/ui/Button'
import { CalendarMonth, CalendarPopup } from '@/components/ui/Calendar'
import { Icon } from '@/components/ui/Icon'

interface DatePickerSingleProps {
    value: string
    onChange: (date: string) => void
    label?: string
    minDate?: string
    maxDate?: string
    /** Can't be changed, as while the form it's in is saving. */
    disabled?: boolean
    /** What's wrong with it, under it as a field's error is (DESIGN.md §5.3). */
    error?: string
    /** What to know about it, under it as a field's hint is; an error takes its place. */
    hint?: string
    /**
     * Its button's name, for a form that puts the focus on its first field
     * wrong by name, as a person's profile does. A button that opens the
     * calendar, it sends nothing with the form.
     */
    name?: string
}

/**
 * A date (DESIGN.md §5.3): a field whose button shows the day in the page's
 * language and opens the calendar. Picking a day closes it; Clear empties
 * the field.
 */
export default function DatePickerSingle({ value, onChange, label, minDate, maxDate, disabled = false, error, hint, name }: DatePickerSingleProps) {
    const { t, locale } = useLanguage()
    const [isOpen, setIsOpen] = useState(false)
    // The month shown: the day to start on's, once it opens.
    const [currentMonth, setCurrentMonth] = useState(() => new Date())
    const opener = useRef<HTMLButtonElement>(null)
    const popupRef = useRef<HTMLDivElement>(null)
    const openerId = useId()
    const isDayDisabled = (iso: string) => !!((minDate && iso < minDate) || (maxDate && iso > maxDate))
    const keys = usePickerKeyboard({ isOpen, close: () => setIsOpen(false), currentMonth, setCurrentMonth, isDisabled: isDayDisabled, rtl: locale === 'ar', popupRef })
    const toggleOpen = () => {
        if (isOpen) return setIsOpen(false)
        if (disabled) return
        keys.opened(startDay(dayIso(value), minDate ?? null, maxDate ?? null))
        setIsOpen(true)
    }

    const pick = (iso: string) => {
        if (isDayDisabled(iso)) return
        onChange(iso)
        setIsOpen(false)
    }

    const clear = () => {
        onChange('')
        setIsOpen(false)
    }

    const described = error ? `${openerId}-error` : hint ? `${openerId}-hint` : undefined
    // The day it holds, though it be given as a time in full.
    const picked = dayIso(value)
    // Said once in the browser, as SafeDate's dates are: the server's Intl can
    // write it otherwise, and the page would be drawn again.
    const hydrated = useHydrated()

    return (
        <div className="ui-field">
            {label && <label htmlFor={openerId} className="ui-label">{label}</label>}
            <span className="ui-control has-start-icon">
                <Icon icon={CalendarBlankIcon} size={16} />
                <button type="button" id={openerId} aria-haspopup="dialog" aria-expanded={isOpen} name={name} ref={opener} onClick={toggleOpen}
                    className="ui-input ui-date-trigger" data-empty={!value || undefined} data-invalid={error ? true : undefined} disabled={disabled}
                    aria-describedby={described}>
                    {value ? (hydrated ? dayText(value, locale) : null) : t('select_date')}
                </button>
            </span>
            {error ? <span id={`${openerId}-error`} className="ui-error">{error}</span> : hint && <span id={`${openerId}-hint`} className="ui-hint">{hint}</span>}
            <CalendarPopup open={isOpen} onClose={() => setIsOpen(false)} opener={opener} keys={keys} label={label || t('select_date')}>
                <CalendarMonth month={currentMonth} onMonth={setCurrentMonth} keys={keys} onPick={pick} look={iso => ({ picked: iso === picked })} />
                {value && (
                    <div className="ui-calendar-foot">
                        <Button variant="quiet" size="sm" onClick={clear}>{t('date_clear')}</Button>
                    </div>
                )}
            </CalendarPopup>
        </div>
    )
}

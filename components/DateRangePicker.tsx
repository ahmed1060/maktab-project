'use client'
import { useState, useRef, useId } from 'react'
import { CalendarBlankIcon } from '@phosphor-icons/react/ssr'
import { useLanguage } from '@/context/LanguageContext'
import { usePickerKeyboard, startDay } from '@/lib/usePickerKeyboard'
import { useHydrated } from '@/lib/useHydrated'
import { dayIso, rangeText } from '@/lib/calendar-text'
import { Button } from '@/components/ui/Button'
import { CalendarMonth, CalendarPopup } from '@/components/ui/Calendar'
import { Icon } from '@/components/ui/Icon'

interface DateRangePickerProps {
    dateFrom: string
    dateTo: string
    onChange: (from: string, to: string) => void
    label?: string
    minDate?: string
    maxDate?: string
    /**
     * In a filter bar: the label is kept for screen readers but not shown,
     * since what the picker shows names it ("Select date range", or the range
     * picked), as a select does (DESIGN.md §5.3).
     */
    hideLabel?: boolean
    /** Can't be changed, as while the form it's in is saving. */
    disabled?: boolean
    /** What's wrong with it, under it as a field's error is (DESIGN.md §5.3). */
    error?: string
    /** What to know about it, under it as a field's hint is; an error takes its place. */
    hint?: string
}

/**
 * A range of dates (DESIGN.md §5.3): a field whose button shows the range in
 * the page's language ("6–10 Nov 2026") and opens the calendar. The first day
 * picked starts the range, the next one ends it and closes the calendar, and
 * each time it opens a new range starts. Done keeps a range of one day.
 */
export default function DateRangePicker({ dateFrom, dateTo, onChange, label, minDate, maxDate, hideLabel = false, disabled = false, error, hint }: DateRangePickerProps) {
    const { t, locale } = useLanguage()
    const [isOpen, setIsOpen] = useState(false)
    // The month shown: the day to start on's, once it opens.
    const [currentMonth, setCurrentMonth] = useState(() => new Date())
    // The range's first day while its last is being picked. Kept here, since
    // a page that holds the range in its address hands it back a moment later.
    const [first, setFirst] = useState<string | null>(null)
    const opener = useRef<HTMLButtonElement>(null)
    const popupRef = useRef<HTMLDivElement>(null)
    const openerId = useId()
    const isDayDisabled = (iso: string) => !!((minDate && iso < minDate) || (maxDate && iso > maxDate))
    const keys = usePickerKeyboard({ isOpen, close: () => setIsOpen(false), currentMonth, setCurrentMonth, isDisabled: isDayDisabled, rtl: locale === 'ar', popupRef })
    const toggleOpen = () => {
        if (isOpen) return setIsOpen(false)
        if (disabled) return
        setFirst(null)
        keys.opened(startDay(dayIso(dateFrom), minDate ?? null, maxDate ?? null))
        setIsOpen(true)
    }

    const pick = (iso: string) => {
        if (isDayDisabled(iso)) return
        if (first === null) {
            setFirst(iso)
            onChange(iso, iso)
            return
        }
        onChange(iso < first ? iso : first, iso < first ? first : iso)
        setFirst(null)
        setIsOpen(false)
    }

    const clear = () => {
        onChange('', '')
        setFirst(null)
        setIsOpen(false)
    }

    // The range's ends as days, in order, as an address can hold them as times
    // in full, or the wrong way round.
    const [from, to] = [dayIso(dateFrom) ?? '', dayIso(dateTo) ?? '']
    const [start, end] = from && to && from > to ? [to, from] : [from, to]
    const name = label || t('filter_by_date_range')
    const shown = rangeText(dateFrom, dateTo, locale, { from: t('date_range_from'), until: t('date_range_until') })
    // Said once in the browser, as SafeDate's dates are: the server's Intl can
    // join a range otherwise («٢–٥ نوفمبر ٢٠٢٦», «٢–٥ نوفمبر، ٢٠٢٦»), and the
    // page would be drawn again.
    const hydrated = useHydrated()
    const described = error ? `${openerId}-error` : hint ? `${openerId}-hint` : undefined

    return (
        <div className="ui-field">
            <label htmlFor={openerId} className={hideLabel ? 'ui-visually-hidden' : 'ui-label'}>{name}</label>
            <span className="ui-control has-start-icon">
                <Icon icon={CalendarBlankIcon} size={16} />
                <button type="button" id={openerId} aria-haspopup="dialog" aria-expanded={isOpen} ref={opener} onClick={toggleOpen}
                    className="ui-input ui-date-trigger" data-empty={!dateFrom && !dateTo ? true : undefined} data-invalid={error ? true : undefined} disabled={disabled}
                    aria-describedby={described}>
                    {shown === null ? t('select_date_range') : hydrated ? shown : null}
                </button>
            </span>
            {error ? <span id={`${openerId}-error`} className="ui-error">{error}</span> : hint && <span id={`${openerId}-hint`} className="ui-hint">{hint}</span>}
            <CalendarPopup open={isOpen} onClose={() => setIsOpen(false)} opener={opener} keys={keys} label={name}>
                <CalendarMonth month={currentMonth} onMonth={setCurrentMonth} keys={keys} onPick={pick}
                    look={iso => ({ picked: iso === start || iso === end, inRange: !!start && !!end && iso > start && iso < end })} />
                <div className="ui-calendar-foot">
                    <span className="ui-calendar-next" aria-live="polite">{first === null ? t('select_start_date') : t('select_end_date')}</span>
                    {(dateFrom || dateTo) && <Button variant="quiet" size="sm" onClick={clear}>{t('date_clear')}</Button>}
                    <Button size="sm" className="ui-calendar-done" onClick={() => setIsOpen(false)}>{t('done')}</Button>
                </div>
            </CalendarPopup>
        </div>
    )
}

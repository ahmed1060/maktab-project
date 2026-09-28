import { useState, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { useLanguage } from '@/context/LanguageContext'
import { useHydrated } from '@/lib/useHydrated'

interface DateRangePickerProps {
    dateFrom: string
    dateTo: string
    onChange: (from: string, to: string) => void
    label?: string
    minDate?: string
    maxDate?: string
}

export default function DateRangePicker({ dateFrom, dateTo, onChange, label, minDate, maxDate }: DateRangePickerProps) {
    const { t, locale } = useLanguage()
    const [isOpen, setIsOpen] = useState(false)
    const mounted = useHydrated()
    const [isMobile, setIsMobile] = useState(false)
    const [currentMonth, setCurrentMonth] = useState(new Date())
    const [selectingFrom, setSelectingFrom] = useState(true)
    const containerRef = useRef<HTMLDivElement>(null)
    const portalRef = useRef<HTMLDivElement>(null)

    useEffect(() => {
        const checkMobile = () => {
            setIsMobile(window.innerWidth <= 768)
        }
        checkMobile()
        window.addEventListener('resize', checkMobile)
        return () => window.removeEventListener('resize', checkMobile)
    }, [])

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            const target = event.target as Node;
            const isClickInsideTrigger = containerRef.current?.contains(target);
            const isClickInsidePortal = portalRef.current?.contains(target);

            if (!isClickInsideTrigger && !isClickInsidePortal) {
                if (!isMobile) setIsOpen(false)
            }
        }
        document.addEventListener('mousedown', handleClickOutside)
        return () => document.removeEventListener('mousedown', handleClickOutside)
    }, [isMobile])

    const formatDate = (dateStr: string) => {
        if (!dateStr) return ''
        const date = new Date(dateStr)
        return date.toLocaleDateString(locale === 'ar' ? 'ar-EG' : 'en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    }

    const getDaysInMonth = (date: Date) => {
        const year = date.getFullYear()
        const month = date.getMonth()
        const firstDay = new Date(year, month, 1)
        const lastDay = new Date(year, month + 1, 0)
        const daysInMonth = lastDay.getDate()
        const startingDayOfWeek = firstDay.getDay()

        const days = []
        // Add empty cells for days before month starts
        for (let i = 0; i < startingDayOfWeek; i++) {
            days.push(null)
        }
        // Add actual days
        for (let day = 1; day <= daysInMonth; day++) {
            days.push(new Date(year, month, day))
        }
        return days
    }

    const formatToLocalISO = (date: Date) => {
        const year = date.getFullYear()
        const month = String(date.getMonth() + 1).padStart(2, '0')
        const day = String(date.getDate()).padStart(2, '0')
        return `${year}-${month}-${day}`
    }

    const handleDateClick = (date: Date) => {
        const dateStr = formatToLocalISO(date)

        if (selectingFrom) {
            onChange(dateStr, dateStr)
            setSelectingFrom(false)
        } else {
            if (dateStr < dateFrom) {
                onChange(dateStr, dateFrom)
            } else {
                onChange(dateFrom, dateStr)
            }
            setIsOpen(false)
            setSelectingFrom(true)
        }
    }

    const handleReset = () => {
        onChange('', '')
        setSelectingFrom(true)
        setIsOpen(false)
    }

    const isInRange = (date: Date) => {
        if (!dateFrom || !dateTo) return false
        const d = formatToLocalISO(date)
        return d >= dateFrom && d <= dateTo
    }

    const isStartDate = (date: Date) => {
        return formatToLocalISO(date) === dateFrom
    }

    const isEndDate = (date: Date) => {
        return formatToLocalISO(date) === dateTo
    }

    const days = getDaysInMonth(currentMonth)
    const monthYear = currentMonth.toLocaleDateString(locale === 'ar' ? 'ar-EG' : 'en-US', { month: 'short', year: 'numeric' })

    const weekdaysAr = ['أح', 'اث', 'ثل', 'أر', 'خم', 'جم', 'سب']
    const weekdaysEn = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']
    const weekdays = locale === 'ar' ? weekdaysAr : weekdaysEn

    const pickerContent = (
        <div
            ref={portalRef}
            onClick={(e) => e.stopPropagation()}
            style={{
                position: 'relative',
                top: 'auto',
                [locale === 'ar' ? 'right' : 'left']: 'auto',
                transform: 'none',
                marginTop: 0,
                background: 'var(--surface)',
                border: '1px solid var(--border)',
                borderRadius: '0.75rem',
                boxShadow: '0 10px 25px var(--shadow-weak)',
                padding: '1rem',
                zIndex: 10001,
                width: isMobile ? 'min(calc(100vw - 3rem), 400px)' : '350px',
                maxHeight: '90vh',
                overflowY: 'auto',
                animation: 'fadeIn 0.2s ease-out',
                direction: locale === 'ar' ? 'rtl' : 'ltr'
            }}>
            {/* Month Navigation */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', flexDirection: 'row' }}>
                <button
                    onClick={(e) => { e.stopPropagation(); setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() - (locale === 'ar' ? -1 : 1))); }}
                    style={{
                        background: 'none',
                        border: 'none',
                        fontSize: '1.25rem',
                        cursor: 'pointer',
                        padding: '0.25rem 0.5rem',
                        color: 'var(--text-soft)'
                    }}
                >
                    {locale === 'ar' ? '›' : '‹'}
                </button>
                <div style={{ fontWeight: '600', fontSize: '0.95rem', color: 'var(--text-soft)' }}>
                    {monthYear}
                </div>
                <button
                    onClick={(e) => { e.stopPropagation(); setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() + (locale === 'ar' ? -1 : 1))); }}
                    style={{
                        background: 'none',
                        border: 'none',
                        fontSize: '1.25rem',
                        cursor: 'pointer',
                        padding: '0.25rem 0.5rem',
                        color: 'var(--text-soft)'
                    }}
                >
                    {locale === 'ar' ? '‹' : '›'}
                </button>
            </div>

            {/* Weekday Headers */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '0.25rem', marginBottom: '0.5rem' }}>
                {weekdays.map(day => (
                    <div key={day} style={{ textAlign: 'center', fontSize: '0.75rem', color: 'var(--text-faint)', fontWeight: '600', padding: '0.25rem' }}>
                        {day}
                    </div>
                ))}
            </div>

            {/* Calendar Days */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '0.25rem' }}>
                {days.map((date, index) => {
                    if (!date) {
                        return <div key={`empty-${index}`} />
                    }

                    const inRange = isInRange(date)
                    const isStart = isStartDate(date)
                    const isEnd = isEndDate(date)
                    const isToday = date.toDateString() === new Date().toDateString()
                    const dateStr = formatToLocalISO(date)
                    const isDisabled = (minDate && dateStr < minDate) || (maxDate && dateStr > maxDate)

                    return (
                        <button
                            key={index}
                            disabled={!!isDisabled}
                            onClick={(e) => { e.stopPropagation(); handleDateClick(date); }}
                            style={{
                                padding: '0.5rem',
                                border: 'none',
                                borderRadius: '50%',
                                background: isStart || isEnd ? 'var(--info-fill)' : inRange ? 'var(--info-bg-indigo)' : 'transparent',
                                color: isStart || isEnd ? 'white' : inRange ? 'var(--info-fg-indigo)' : isToday ? 'var(--warn-solid)' : isDisabled ? 'var(--border)' : 'var(--text-main)',
                                fontSize: '0.875rem',
                                cursor: isDisabled ? 'not-allowed' : 'pointer',
                                fontWeight: isStart || isEnd || isToday ? '600' : '400',
                                transition: 'all 0.2s',
                                outline: isToday && !isStart && !isEnd ? '2px solid var(--warn-solid)' : 'none',
                                opacity: isDisabled ? 0.5 : 1
                            }}
                        >
                            {date.getDate()}
                        </button>
                    )
                })}
            </div>

            {/* Instructions & Reset */}
            <div style={{
                marginTop: '1.25rem',
                paddingTop: '0.75rem',
                borderTop: '1px solid var(--surface-sunk)',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                flexDirection: 'row'
            }}>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-soft)' }}>
                    {selectingFrom ? t('select_start_date' as any) : t('select_end_date' as any)}
                </div>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                    {(dateFrom || dateTo) && (
                        <button
                            onClick={(e) => { e.stopPropagation(); handleReset(); }}
                            style={{
                                background: 'var(--danger-bg-subtle)',
                                color: 'var(--danger-solid)',
                                border: 'none',
                                padding: '0.25rem 0.75rem',
                                borderRadius: '0.375rem',
                                fontSize: '0.75rem',
                                fontWeight: '600',
                                cursor: 'pointer',
                                transition: 'all 0.25s'
                            }}
                        >
                            {t('reset' as any)}
                        </button>
                    )}
                    <button
                        onClick={(e) => { e.stopPropagation(); setIsOpen(false); }}
                        style={{
                            background: 'var(--info-fill)',
                            color: 'var(--text-on-accent)',
                            border: 'none',
                            padding: '0.25rem 0.75rem',
                            borderRadius: '0.375rem',
                            fontSize: '0.75rem',
                            fontWeight: '600',
                            cursor: 'pointer',
                            transition: 'all 0.25s'
                        }}
                    >
                        {locale === 'ar' ? 'تم' : 'Done'}
                    </button>
                </div>
            </div>
        </div>
    )

    return (
        <div ref={containerRef} style={{ position: 'relative', direction: locale === 'ar' ? 'rtl' : 'ltr', textAlign: locale === 'ar' ? 'right' : 'left' }}>
            <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: '700', fontSize: '0.875rem' }}>
                {label || t('filter_by_date_range' as any)}
            </label>
            <div
                onClick={() => setIsOpen(!isOpen)}
                style={{
                    padding: '0 1rem',
                    borderRadius: '1.25rem',
                    border: '1px solid var(--border)',
                    fontSize: '0.875rem',
                    cursor: 'pointer',
                    background: 'var(--surface)',
                    minWidth: '220px',
                    height: '48px',
                    minHeight: '48px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    flexDirection: 'row'
                }}
            >
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexDirection: 'row' }}>
                    <span style={{ color: 'var(--text-faint)' }}>📅</span>
                    <span style={{ color: dateFrom || dateTo ? 'var(--text-main)' : 'var(--text-faint)' }}>
                        {dateFrom && dateTo
                            ? (dateFrom === dateTo
                                ? formatDate(dateFrom)
                                : (locale === 'ar' ? `${formatDate(dateFrom)} ← ${formatDate(dateTo)}` : `${formatDate(dateFrom)} → ${formatDate(dateTo)}`))
                            : dateFrom
                                ? `${formatDate(dateFrom)} → ...`
                                : t('select_date_range' as any)}
                    </span>
                </div>
                <span style={{ color: 'var(--text-faint)', fontSize: '0.7rem' }}>{isOpen ? '▲' : '▼'}</span>
            </div>

            {isOpen && mounted && createPortal(
                <div
                    onClick={() => setIsOpen(false)}
                    style={{
                        position: 'fixed',
                        inset: 0,
                        background: 'var(--scrim)',
                        zIndex: 10000,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center'
                    }}>
                    {pickerContent}
                </div>,
                document.body
            )}
        </div>
    )
}

import { useState, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { useLanguage } from '@/context/LanguageContext'

interface DateRangePickerProps {
    dateFrom: string
    dateTo: string
    onChange: (from: string, to: string) => void
}

export default function DateRangePicker({ dateFrom, dateTo, onChange }: DateRangePickerProps) {
    const { t, locale } = useLanguage()
    const [isOpen, setIsOpen] = useState(false)
    const [mounted, setMounted] = useState(false)
    const [isMobile, setIsMobile] = useState(false)
    const [currentMonth, setCurrentMonth] = useState(new Date())
    const [selectingFrom, setSelectingFrom] = useState(true)
    const containerRef = useRef<HTMLDivElement>(null)

    useEffect(() => {
        setMounted(true)
        const checkMobile = () => {
            setIsMobile(window.innerWidth <= 768)
        }
        checkMobile()
        window.addEventListener('resize', checkMobile)
        return () => window.removeEventListener('resize', checkMobile)
    }, [])

    // Close dropdown when clicking outside
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
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
            onClick={(e) => isMobile && e.stopPropagation()}
            style={{
                position: isMobile ? 'relative' : 'absolute',
                top: isMobile ? 'auto' : '100%',
                [locale === 'ar' ? 'right' : 'left']: isMobile ? 'auto' : 0,
                transform: 'none',
                marginTop: isMobile ? 0 : '0.5rem',
                background: 'white',
                border: '1px solid #e2e8f0',
                borderRadius: '0.75rem',
                boxShadow: '0 10px 25px rgba(0, 0, 0, 0.1)',
                padding: '1rem',
                zIndex: isMobile ? 10001 : 1000,
                width: isMobile ? 'min(calc(100vw - 3rem), 400px)' : '320px',
                maxHeight: isMobile ? '90vh' : 'auto',
                overflowY: isMobile ? 'auto' : 'visible',
                animation: isMobile ? 'fadeIn 0.2s ease-out' : 'slideUp 0.2s ease-out',
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
                        color: '#64748b'
                    }}
                >
                    {locale === 'ar' ? '›' : '‹'}
                </button>
                <div style={{ fontWeight: '600', fontSize: '0.95rem', color: '#64748b' }}>
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
                        color: '#64748b'
                    }}
                >
                    {locale === 'ar' ? '‹' : '›'}
                </button>
            </div>

            {/* Weekday Headers */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '0.25rem', marginBottom: '0.5rem' }}>
                {weekdays.map(day => (
                    <div key={day} style={{ textAlign: 'center', fontSize: '0.75rem', color: '#94a3b8', fontWeight: '600', padding: '0.25rem' }}>
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

                    return (
                        <button
                            key={index}
                            onClick={(e) => { e.stopPropagation(); handleDateClick(date); }}
                            style={{
                                padding: '0.5rem',
                                border: 'none',
                                borderRadius: '50%',
                                background: isStart || isEnd ? '#3b82f6' : inRange ? '#dbeafe' : 'transparent',
                                color: isStart || isEnd ? 'white' : inRange ? '#1e40af' : isToday ? '#f59e0b' : '#1e293b',
                                fontSize: '0.875rem',
                                cursor: 'pointer',
                                fontWeight: isStart || isEnd || isToday ? '600' : '400',
                                transition: 'all 0.2s',
                                outline: isToday && !isStart && !isEnd ? '2px solid #f59e0b' : 'none'
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
                borderTop: '1px solid #f1f5f9',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                flexDirection: 'row'
            }}>
                <div style={{ fontSize: '0.75rem', color: '#64748b' }}>
                    {selectingFrom ? t('select_start_date' as any) : t('select_end_date' as any)}
                </div>
                {(dateFrom || dateTo) && (
                    <button
                        onClick={(e) => { e.stopPropagation(); handleReset(); }}
                        style={{
                            background: '#fef2f2',
                            color: '#ef4444',
                            border: 'none',
                            padding: '0.25rem 0.75rem',
                            borderRadius: '0.375rem',
                            fontSize: '0.75rem',
                            fontWeight: '600',
                            cursor: 'pointer',
                            transition: 'all 0.2s'
                        }}
                    >
                        {t('reset' as any)}
                    </button>
                )}
            </div>
        </div>
    )

    return (
        <div ref={containerRef} style={{ position: 'relative', direction: locale === 'ar' ? 'rtl' : 'ltr', textAlign: locale === 'ar' ? 'right' : 'left' }}>
            <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: '700', fontSize: '0.875rem' }}>
                {t('filter_by_date_range' as any)}
            </label>
            <div
                onClick={() => setIsOpen(!isOpen)}
                style={{
                    padding: '0 1rem',
                    borderRadius: '1.25rem',
                    border: '1px solid #e2e8f0',
                    fontSize: '0.875rem',
                    cursor: 'pointer',
                    background: 'white',
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
                    <span style={{ color: '#94a3b8' }}>📅</span>
                    <span style={{ color: dateFrom || dateTo ? '#1e293b' : '#94a3b8' }}>
                        {dateFrom && dateTo
                            ? (locale === 'ar' ? `${formatDate(dateFrom)} ← ${formatDate(dateTo)}` : `${formatDate(dateFrom)} → ${formatDate(dateTo)}`)
                            : dateFrom
                                ? `${formatDate(dateFrom)} → ...`
                                : t('select_date_range' as any)}
                    </span>
                </div>
                <span style={{ color: '#94a3b8', fontSize: '0.7rem' }}>{isOpen ? '▲' : '▼'}</span>
            </div>

            {isOpen && mounted && (
                isMobile ? createPortal(
                    <div
                        onClick={() => setIsOpen(false)}
                        style={{
                            position: 'fixed',
                            inset: 0,
                            background: 'rgba(0,0,0,0.4)',
                            zIndex: 10000,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center'
                        }}>
                        {pickerContent}
                    </div>,
                    document.body
                ) : pickerContent
            )}
        </div>
    )
}

'use client'
import { useState, useRef, useEffect, useMemo } from 'react'
import { useLanguage } from '@/context/LanguageContext'
import { createPortal } from 'react-dom'
import { useHydrated } from '@/lib/useHydrated'

interface DateTimePickerProps {
    value: string
    onChange: (value: string) => void
    label?: string
    min?: string
    customTrigger?: React.ReactNode
}

export default function DateTimePicker({ value, onChange, label, min, customTrigger }: DateTimePickerProps) {

    const { t, locale } = useLanguage()
    const [isOpen, setIsOpen] = useState(false)
    const mounted = useHydrated()
    const [isMobile, setIsMobile] = useState(false)
    const [currentMonth, setCurrentMonth] = useState(new Date())
    const containerRef = useRef<HTMLDivElement>(null)

    // Parse value to Date object - Memoized to prevent dependency shifts
    const selectedDate = useMemo(() => value ? new Date(value) : null, [value])

    useEffect(() => {
        const checkMobile = () => setIsMobile(window.innerWidth <= 768)
        checkMobile()
        window.addEventListener('resize', checkMobile)
        return () => window.removeEventListener('resize', checkMobile)
    }, [])

    // Opening jumps the calendar to the selected month, or to the earliest
    // allowed month when nothing valid is selected. Done in the click that
    // opens it rather than in an effect watching isOpen, which painted the
    // stale month first and then corrected it.
    const toggleOpen = () => {
        if (isOpen) {
            setIsOpen(false)
            return
        }
        const minDate = min ? new Date(min) : new Date()
        const shown = selectedDate && selectedDate >= minDate ? selectedDate : minDate
        setCurrentMonth(new Date(shown.getFullYear(), shown.getMonth(), 1))
        setIsOpen(true)
    }

    // Close dropdown when clicking outside
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
                // If portal is open, the click hits the overlay first usually,
                // but this is still good as a fallback.
                if (!isOpen) setIsOpen(false)
            }
        }
        document.addEventListener('mousedown', handleClickOutside)
        return () => document.removeEventListener('mousedown', handleClickOutside)
    }, [isOpen])

    const formatDate = (date: Date) => {
        return date.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' })
    }

    const formatTime = (date: Date) => {
        return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    }

    const getDaysInMonth = (date: Date) => {
        const year = date.getFullYear()
        const month = date.getMonth()
        const firstDay = new Date(year, month, 1)
        const lastDay = new Date(year, month + 1, 0)
        const daysInMonth = lastDay.getDate()
        const startingDayOfWeek = firstDay.getDay()

        const days = []
        for (let i = 0; i < startingDayOfWeek; i++) {
            days.push(null)
        }
        for (let day = 1; day <= daysInMonth; day++) {
            days.push(new Date(year, month, day))
        }
        return days
    }

    const handleDateClick = (date: Date) => {
        const newDate = new Date(date)
        if (selectedDate) {
            newDate.setHours(selectedDate.getHours())
            newDate.setMinutes(selectedDate.getMinutes())
        } else {
            newDate.setHours(12)
            newDate.setMinutes(0)
        }
        onChange(newDate.toISOString())
    }

    const handleTimeChange = (type: 'hour' | 'minute' | 'period', val: string | number) => {
        const newDate = selectedDate ? new Date(selectedDate) : new Date()
        let h = newDate.getHours()
        let m = newDate.getMinutes()

        if (type === 'hour') {
            const hour12 = val as number
            const isPM = h >= 12
            if (isPM) {
                h = hour12 === 12 ? 12 : hour12 + 12
            } else {
                h = hour12 === 12 ? 0 : hour12
            }
        } else if (type === 'minute') {
            m = val as number
        } else if (type === 'period') {
            const period = val as string
            const h12 = h % 12 || 12
            if (period === 'PM') {
                h = h12 === 12 ? 12 : h12 + 12
            } else {
                h = h12 === 12 ? 0 : h12
            }
        }

        newDate.setHours(h)
        newDate.setMinutes(m)
        onChange(newDate.toISOString())
    }

    const days_list = getDaysInMonth(currentMonth)
    const months = [
        t('month_january' as any) || 'January',
        t('month_february' as any) || 'February',
        t('month_march' as any) || 'March',
        t('month_april' as any) || 'April',
        t('month_may' as any) || 'May',
        t('month_june' as any) || 'June',
        t('month_july' as any) || 'July',
        t('month_august' as any) || 'August',
        t('month_september' as any) || 'September',
        t('month_october' as any) || 'October',
        t('month_november' as any) || 'November',
        t('month_december' as any) || 'December'
    ]
    const monthYear = `${months[currentMonth.getMonth()]} ${currentMonth.getFullYear()}`

    const hours12 = Array.from({ length: 12 }, (_, i) => i + 1)
    const minutes = Array.from({ length: 60 }, (_, i) => i)

    const isToday = (date: Date) => {
        const today = new Date()
        return date.getDate() === today.getDate() && date.getMonth() === today.getMonth() && date.getFullYear() === today.getFullYear()
    }

    const isSelected = (date: Date) => {
        return selectedDate && date.getDate() === selectedDate.getDate() && date.getMonth() === selectedDate.getMonth() && date.getFullYear() === selectedDate.getFullYear()
    }

    const currentH24 = selectedDate?.getHours() ?? 12
    const currentH12 = currentH24 % 12 || 12
    const currentPeriod = currentH24 >= 12 ? 'PM' : 'AM'

    return (
        <div ref={containerRef} style={{ position: 'relative', width: '100%', direction: locale === 'ar' ? 'rtl' : 'ltr' }}>
            {label && <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: '600', textAlign: locale === 'ar' ? 'right' : 'left' }}>{label}</label>}
            {customTrigger ? (
                <div onClick={toggleOpen}>
                    {customTrigger}
                </div>
            ) : (
                <div
                    onClick={toggleOpen}
                    style={{
                        padding: '0.625rem 1rem',
                        borderRadius: '1rem',
                        border: '1px solid var(--veil-40)',
                        fontSize: '1rem',
                        cursor: 'pointer',
                        background: 'var(--veil-60)',
                        backdropFilter: 'blur(4px)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        minHeight: '42px',
                        transition: 'all 0.2s',
                        boxShadow: isOpen ? '0 0 0 4px color-mix(in srgb, var(--primary) 15%, transparent)' : 'none',
                        borderColor: isOpen ? 'var(--brand-primary)' : 'var(--veil-40)'
                    }}
                >
                    <span style={{ color: value ? 'var(--text-main)' : 'var(--text-faint)', fontWeight: value ? '600' : '400' }}>
                        {selectedDate ? `${formatDate(selectedDate)} - ${formatTime(selectedDate)}` : t('select_deadline')}
                    </span>
                    <span style={{ color: 'var(--brand-primary-text)', fontSize: '1.2rem' }}>📅</span>
                </div>
            )}

            {isOpen && mounted && createPortal(
                <div
                    onClick={() => setIsOpen(false)}
                    style={{
                        position: 'fixed',
                        top: 0,
                        left: 0,
                        right: 0,
                        bottom: 0,
                        backgroundColor: 'var(--scrim)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        zIndex: 11000,
                        animation: 'fadeIn 0.2s ease-out'
                    }}
                >
                    <style>{`
                        @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
                        @keyframes modalSlideIn {
                            from { transform: translateY(10px) scale(0.98); opacity: 0; }
                            to { transform: translateY(0) scale(1); opacity: 1; }
                        }
                    `}</style>
                    <div
                        onClick={(e) => e.stopPropagation()}
                        style={{
                            background: 'var(--surface)',
                            border: '1px solid var(--border)',
                            borderRadius: '1.5rem',
                            boxShadow: '0 25px 50px -12px var(--shadow-mid)',
                            padding: '1.25rem',
                            width: isMobile ? 'min(calc(100vw - 3rem), 400px)' : '480px',
                            maxHeight: '90vh',
                            overflowY: 'auto',
                            display: 'flex',
                            flexDirection: 'column',
                            gap: '1rem',
                            animation: 'modalSlideIn 0.3s cubic-bezier(0.16, 1, 0.3, 1)',
                            position: 'relative',
                            direction: locale === 'ar' ? 'rtl' : 'ltr'
                        }}
                    >

                        <div style={{ display: 'flex', flexDirection: isMobile ? 'column' : 'row', gap: '1.25rem', alignItems: isMobile ? 'center' : 'flex-start' }}>
                            {/* Date Picker Section */}
                            <div style={{ width: isMobile ? '100%' : '260px' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
                                    <button
                                        type="button"
                                        onClick={() => setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() + (locale === 'ar' ? 1 : -1)))}
                                        style={{ background: 'var(--surface-subtle)', border: '1px solid var(--border)', borderRadius: '0.5rem', padding: '0.3rem', cursor: 'pointer' }}
                                    >
                                        {locale === 'ar' ? '→' : '←'}
                                    </button>
                                    <div style={{ fontWeight: '800', color: 'var(--text-main)', fontSize: '0.9rem' }}>{monthYear}</div>
                                    <button
                                        type="button"
                                        onClick={() => setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() + (locale === 'ar' ? -1 : 1)))}
                                        style={{ background: 'var(--surface-subtle)', border: '1px solid var(--border)', borderRadius: '0.5rem', padding: '0.3rem', cursor: 'pointer' }}
                                    >
                                        {locale === 'ar' ? '←' : '→'}
                                    </button>
                                </div>

                                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '0.1rem', marginBottom: '0.4rem' }}>
                                    {[t('sun'), t('mon'), t('tue'), t('wed'), t('thu'), t('fri'), t('sat')].map(d => (
                                        <div key={d} style={{ textAlign: 'center', fontSize: '0.65rem', fontWeight: 'bold', color: 'var(--text-faint)' }}>{d}</div>
                                    ))}
                                </div>

                                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '0.1rem' }}>
                                    {days_list.map((date, i) => {
                                        if (!date) return <div key={i} />
                                        const selected = isSelected(date)
                                        const today = isToday(date)
                                        const disabled = !!(min && new Date(date).setHours(23, 59, 59, 999) < new Date(min).getTime())

                                        return (
                                            <button
                                                key={i}
                                                type="button"
                                                onClick={() => !disabled && handleDateClick(date)}
                                                disabled={disabled}
                                                style={{
                                                    padding: '0.35rem',
                                                    borderRadius: '0.5rem',
                                                    border: 'none',
                                                    background: selected ? 'var(--brand-primary)' : today ? 'color-mix(in srgb, var(--warn-solid) 13%, transparent)' : 'transparent',
                                                    color: selected ? 'white' : today ? 'var(--warn-solid)' : disabled ? 'var(--border-firm)' : 'var(--text-muted)',
                                                    fontSize: '0.8rem',
                                                    fontWeight: selected || today ? '700' : '500',
                                                    cursor: disabled ? 'not-allowed' : 'pointer',
                                                    aspectRatio: '1',
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    justifyContent: 'center'
                                                }}
                                            >
                                                {date.getDate()}
                                            </button>
                                        )
                                    })}
                                </div>
                            </div>

                            {/* Time Picker Section */}
                            <div style={{
                                width: isMobile ? '100%' : '140px',
                                [locale === 'ar' ? 'borderRight' : 'borderLeft']: isMobile ? 'none' : '1px solid var(--surface-sunk)',
                                [locale === 'ar' ? 'paddingRight' : 'paddingLeft']: isMobile ? '0' : '1.25rem',
                                borderTop: isMobile ? '1px solid var(--surface-sunk)' : 'none',
                                paddingTop: isMobile ? '1rem' : '0'
                            }}>
                                <div style={{ fontSize: '0.85rem', fontWeight: '800', marginBottom: '1rem', color: 'var(--text-main)', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                                    <span>🕒</span> {t('time_label' as any) || 'Time'}
                                </div>

                                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                                    <div>
                                        <label style={{ fontSize: '0.65rem', color: 'var(--text-faint)', fontWeight: 'bold', display: 'block', marginBottom: '0.2rem' }}>{t('hour_label')}</label>
                                        <select aria-label={t('hour_label')}
                                            className="input"
                                            value={currentH12}
                                            onChange={(e) => handleTimeChange('hour', parseInt(e.target.value))}
                                            style={{ width: '100%', textAlign: 'center', height: '32px', fontSize: '0.8rem', padding: locale === 'ar' ? '0 1.25rem 0 0' : '0 0 0 1.25rem' }}
                                        >
                                            {hours12.map(h => {
                                                // Simple restriction check: if today is selected and min is today
                                                // We should disable invalid options. 
                                                // For simplicity, I'll just keep the options but maybe show an error if they Confirm an invalid time.
                                                // Or just let the user select and handle it in handleTimeChange.
                                                return <option key={h} value={h}>{h.toString().padStart(2, '0')}</option>
                                            })}
                                        </select>
                                    </div>

                                    <div>
                                        <label style={{ fontSize: '0.65rem', color: 'var(--text-faint)', fontWeight: 'bold', display: 'block', marginBottom: '0.2rem' }}>{t('minute_label')}</label>
                                        <select aria-label={t('minute_label')}
                                            className="input"
                                            value={selectedDate?.getMinutes() || 0}
                                            onChange={(e) => handleTimeChange('minute', parseInt(e.target.value))}
                                            style={{ width: '100%', textAlign: 'center', height: '32px', fontSize: '0.8rem', padding: locale === 'ar' ? '0 1.25rem 0 0' : '0 0 0 1.25rem' }}
                                        >
                                            {minutes.filter(m => m % 5 === 0).map(m => (
                                                <option key={m} value={m}>{m.toString().padStart(2, '0')}</option>
                                            ))}
                                        </select>
                                    </div>

                                    <div>
                                        <label style={{ fontSize: '0.65rem', color: 'var(--text-faint)', fontWeight: 'bold', display: 'block', marginBottom: '0.2rem' }}>{t('am_pm_label')}</label>
                                        <select aria-label={t('am_pm_label')}
                                            className="input"
                                            value={currentPeriod}
                                            onChange={(e) => handleTimeChange('period', e.target.value)}
                                            style={{ width: '100%', textAlign: 'center', height: '32px', fontSize: '0.8rem', padding: locale === 'ar' ? '0 1.25rem 0 0' : '0 0 0 1.25rem' }}
                                        >
                                            <option value="AM">{t('am')}</option>
                                            <option value="PM">{t('pm')}</option>
                                        </select>
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* Validation Feedback */}
                        {min && selectedDate && selectedDate < new Date(min) && (
                            <div style={{ color: 'var(--danger-solid)', fontSize: '0.75rem', fontWeight: '600', textAlign: 'center' }}>
                                {t('min_selection_error')}
                            </div>
                        )}

                        <button
                            type="button"
                            onClick={() => setIsOpen(false)}
                            disabled={!!(min && selectedDate && selectedDate < new Date(min))}
                            style={{
                                width: '100%',
                                padding: '0.7rem',
                                borderRadius: '0.75rem',
                                background: (min && selectedDate && selectedDate < new Date(min))
                                    ? 'var(--border-firm)'
                                    : 'linear-gradient(135deg, var(--brand-primary) 0%, var(--brand-accent) 100%)',
                                color: 'var(--text-on-accent)',
                                border: 'none',
                                fontWeight: '700',
                                cursor: (min && selectedDate && selectedDate < new Date(min)) ? 'not-allowed' : 'pointer',
                                transition: 'all 0.2s',
                                fontSize: '0.9rem'
                            }}
                        >
                            {t('confirm_selection_button' as any) || 'Confirm Selection'}
                        </button>
                    </div>
                </div>,
                document.body
            )}
        </div>
    )
}

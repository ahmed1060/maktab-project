'use client'
import { useState, useRef, useEffect, useMemo } from 'react'
import { useLanguage } from '@/context/LanguageContext'
import { createPortal } from 'react-dom'

interface DateTimePickerProps {
    value: string
    onChange: (value: string) => void
    label?: string
    min?: string
}

export default function DateTimePicker({ value, onChange, label, min }: DateTimePickerProps) {
    const { t, locale } = useLanguage()
    const [isOpen, setIsOpen] = useState(false)
    const [mounted, setMounted] = useState(false)
    const [currentMonth, setCurrentMonth] = useState(new Date())
    const containerRef = useRef<HTMLDivElement>(null)

    // Parse value to Date object - Memoized to prevent dependency shifts
    const selectedDate = useMemo(() => value ? new Date(value) : null, [value])

    useEffect(() => {
        setMounted(true)
        if (selectedDate && isOpen) {
            setCurrentMonth(new Date(selectedDate.getFullYear(), selectedDate.getMonth(), 1))
        }
    }, [isOpen, selectedDate])

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
            <div
                onClick={() => setIsOpen(!isOpen)}
                style={{
                    padding: '0.625rem 1rem',
                    borderRadius: '1rem',
                    border: '1px solid rgba(255, 255, 255, 0.4)',
                    fontSize: '1rem',
                    cursor: 'pointer',
                    background: 'rgba(255, 255, 255, 0.6)',
                    backdropFilter: 'blur(4px)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    minHeight: '42px',
                    transition: 'all 0.2s',
                    boxShadow: isOpen ? '0 0 0 4px rgba(99, 102, 241, 0.15)' : 'none',
                    borderColor: isOpen ? '#6366f1' : 'rgba(255, 255, 255, 0.4)'
                }}
            >
                <span style={{ color: value ? 'var(--text-main)' : '#94a3b8', fontWeight: value ? '600' : '400' }}>
                    {selectedDate ? `${formatDate(selectedDate)} - ${formatTime(selectedDate)}` : 'Select deadline...'}
                </span>
                <span style={{ color: '#6366f1', fontSize: '1.2rem' }}>📅</span>
            </div>

            {isOpen && mounted && createPortal(
                <div
                    onClick={() => setIsOpen(false)}
                    style={{
                        position: 'fixed',
                        top: 0,
                        left: 0,
                        right: 0,
                        bottom: 0,
                        backgroundColor: 'rgba(0, 0, 0, 0.4)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        zIndex: 9999,
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
                            background: 'white',
                            border: '1px solid #e2e8f0',
                            borderRadius: '1.5rem',
                            boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
                            padding: '1.25rem',
                            width: 'auto',
                            display: 'flex',
                            flexDirection: 'column',
                            gap: '1rem',
                            animation: 'modalSlideIn 0.3s cubic-bezier(0.16, 1, 0.3, 1)',
                            position: 'relative',
                            direction: locale === 'ar' ? 'rtl' : 'ltr'
                        }}
                    >

                        <div style={{ display: 'flex', gap: '1.25rem', alignItems: 'flex-start' }}>
                            {/* Date Picker Section */}
                            <div style={{ width: '260px' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
                                    <button
                                        type="button"
                                        onClick={() => setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1))}
                                        style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '0.5rem', padding: '0.3rem', cursor: 'pointer' }}
                                    >
                                        ←
                                    </button>
                                    <div style={{ fontWeight: '800', color: '#1e293b', fontSize: '0.9rem' }}>{monthYear}</div>
                                    <button
                                        type="button"
                                        onClick={() => setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1))}
                                        style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '0.5rem', padding: '0.3rem', cursor: 'pointer' }}
                                    >
                                        →
                                    </button>
                                </div>

                                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '0.1rem', marginBottom: '0.4rem' }}>
                                    {[t('sun'), t('mon'), t('tue'), t('wed'), t('thu'), t('fri'), t('sat')].map(d => (
                                        <div key={d} style={{ textAlign: 'center', fontSize: '0.65rem', fontWeight: 'bold', color: '#94a3b8' }}>{d}</div>
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
                                                    background: selected ? '#6366f1' : today ? '#f59e0b20' : 'transparent',
                                                    color: selected ? 'white' : today ? '#f59e0b' : disabled ? '#cbd5e1' : '#475569',
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
                            <div style={{ width: '140px', [locale === 'ar' ? 'borderRight' : 'borderLeft']: '1px solid #f1f5f9', [locale === 'ar' ? 'paddingRight' : 'paddingLeft']: '1.25rem' }}>
                                <div style={{ fontSize: '0.85rem', fontWeight: '800', marginBottom: '1rem', color: '#1e293b', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                                    <span>🕒</span> {t('time_label' as any) || 'Time'}
                                </div>

                                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                                    <div>
                                        <label style={{ fontSize: '0.65rem', color: '#94a3b8', fontWeight: 'bold', display: 'block', marginBottom: '0.2rem' }}>HOUR</label>
                                        <select
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
                                        <label style={{ fontSize: '0.65rem', color: '#94a3b8', fontWeight: 'bold', display: 'block', marginBottom: '0.2rem' }}>MIN</label>
                                        <select
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
                                        <label style={{ fontSize: '0.65rem', color: '#94a3b8', fontWeight: 'bold', display: 'block', marginBottom: '0.2rem' }}>AM/PM</label>
                                        <select
                                            className="input"
                                            value={currentPeriod}
                                            onChange={(e) => handleTimeChange('period', e.target.value)}
                                            style={{ width: '100%', textAlign: 'center', height: '32px', fontSize: '0.8rem', padding: locale === 'ar' ? '0 1.25rem 0 0' : '0 0 0 1.25rem' }}
                                        >
                                            <option value="AM">AM</option>
                                            <option value="PM">PM</option>
                                        </select>
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* Validation Feedback */}
                        {min && selectedDate && selectedDate < new Date(min) && (
                            <div style={{ color: '#ef4444', fontSize: '0.75rem', fontWeight: '600', textAlign: 'center' }}>
                                ⚠️ Minimum selection: 3 hours from now
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
                                    ? '#cbd5e1'
                                    : 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)',
                                color: 'white',
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

'use client'
import { useState, useRef, useEffect } from 'react'

interface DateRangePickerProps {
    dateFrom: string
    dateTo: string
    onChange: (from: string, to: string) => void
}

export default function DateRangePicker({ dateFrom, dateTo, onChange }: DateRangePickerProps) {
    const [isOpen, setIsOpen] = useState(false)
    const [currentMonth, setCurrentMonth] = useState(new Date())
    const [selectingFrom, setSelectingFrom] = useState(true)
    const containerRef = useRef<HTMLDivElement>(null)

    // Close dropdown when clicking outside
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
                setIsOpen(false)
            }
        }
        document.addEventListener('mousedown', handleClickOutside)
        return () => document.removeEventListener('mousedown', handleClickOutside)
    }, [])

    const formatDate = (dateStr: string) => {
        if (!dateStr) return ''
        const date = new Date(dateStr)
        return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
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

    const handleDateClick = (date: Date) => {
        // Format date as YYYY-MM-DD in local timezone to avoid offset issues
        const year = date.getFullYear()
        const month = String(date.getMonth() + 1).padStart(2, '0')
        const day = String(date.getDate()).padStart(2, '0')
        const dateStr = `${year}-${month}-${day}`

        if (selectingFrom) {
            onChange(dateStr, dateTo)
            setSelectingFrom(false)
        } else {
            if (new Date(dateStr) < new Date(dateFrom)) {
                onChange(dateStr, dateFrom)
            } else {
                onChange(dateFrom, dateStr)
            }
            setIsOpen(false)
            setSelectingFrom(true)
        }
    }

    const isInRange = (date: Date) => {
        if (!dateFrom || !dateTo) return false
        const d = date.toISOString().split('T')[0]
        return d >= dateFrom && d <= dateTo
    }

    const isStartDate = (date: Date) => {
        return date.toISOString().split('T')[0] === dateFrom
    }

    const isEndDate = (date: Date) => {
        return date.toISOString().split('T')[0] === dateTo
    }

    const days = getDaysInMonth(currentMonth)
    const monthYear = currentMonth.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })

    return (
        <div ref={containerRef} style={{ position: 'relative' }}>
            <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: '600', fontSize: '0.875rem' }}>
                Filter by Date Range
            </label>
            <div
                onClick={() => setIsOpen(!isOpen)}
                style={{
                    padding: '0.5rem 1rem',
                    borderRadius: '0.5rem',
                    border: '1px solid #cbd5e1',
                    fontSize: '0.875rem',
                    cursor: 'pointer',
                    background: 'white',
                    minWidth: '200px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between'
                }}
            >
                <span style={{ color: dateFrom || dateTo ? '#1e293b' : '#94a3b8' }}>
                    {dateFrom && dateTo ? `${formatDate(dateFrom)} → ${formatDate(dateTo)}` : 'Select date range'}
                </span>
                <span style={{ color: '#94a3b8', marginLeft: '0.5rem' }}>📅</span>
            </div>

            {isOpen && (
                <div style={{
                    position: 'absolute',
                    top: '100%',
                    left: 0,
                    marginTop: '0.5rem',
                    background: 'white',
                    border: '1px solid #e2e8f0',
                    borderRadius: '0.75rem',
                    boxShadow: '0 10px 25px rgba(0, 0, 0, 0.1)',
                    padding: '1rem',
                    zIndex: 1000,
                    minWidth: '320px'
                }}>
                    {/* Month Navigation */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                        <button
                            onClick={() => setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1))}
                            style={{
                                background: 'none',
                                border: 'none',
                                fontSize: '1.25rem',
                                cursor: 'pointer',
                                padding: '0.25rem 0.5rem',
                                color: '#64748b'
                            }}
                        >
                            ‹
                        </button>
                        <div style={{ fontWeight: '600', fontSize: '0.95rem', color: '#64748b' }}>
                            {monthYear}
                        </div>
                        <button
                            onClick={() => setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1))}
                            style={{
                                background: 'none',
                                border: 'none',
                                fontSize: '1.25rem',
                                cursor: 'pointer',
                                padding: '0.25rem 0.5rem',
                                color: '#64748b'
                            }}
                        >
                            ›
                        </button>
                    </div>

                    {/* Weekday Headers */}
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '0.25rem', marginBottom: '0.5rem' }}>
                        {['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map(day => (
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
                                    onClick={() => handleDateClick(date)}
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
                                    onMouseEnter={(e) => {
                                        if (!isStart && !isEnd) {
                                            e.currentTarget.style.background = '#f1f5f9'
                                        }
                                    }}
                                    onMouseLeave={(e) => {
                                        if (!isStart && !isEnd) {
                                            e.currentTarget.style.background = inRange ? '#dbeafe' : 'transparent'
                                        }
                                    }}
                                >
                                    {date.getDate()}
                                </button>
                            )
                        })}
                    </div>

                    {/* Instructions */}
                    <div style={{ marginTop: '1rem', fontSize: '0.75rem', color: '#64748b', textAlign: 'center' }}>
                        {selectingFrom ? 'Select start date' : 'Select end date'}
                    </div>
                </div>
            )}
        </div>
    )
}

'use client'

import { useState, useEffect } from 'react'

interface SafeDateProps {
    date: string | Date | null | undefined
    showTime?: boolean
    hour12?: boolean
    format?: 'short' | 'long' | 'dateOnly' | 'timeOnly'
    className?: string
    locale?: string
}

export default function SafeDate({
    date,
    showTime = true,
    hour12 = true,
    format = 'long',
    className = '',
    locale = 'en-US'
}: SafeDateProps) {
    const [mounted, setMounted] = useState(false)

    useEffect(() => {
        setMounted(true)
    }, [])

    if (!mounted || !date) return null

    const d = new Date(date)
    if (isNaN(d.getTime())) return null

    const l = locale === 'ar' ? 'ar-EG' : 'en-GB'

    if (format === 'dateOnly') {
        return (
            <span className={className}>
                {d.toLocaleDateString(l, { day: 'numeric', month: 'short', year: 'numeric' })}
            </span>
        )
    }

    if (format === 'timeOnly') {
        return (
            <span className={className}>
                {d.toLocaleTimeString(l, { hour: 'numeric', minute: '2-digit', hour12 })}
            </span>
        )
    }

    if (format === 'short') {
        return (
            <span className={className}>
                {d.toLocaleDateString(l, { day: 'numeric', month: 'short' })}
                {showTime && `, ${d.toLocaleTimeString(l, { hour: 'numeric', minute: '2-digit', hour12 })}`}
            </span>
        )
    }

    // Default 'long'
    return (
        <span className={className}>
            {d.toLocaleDateString(l, { day: 'numeric', month: 'short', year: 'numeric' })}
            {showTime && ', '}
            {showTime && d.toLocaleTimeString(l, { hour: 'numeric', minute: '2-digit', hour12 })}
        </span>
    )
}

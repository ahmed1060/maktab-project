'use client'

import { useState, useEffect, useRef } from 'react'

interface LocationSearchInputProps {
    value: { name: string, link: string }
    onChange: (val: { name: string, link: string }) => void
    placeholder?: string
    label?: string
    locale: string
}

export default function LocationSearchInput({ value, onChange, placeholder, label, locale }: LocationSearchInputProps) {
    const [query, setQuery] = useState(value.name)
    const [suggestions, setSuggestions] = useState<any[]>([])
    const [loading, setLoading] = useState(false)
    const [showSuggestions, setShowSuggestions] = useState(false)
    const wrapperRef = useRef<HTMLDivElement>(null)

    useEffect(() => {
        setQuery(value.name)
    }, [value.name])

    useEffect(() => {
        function handleClickOutside(event: MouseEvent) {
            if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
                setShowSuggestions(false)
            }
        }
        document.addEventListener('mousedown', handleClickOutside)
        return () => document.removeEventListener('mousedown', handleClickOutside)
    }, [])

    const searchLocations = async (text: string) => {
        if (!text || text.length < 3) {
            setSuggestions([])
            return
        }
        setLoading(true)
        const apiKey = process.env.NEXT_PUBLIC_HERE_API_KEY
        try {
            // Using a default bias for the region if possible, or generic
            const at = '30.0444,31.2357' // Cairo, Egypt as a bias center
            const res = await fetch(`https://autosuggest.search.hereapi.com/v1/autosuggest?q=${encodeURIComponent(text)}&at=${at}&apiKey=${apiKey}&lang=${locale === 'ar' ? 'ar' : 'en'}`)

            if (res.ok) {
                const data = await res.json()
                // Filter items that have a title and address
                const items = (data.items || []).filter((item: any) => item.title && item.address)
                setSuggestions(items)
                setShowSuggestions(true)
            }
        } catch (error) {
            console.error('Location search failed', error)
        } finally {
            setLoading(false)
        }
    }

    // Debounce search
    useEffect(() => {
        const timer = setTimeout(() => {
            if (query !== value.name) {
                searchLocations(query)
            }
        }, 800)
        return () => clearTimeout(timer)
    }, [query])

    const handleSelect = (s: any) => {
        const name = s.address.label || s.title
        let link = ''
        if (s.position) {
            link = `https://www.google.com/maps?q=${s.position.lat},${s.position.lng}`
        } else if (s.access && s.access[0]) {
            link = `https://www.google.com/maps?q=${s.access[0].lat},${s.access[0].lng}`
        }

        onChange({ name, link })
        setQuery(name)
        setShowSuggestions(false)
    }

    return (
        <div ref={wrapperRef} style={{ position: 'relative', width: '100%' }}>
            {label && <label className="label" style={{ display: 'block', marginBottom: '0.5rem' }}>{label}</label>}
            <div style={{ position: 'relative' }}>
                <input
                    type="text"
                    className="input"
                    value={query}
                    onChange={(e) => {
                        setQuery(e.target.value)
                        if (e.target.value === '') {
                            onChange({ name: '', link: '' })
                        }
                    }}
                    onFocus={() => query.length >= 3 && setShowSuggestions(true)}
                    placeholder={placeholder}
                    style={{ width: '100%', paddingRight: loading ? '2rem' : '0.75rem' }}
                />
                {loading && (
                    <div style={{ position: 'absolute', right: locale === 'ar' ? 'auto' : '0.75rem', left: locale === 'ar' ? '0.75rem' : 'auto', top: '50%', transform: 'translateY(-50%)' }}>
                        <div style={{ width: '16px', height: '16px', border: '2px solid #e2e8f0', borderTopColor: '#3b82f6', borderRadius: '50%', animation: 'spin 1s linear infinite' }}></div>
                    </div>
                )}
            </div>

            {showSuggestions && suggestions.length > 0 && (
                <div style={{
                    position: 'absolute',
                    top: '100%',
                    left: 0,
                    right: 0,
                    zIndex: 1000,
                    background: 'white',
                    border: '1px solid #e2e8f0',
                    borderRadius: '0.5rem',
                    boxShadow: '0 4px 6px -1px rgba(0,0,0,0.1)',
                    marginTop: '0.25rem',
                    maxHeight: '200px',
                    overflowY: 'auto'
                }}>
                    {suggestions.map((s, i) => (
                        <div
                            key={i}
                            onClick={() => handleSelect(s)}
                            style={{
                                padding: '0.75rem 1rem',
                                cursor: 'pointer',
                                borderBottom: i < suggestions.length - 1 ? '1px solid #f1f5f9' : 'none',
                                fontSize: '0.85rem',
                                color: '#1e293b',
                                transition: 'background 0.2s'
                            }}
                            onMouseEnter={(e) => (e.currentTarget.style.background = '#f8fafc')}
                            onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                        >
                            {s.address.label || s.title}
                        </div>
                    ))}
                </div>
            )}

            <style jsx>{`
                @keyframes spin {
                    to { transform: rotate(360deg); }
                }
            `}</style>
        </div>
    )
}

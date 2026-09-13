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
    }, [value?.name])

    const searchLocations = async (text: string) => {
        if (!text || text.length < 3) {
            setSuggestions([])
            return
        }
        setLoading(true)
        const apiKey = process.env.NEXT_PUBLIC_HERE_API_KEY
        if (!apiKey) {
            console.warn('HERE API Key is missing')
            setLoading(false)
            return
        }

        try {
            const at = '30.0444,31.2357'

            // Dynamic language detection: Check if the text contains Arabic characters
            // [\u0600-\u06FF] is the Unicode range for Arabic characters
            const isArabicInput = /[\u0600-\u06FF]/.test(text)
            const detectedLang = isArabicInput ? 'ar' : 'en'

            const res = await fetch(`https://autosuggest.search.hereapi.com/v1/autosuggest?q=${encodeURIComponent(text)}&at=${at}&apiKey=${apiKey}&lang=${detectedLang}&in=countryCode:EGY`)

            if (res.ok) {
                const data = await res.json()
                const items = (data.items || []).filter((item: any) => item.title)
                setSuggestions(items)
                setShowSuggestions(true)
            } else {
                const err = await res.json().catch(() => ({}))
                console.error('HERE API Error Details:', {
                    status: res.status,
                    message: err.message,
                    error: err.error,
                    description: err.error_description
                })
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
    }, [query, value.name])

    const handleSelect = (s: any) => {
        const name = s.address?.label || s.title
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
                    onBlur={() => {
                        // Typing a location HERE's autosuggest doesn't recognize
                        // (an uncommon format, a placeholder name, a slow/failed
                        // request) used to leave the parent's value untouched no
                        // matter what was typed — onChange only ever fired from
                        // handleSelect below or from clearing the field to empty.
                        // That silently blocked submission everywhere this
                        // component is used (Vendors, task creation, the bulk
                        // review modal, task editing) with no error shown. Commit
                        // whatever's typed on blur as a plain name (no map link,
                        // since it was never verified against a real place) if it
                        // differs from the last committed value. A suggestion
                        // click never reaches this: the list below stops the
                        // input from blurring at all when picking one.
                        const trimmed = query.trim()
                        if (trimmed && trimmed !== value.name) {
                            onChange({ name: trimmed, link: '' })
                        }
                    }}
                    placeholder={placeholder}
                    style={{ width: '100%', paddingRight: loading ? '2rem' : '0.75rem' }}
                />
                {loading && (
                    <div style={{ position: 'absolute', right: locale === 'ar' ? 'auto' : '0.75rem', left: locale === 'ar' ? '0.75rem' : 'auto', top: '50%', transform: 'translateY(-50%)' }}>
                        <div style={{ width: '16px', height: '16px', border: '2px solid var(--border)', borderTopColor: 'var(--info-solid)', borderRadius: '50%', animation: 'spin 1s linear infinite' }}></div>
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
                    background: 'var(--surface)',
                    border: '1px solid var(--border)',
                    borderRadius: '0.5rem',
                    boxShadow: '0 4px 6px -1px rgba(0,0,0,0.1)',
                    marginTop: '0.25rem',
                    maxHeight: '200px',
                    overflowY: 'auto'
                }}>
                    {suggestions.map((s, i) => (
                        <div
                            key={i}
                            // Stops the input from blurring (and thus running the
                            // onBlur commit above with the stale typed text)
                            // before this click has a chance to run at all.
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={() => handleSelect(s)}
                            style={{
                                padding: '0.75rem 1rem',
                                cursor: 'pointer',
                                borderBottom: i < suggestions.length - 1 ? '1px solid var(--surface-sunk)' : 'none',
                                fontSize: '0.85rem',
                                color: 'var(--text-main)',
                                transition: 'background 0.2s'
                            }}
                            onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--surface-subtle)')}
                            onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                        >
                            {s.address?.label || s.title}
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

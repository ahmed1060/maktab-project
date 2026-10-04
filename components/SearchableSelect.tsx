'use client'
import { useState, useMemo, useRef, useEffect } from 'react'
import { useLanguage } from '@/context/LanguageContext'

interface Option {
    label: string
    value: string
    subLabel?: string
}

interface SearchableSelectProps {
    options: Option[]
    value: string
    onChange: (value: string) => void
    placeholder?: string
}

export default function SearchableSelect({ options, value, onChange, placeholder = 'Select...' }: SearchableSelectProps) {
    const { t, locale } = useLanguage()
    const [isOpen, setIsOpen] = useState(false)
    const [searchTerm, setSearchTerm] = useState('')
    const wrapperRef = useRef<HTMLDivElement>(null)
    const inputRef = useRef<HTMLInputElement>(null)

    const selectedOption = options.find(opt => opt.value === value)

    const filteredOptions = useMemo(() => {
        if (!searchTerm) return options
        return options.filter(opt =>
            opt.label.toLowerCase().includes(searchTerm.toLowerCase()) ||
            (opt.subLabel && opt.subLabel.toLowerCase().includes(searchTerm.toLowerCase()))
        )
    }, [options, searchTerm])

    const [isMobile, setIsMobile] = useState(false)

    useEffect(() => {
        const checkMobile = () => setIsMobile(window.innerWidth <= 768)
        checkMobile()
        window.addEventListener('resize', checkMobile)
        return () => window.removeEventListener('resize', checkMobile)
    }, [])

    useEffect(() => {
        function handleClickOutside(event: MouseEvent) {
            if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
                setIsOpen(false)
            }
        }
        document.addEventListener('mousedown', handleClickOutside)
        return () => document.removeEventListener('mousedown', handleClickOutside)
    }, [])

    useEffect(() => {
        if (isOpen && inputRef.current) {
            inputRef.current.focus()
        }
    }, [isOpen])

    return (
        <div ref={wrapperRef} style={{ position: 'relative', minWidth: '240px' }}>
            <div
                onClick={() => setIsOpen(!isOpen)}
                style={{
                    padding: '0.625rem 1rem',
                    borderRadius: '1.25rem',
                    border: isOpen ? '1px solid var(--info-solid)' : '1px solid var(--border)',
                    fontSize: '0.875rem',
                    background: 'var(--surface)',
                    cursor: 'pointer',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    minHeight: '48px',
                    height: '48px',
                    boxShadow: isOpen ? '0 0 0 3px color-mix(in srgb, var(--info-solid) 10%, transparent)' : '0 1px 2px var(--shadow-faint)',
                    transition: 'all 0.2s ease',
                    color: 'var(--text-main)'
                }}
                className="group"
            >
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', overflow: 'hidden' }}>
                    {/* User Icon or Generic Icon */}
                    <div style={{
                        width: '24px',
                        height: '24px',
                        borderRadius: '50%',
                        background: selectedOption ? 'var(--info-bg-indigo)' : 'var(--surface-sunk)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        flexShrink: 0,
                        color: selectedOption ? 'var(--info-solid-hover)' : 'var(--text-faint)'
                    }}>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
                            <circle cx="12" cy="7" r="4"></circle>
                        </svg>
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', lineHeight: '1', flex: 1 }}>
                        {isOpen ? (
                            <input
                                ref={inputRef}
                                type="text"
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                                placeholder={placeholder}
                                onClick={(e) => e.stopPropagation()}
                                style={{
                                    width: '100%',
                                    border: 'none',
                                    padding: 0,
                                    fontSize: '0.95rem',
                                    fontWeight: 500,
                                    background: 'transparent',
                                    color: 'var(--text-strong)',
                                    textAlign: locale === 'ar' ? 'right' : 'left'
                                }}
                            />
                        ) : selectedOption ? (
                            <div style={{ textAlign: locale === 'ar' ? 'right' : 'left' }}>
                                <span style={{ fontWeight: 600, color: 'var(--text-strong)' }}>{selectedOption.label}</span>
                                {selectedOption.subLabel && (
                                    <div style={{ color: 'var(--text-soft)', fontSize: '0.75em', marginTop: '2px' }}>
                                        {selectedOption.subLabel}
                                    </div>
                                )}
                            </div>
                        ) : (
                            <span style={{ color: 'var(--text-faint)', fontWeight: 500 }}>{placeholder}</span>
                        )}
                    </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    {value && (
                        <div
                            onClick={(e) => {
                                e.stopPropagation()
                                onChange('')
                            }}
                            title={t('clear_search')}
                            style={{
                                color: 'var(--text-faint)',
                                padding: '4px',
                                borderRadius: '50%',
                                display: 'flex'
                            }}
                            onMouseEnter={(e) => e.currentTarget.style.background = 'var(--surface-sunk)'}
                            onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                        >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <line x1="18" y1="6" x2="6" y2="18"></line>
                                <line x1="6" y1="6" x2="18" y2="18"></line>
                            </svg>
                        </div>
                    )}
                    <span style={{ color: 'var(--border-firm)', transform: isOpen ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.2s' }}>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="6 9 12 15 18 9"></polyline>
                        </svg>
                    </span>
                </div>
            </div>

            {isOpen && (
                <div style={{
                    position: 'absolute',
                    top: 'calc(100% + 8px)',
                    left: '0',
                    right: '0',
                    margin: isMobile ? '0 1.5rem' : '0',
                    background: 'var(--surface)',
                    border: '1px solid var(--border)',
                    borderRadius: '0.75rem',
                    boxShadow: '0 10px 15px -3px var(--shadow-weak), 0 4px 6px -2px var(--shadow-faint)',
                    zIndex: 50,
                    maxHeight: '320px',
                    overflow: 'hidden',
                    display: 'flex',
                    flexDirection: 'column',
                    animation: 'fadeIn 0.1s ease-out'
                }}>

                    <div style={{ overflowY: 'auto', padding: '0.5rem' }}>
                        <div
                            onClick={() => {
                                onChange('')
                                setIsOpen(false)
                                setSearchTerm('')
                            }}
                            style={{
                                padding: '0.625rem 0.75rem',
                                cursor: 'pointer',
                                fontSize: '0.875rem',
                                borderRadius: '0.375rem',
                                color: !value ? 'var(--info-solid-hover)' : 'var(--text-soft)',
                                background: !value ? 'var(--info-bg-subtle)' : 'transparent',
                                marginBottom: '2px',
                                fontWeight: !value ? 500 : 400
                            }}
                            onMouseEnter={(e) => {
                                if (!value) e.currentTarget.style.background = 'var(--info-bg-indigo)'
                                if (value) e.currentTarget.style.background = 'var(--surface-subtle)'
                            }}
                            onMouseLeave={(e) => {
                                if (!value) e.currentTarget.style.background = 'var(--info-bg-subtle)'
                                if (value) e.currentTarget.style.background = 'transparent'
                            }}
                        >
                            <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: 'currentColor', opacity: 0.5 }}></span>
                                {t('all_employees')}
                            </span>
                        </div>

                        {filteredOptions.length === 0 ? (
                            <div style={{ padding: '1.5rem', textAlign: 'center', color: 'var(--text-faint)', fontSize: '0.875rem' }}>
                                {t('no_matches_found')}
                            </div>
                        ) : (
                            filteredOptions.map(opt => (
                                <div
                                    key={opt.value}
                                    onClick={() => {
                                        onChange(opt.value)
                                        setIsOpen(false)
                                        setSearchTerm('')
                                    }}
                                    style={{
                                        padding: '0.625rem 0.75rem',
                                        cursor: 'pointer',
                                        fontSize: '0.875rem',
                                        borderRadius: '0.375rem',
                                        backgroundColor: value === opt.value ? 'var(--info-bg-subtle)' : 'transparent',
                                        display: 'flex',
                                        justifyContent: 'space-between',
                                        alignItems: 'center',
                                        [locale === 'ar' ? 'borderRight' : 'borderLeft']: value === opt.value ? '3px solid var(--info-solid)' : '3px solid transparent'
                                    }}
                                    onMouseEnter={(e) => {
                                        if (value !== opt.value) e.currentTarget.style.background = 'var(--surface-subtle)'
                                    }}
                                    onMouseLeave={(e) => {
                                        if (value !== opt.value) e.currentTarget.style.background = 'transparent'
                                    }}
                                >
                                    <div style={{ display: 'flex', flexDirection: 'column', textAlign: locale === 'ar' ? 'right' : 'left' }}>
                                        <span style={{ fontWeight: value === opt.value ? 600 : 500, color: value === opt.value ? 'var(--text-main)' : 'var(--text-body)' }}>
                                            {opt.label}
                                        </span>
                                        {opt.subLabel && (
                                            <span style={{ fontSize: '0.75rem', color: 'var(--text-faint)' }}>{opt.subLabel}</span>
                                        )}
                                    </div>
                                    {value === opt.value && (
                                        <span style={{ color: 'var(--info-solid)' }}>
                                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                                <polyline points="20 6 9 17 4 12"></polyline>
                                            </svg>
                                        </span>
                                    )}
                                </div>
                            ))
                        )}
                    </div>
                </div>
            )}
        </div>
    )
}

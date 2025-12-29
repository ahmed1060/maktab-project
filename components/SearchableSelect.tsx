'use client'
import { useState, useMemo, useRef, useEffect } from 'react'

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
                    borderRadius: '0.75rem',
                    border: isOpen ? '1px solid #3b82f6' : '1px solid #e2e8f0',
                    fontSize: '0.875rem',
                    background: 'white',
                    cursor: 'pointer',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    minHeight: '48px',
                    height: '48px',
                    boxShadow: isOpen ? '0 0 0 3px rgba(59, 130, 246, 0.1)' : '0 1px 2px rgba(0, 0, 0, 0.05)',
                    transition: 'all 0.2s ease',
                    color: '#1e293b'
                }}
                className="group"
            >
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', overflow: 'hidden' }}>
                    {/* User Icon or Generic Icon */}
                    <div style={{
                        width: '24px',
                        height: '24px',
                        borderRadius: '50%',
                        background: selectedOption ? '#dbeafe' : '#f1f5f9',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        flexShrink: 0,
                        color: selectedOption ? '#2563eb' : '#94a3b8'
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
                                    outline: 'none',
                                    padding: 0,
                                    fontSize: '0.95rem',
                                    fontWeight: 500,
                                    background: 'transparent',
                                    color: '#0f172a'
                                }}
                            />
                        ) : selectedOption ? (
                            <>
                                <span style={{ fontWeight: 600, color: '#0f172a' }}>{selectedOption.label}</span>
                                {selectedOption.subLabel && (
                                    <span style={{ color: '#64748b', fontSize: '0.75em', marginTop: '2px' }}>
                                        {selectedOption.subLabel}
                                    </span>
                                )}
                            </>
                        ) : (
                            <span style={{ color: '#94a3b8', fontWeight: 500 }}>{placeholder}</span>
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
                            title="Clear selection"
                            style={{
                                color: '#94a3b8',
                                padding: '4px',
                                borderRadius: '50%',
                                display: 'flex'
                            }}
                            onMouseEnter={(e) => e.currentTarget.style.background = '#f1f5f9'}
                            onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                        >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <line x1="18" y1="6" x2="6" y2="18"></line>
                                <line x1="6" y1="6" x2="18" y2="18"></line>
                            </svg>
                        </div>
                    )}
                    <span style={{ color: '#cbd5e1', transform: isOpen ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.2s' }}>
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
                    left: 0,
                    right: 0,
                    background: 'white',
                    border: '1px solid #e2e8f0',
                    borderRadius: '0.75rem',
                    boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05)',
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
                                color: !value ? '#2563eb' : '#64748b',
                                background: !value ? '#eff6ff' : 'transparent',
                                marginBottom: '2px',
                                fontWeight: !value ? 500 : 400
                            }}
                            onMouseEnter={(e) => {
                                if (!value) e.currentTarget.style.background = '#dbeafe'
                                if (value) e.currentTarget.style.background = '#f8fafc'
                            }}
                            onMouseLeave={(e) => {
                                if (!value) e.currentTarget.style.background = '#eff6ff'
                                if (value) e.currentTarget.style.background = 'transparent'
                            }}
                        >
                            <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: 'currentColor', opacity: 0.5 }}></span>
                                All Employees
                            </span>
                        </div>

                        {filteredOptions.length === 0 ? (
                            <div style={{ padding: '1.5rem', textAlign: 'center', color: '#94a3b8', fontSize: '0.875rem' }}>
                                No results found
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
                                        backgroundColor: value === opt.value ? '#eff6ff' : 'transparent',
                                        display: 'flex',
                                        justifyContent: 'space-between',
                                        alignItems: 'center',
                                        borderLeft: value === opt.value ? '3px solid #3b82f6' : '3px solid transparent'
                                    }}
                                    onMouseEnter={(e) => {
                                        if (value !== opt.value) e.currentTarget.style.background = '#f8fafc'
                                    }}
                                    onMouseLeave={(e) => {
                                        if (value !== opt.value) e.currentTarget.style.background = 'transparent'
                                    }}
                                >
                                    <div style={{ display: 'flex', flexDirection: 'column' }}>
                                        <span style={{ fontWeight: value === opt.value ? 600 : 500, color: value === opt.value ? '#1e293b' : '#334155' }}>
                                            {opt.label}
                                        </span>
                                        {opt.subLabel && (
                                            <span style={{ fontSize: '0.75rem', color: '#94a3b8' }}>{opt.subLabel}</span>
                                        )}
                                    </div>
                                    {value === opt.value && (
                                        <span style={{ color: '#3b82f6' }}>
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

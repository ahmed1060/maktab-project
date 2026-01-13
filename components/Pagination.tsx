'use client'

import { useState } from 'react'
import { useLanguage } from '@/context/LanguageContext'

interface PaginationProps {
    currentPage: number
    totalPages: number
    onPageChange: (page: number) => void
}

export default function Pagination({ currentPage, totalPages, onPageChange }: PaginationProps) {
    const { locale } = useLanguage()
    const [jumpPage, setJumpPage] = useState('')

    if (totalPages <= 1) return null

    const handleJumpSubmit = (e: React.FormEvent) => {
        e.preventDefault()
        const page = parseInt(jumpPage)
        if (page >= 1 && page <= totalPages) {
            onPageChange(page)
            setJumpPage('')
        }
    }

    const renderPageNumbers = () => {
        const pages = []
        const maxVisible = 5

        let startPage = Math.max(1, currentPage - 2)
        const endPage = Math.min(totalPages, startPage + maxVisible - 1)

        if (endPage - startPage < maxVisible - 1) {
            startPage = Math.max(1, endPage - maxVisible + 1)
        }

        for (let i = startPage; i <= endPage; i++) {
            pages.push(
                <button
                    key={i}
                    onClick={() => onPageChange(i)}
                    style={{
                        width: '32px',
                        height: '32px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        borderRadius: '50%',
                        fontSize: '0.9rem',
                        fontWeight: '600',
                        transition: 'all 0.2s',
                        background: currentPage === i ? 'rgba(99, 102, 241, 0.2)' : 'transparent',
                        color: currentPage === i ? '#6366f1' : '#475569',
                        border: currentPage === i ? '1px solid #6366f1' : 'none',
                        cursor: 'pointer'
                    }}
                >
                    {i}
                </button>
            )
        }

        return pages
    }

    return (
        <div style={{
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            gap: '2rem',
            marginTop: '2rem',
            marginBottom: '2rem',
            flexWrap: 'wrap'
        }}>
            {/* Main pagination capsule */}
            <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.75rem',
                background: 'white',
                padding: '0.5rem 1rem',
                borderRadius: '9999px',
                boxShadow: '0 4px 15px rgba(0,0,0,0.05)',
                border: '1px solid #f1f5f9',
                direction: 'ltr'
            }}>
                <button
                    disabled={currentPage === 1}
                    onClick={() => onPageChange(currentPage - 1)}
                    style={{
                        padding: '0.25rem',
                        background: 'transparent',
                        border: 'none',
                        cursor: currentPage === 1 ? 'not-allowed' : 'pointer',
                        color: currentPage === 1 ? '#cbd5e1' : '#64748b',
                        display: 'flex',
                        alignItems: 'center'
                    }}
                >
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="15 18 9 12 15 6"></polyline>
                    </svg>
                </button>

                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    {renderPageNumbers()}
                </div>

                <button
                    disabled={currentPage === totalPages}
                    onClick={() => onPageChange(currentPage + 1)}
                    style={{
                        padding: '0.25rem',
                        background: 'transparent',
                        border: 'none',
                        cursor: currentPage === totalPages ? 'not-allowed' : 'pointer',
                        color: currentPage === totalPages ? '#cbd5e1' : '#64748b',
                        display: 'flex',
                        alignItems: 'center'
                    }}
                >
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="9 18 15 12 9 6"></polyline>
                    </svg>
                </button>
            </div>

            {/* Go to page form */}
            <form
                onSubmit={handleJumpSubmit}
                style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.75rem',
                    color: '#64748b',
                    fontSize: '0.9rem',
                    fontWeight: '500'
                }}
            >
                <span>{locale === 'ar' ? 'الذهاب إلى' : 'Go to'}</span>
                <input
                    type="number"
                    min="1"
                    max={totalPages}
                    value={jumpPage}
                    onChange={(e) => setJumpPage(e.target.value)}
                    style={{
                        width: '50px',
                        height: '32px',
                        borderRadius: '1rem',
                        border: '1px solid #e2e8f0',
                        textAlign: 'center',
                        fontSize: '0.85rem',
                        color: '#1e293b',
                        outline: 'none',
                        transition: 'border-color 0.2s'
                    }}
                    onFocus={(e) => e.target.style.borderColor = '#6366f1'}
                    onBlur={(e) => e.target.style.borderColor = '#e2e8f0'}
                />
                <span>{locale === 'ar' ? 'صفحة' : 'Page'}</span>
            </form>
        </div>
    )
}


'use client'

import { useLanguage } from '@/context/LanguageContext'

interface PaginationProps {
    currentPage: number
    totalPages: number
    onPageChange: (page: number) => void
}

export default function Pagination({ currentPage, totalPages, onPageChange }: PaginationProps) {
    const { t, locale } = useLanguage()

    if (totalPages <= 1) return null

    const renderPageNumbers = () => {
        const pages = []
        const maxVisible = 5

        let startPage = Math.max(1, currentPage - 2)
        let endPage = Math.min(totalPages, startPage + maxVisible - 1)

        if (endPage - startPage < maxVisible - 1) {
            startPage = Math.max(1, endPage - maxVisible + 1)
        }

        for (let i = startPage; i <= endPage; i++) {
            pages.push(
                <button
                    key={i}
                    onClick={() => onPageChange(i)}
                    style={{
                        width: '40px',
                        height: '40px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        borderRadius: '8px',
                        fontSize: '0.875rem',
                        fontWeight: '700',
                        transition: 'all 0.2s',
                        background: currentPage === i ? 'rgba(255, 255, 255, 0.1)' : 'transparent',
                        color: currentPage === i ? 'white' : '#94a3b8',
                        border: 'none',
                        cursor: 'pointer'
                    }}
                    className={currentPage === i ? '' : 'hover:bg-white/5 hover:text-white'}
                >
                    {i}
                </button>
            )
        }

        // Add '...' and last page if needed
        if (endPage < totalPages) {
            if (endPage < totalPages - 1) {
                pages.push(
                    <span key="dots" style={{ color: '#64748b', padding: '0 0.5rem' }}>...</span>
                )
            }
            pages.push(
                <button
                    key={totalPages}
                    onClick={() => onPageChange(totalPages)}
                    style={{
                        width: '40px',
                        height: '40px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        borderRadius: '8px',
                        fontSize: '0.875rem',
                        fontWeight: '700',
                        transition: 'all 0.2s',
                        background: 'transparent',
                        color: '#94a3b8',
                        border: 'none',
                        cursor: 'pointer'
                    }}
                    className="hover:bg-white/5 hover:text-white"
                >
                    {totalPages}
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
            gap: '0.5rem',
            marginTop: '2rem',
            marginBottom: '2rem',
            direction: 'ltr' // Keep pagination controls consistent across languages
        }}>
            <button
                disabled={currentPage === 1}
                onClick={() => onPageChange(currentPage - 1)}
                style={{
                    padding: '0 1rem',
                    height: '40px',
                    borderRadius: '8px',
                    fontSize: '0.875rem',
                    fontWeight: '700',
                    transition: 'all 0.2s',
                    background: 'transparent',
                    color: currentPage === 1 ? '#475569' : '#94a3b8',
                    border: 'none',
                    cursor: currentPage === 1 ? 'not-allowed' : 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.5rem'
                }}
                className={currentPage === 1 ? '' : 'hover:bg-white/5 hover:text-white'}
            >
                {locale === 'ar' ? 'السابق' : 'Prev'}
            </button>

            <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                {renderPageNumbers()}
            </div>

            <button
                disabled={currentPage === totalPages}
                onClick={() => onPageChange(currentPage + 1)}
                style={{
                    padding: '0 1.5rem',
                    height: '40px',
                    borderRadius: '8px',
                    fontSize: '0.875rem',
                    fontWeight: '800',
                    transition: 'all 0.2s',
                    background: '#f59e0b', // Vibrant orange from screenshot
                    color: '#000',
                    border: 'none',
                    cursor: currentPage === totalPages ? 'not-allowed' : 'pointer',
                    opacity: currentPage === totalPages ? 0.5 : 1
                }}
                className={currentPage === totalPages ? '' : 'hover:bg-amber-400'}
            >
                {locale === 'ar' ? 'التالي' : 'Next'}
            </button>
        </div>
    )
}

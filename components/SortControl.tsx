'use client'
import { useLanguage } from '@/context/LanguageContext'

interface SortOption {
    label: string
    value: string
}

interface SortControlProps {
    options: SortOption[]
    sortBy: string
    sortOrder: 'asc' | 'desc'
    onSortChange: (field: string, order: 'asc' | 'desc') => void
}

export default function SortControl({ options, sortBy, sortOrder, onSortChange }: SortControlProps) {
    const { t, locale } = useLanguage()

    return (
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <span style={{ fontSize: '0.875rem', fontWeight: '600', color: 'var(--text-soft)' }}>{t('sort_by')}:</span>
            <select
                aria-label={t('sort_by')}
                value={sortBy}
                onChange={(e) => onSortChange(e.target.value, sortOrder)}
                className="input"
                style={{
                    padding: locale === 'ar' ? '0.375rem 0.75rem 0.375rem 2rem' : '0.375rem 2rem 0.375rem 0.75rem',
                    borderRadius: '0.375rem',
                    fontSize: '0.875rem',
                    backgroundColor: 'var(--surface)',
                    cursor: 'pointer',
                    height: 'auto',
                    minWidth: '140px',
                    textAlign: locale === 'ar' ? 'right' : 'left'
                }}
            >
                {options.map(opt => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
            </select>
            <button
                onClick={() => onSortChange(sortBy, sortOrder === 'asc' ? 'desc' : 'asc')}
                title={sortOrder === 'asc' ? t('ascending') : t('descending')}
                style={{
                    padding: '0.375rem 0.5rem',
                    borderRadius: '0.375rem',
                    border: '1px solid var(--border-firm)',
                    background: 'var(--surface)',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    color: 'var(--text-muted)'
                }}
            >
                {sortOrder === 'asc' ? '↑' : '↓'}
            </button>
        </div>
    )
}

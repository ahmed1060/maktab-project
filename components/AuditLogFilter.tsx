'use client'
import { useEffect, useState, useCallback } from 'react'
import { useLanguage } from '@/context/LanguageContext'
import SearchableSelect from './SearchableSelect'
import DateRangePicker from './DateRangePicker'
import { useAdjustOnChange } from '@/lib/useAdjustOnChange'

interface AuditLogFilterProps {
    onFilterChange: (filters: {
        entityType: string;
        action: string;
        startDate: string;
        endDate: string;
        performedById: string;
        entityId: string;
    }) => void
    filters: {
        entityType: string;
        action: string;
        startDate: string;
        endDate: string;
        performedById: string;
        entityId: string;
    }
    totalCount: number
    users: { id: string, firstName: string, lastName: string, role: string }[]
    entityTypes: string[]
    actionGroups: string[]
    specificActions: string[]
}

export default function AuditLogFilter({
    onFilterChange,
    filters,
    totalCount,
    users,
    entityTypes,
    actionGroups,
    specificActions
}: AuditLogFilterProps) {
    const { t, locale } = useLanguage()
    const [isPopupOpen, setIsPopupOpen] = useState(false)
    const [isMobile, setIsMobile] = useState(false)

    // Local states for the popup to implement "Show Results" behavior
    const [localFilters, setLocalFilters] = useState(filters)

    useAdjustOnChange([filters], () => setLocalFilters(filters))

    useEffect(() => {
        const checkMobile = () => setIsMobile(window.innerWidth < 768)
        checkMobile()
        window.addEventListener('resize', checkMobile)
        return () => window.removeEventListener('resize', checkMobile)
    }, [])

    const handleApplyFilters = useCallback(() => {
        onFilterChange(localFilters)
        setIsPopupOpen(false)
    }, [onFilterChange, localFilters])

    const handleStandaloneSearch = (entityId: string) => {
        onFilterChange({ ...filters, entityId })
    }

    const resetFilters = () => {
        const reset = {
            entityType: '',
            action: '',
            startDate: '',
            endDate: '',
            performedById: '',
            entityId: ''
        }
        setLocalFilters(reset)
        onFilterChange(reset)
        setIsPopupOpen(false)
    }

    const activeFilterCount = [
        filters.entityType ? 1 : 0,
        filters.action ? 1 : 0,
        (filters.startDate || filters.endDate) ? 1 : 0,
        filters.performedById ? 1 : 0
    ].reduce((a, b) => a + b, 0)

    return (
        <div style={{
            marginBottom: '1.5rem',
            display: 'flex',
            flexDirection: 'column',
            gap: '1rem',
            position: 'relative'
        }}>
            {/* Unified Toolbar */}
            <div style={{
                display: 'flex',
                gap: '1rem',
                alignItems: 'center',
                flexWrap: 'wrap',
                padding: '0.75rem',
                position: 'relative',
                zIndex: 10
            }}>
                {/* Glass Background */}
                <div style={{
                    position: 'absolute',
                    inset: 0,
                    background: 'var(--veil-40)',
                    backdropFilter: 'blur(8px)',
                    borderRadius: '1.5rem',
                    border: '1px solid var(--veil-50)',
                    zIndex: -1,
                    pointerEvents: 'none'
                }} />

                {/* Entity ID Standalone Search */}
                <div style={{ flex: '1 1 14rem', minWidth: 0, position: 'relative' }}>
                    <div style={{ position: 'absolute', [locale === 'ar' ? 'right' : 'left']: '1.25rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-faint)', pointerEvents: 'none' }}>
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                            <circle cx="11" cy="11" r="8"></circle>
                            <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
                        </svg>
                    </div>
                    <input
                        type="text"
                        value={filters.entityId}
                        onChange={(e) => handleStandaloneSearch(e.target.value)}
                        placeholder={(t as any)('entity_id') + '...'}
                        className="input"
                        style={{
                            width: '100%',
                            padding: locale === 'ar' ? '0.625rem 3.5rem 0.625rem 1.25rem' : '0.625rem 1.25rem 0.625rem 3.5rem',
                            borderRadius: '1.25rem',
                            fontSize: '0.95rem',
                            border: '1px solid var(--border)',
                            textAlign: locale === 'ar' ? 'right' : 'left',
                            background: 'var(--surface)',
                            height: '48px'
                        }}
                    />
                </div>

                {/* Filters Trigger */}
                <div style={{ position: 'relative' }}>
                    <button
                        onClick={() => setIsPopupOpen(!isPopupOpen)}
                        style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '0.75rem',
                            padding: '0 1.5rem',
                            borderRadius: '1.25rem',
                            background: activeFilterCount > 0 ? 'var(--info-bg-subtle)' : 'var(--surface)',
                            border: `2px solid ${activeFilterCount > 0 ? 'var(--info-solid)' : 'var(--border)'}`,
                            color: activeFilterCount > 0 ? 'var(--info-solid-hover)' : 'var(--text-muted)',
                            fontWeight: '700',
                            fontSize: '0.95rem',
                            cursor: 'pointer',
                            transition: 'all 0.2s ease',
                            height: '48px'
                        }}
                    >
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                            <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"></polygon>
                        </svg>
                        {t('filters')}
                        {activeFilterCount > 0 && (
                            <span style={{
                                position: 'absolute',
                                top: '-4px',
                                [locale === 'ar' ? 'left' : 'right']: '-4px',
                                background: 'var(--info-solid)',
                                color: 'var(--text-on-accent)',
                                width: '20px',
                                height: '20px',
                                borderRadius: '50%',
                                fontSize: '0.7rem',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                border: '2px solid white'
                            }}>
                                {activeFilterCount}
                            </span>
                        )}
                    </button>

                    {/* Filters Popup */}
                    {isPopupOpen && (
                        <>
                            <div
                                onClick={() => setIsPopupOpen(false)}
                                style={{
                                    position: 'fixed',
                                    inset: 0,
                                    zIndex: 999,
                                    backgroundColor: isMobile ? 'var(--scrim)' : 'transparent',
                                    backdropFilter: isMobile ? 'blur(4px)' : 'none'
                                }}
                            />
                            <div style={{
                                position: isMobile ? 'fixed' : 'absolute',
                                top: isMobile ? '50%' : 'calc(100% + 0.75rem)',
                                [locale === 'ar' ? 'left' : 'right']: isMobile ? '50%' : '0',
                                transform: isMobile ? 'translate(-50%, -50%)' : 'none',
                                width: isMobile ? 'min(calc(100vw - 3rem), 400px)' : '320px',
                                backgroundColor: 'var(--surface)',
                                borderRadius: '1.25rem',
                                padding: '1.5rem',
                                boxShadow: '0 20px 25px -5px var(--shadow-weak)',
                                border: '1px solid var(--border)',
                                zIndex: 1000,
                                display: 'flex',
                                flexDirection: 'column',
                                gap: '1.25rem',
                                animation: 'popIn 0.2s ease-out'
                            }}>
                                <style>{`@keyframes popIn { from { opacity: 0; transform: ${isMobile ? 'translate(-50%, -45%)' : 'translateY(-8px)'}; } to { opacity: 1; transform: ${isMobile ? 'translate(-50%, -50%)' : 'translateY(0)'}; } }`}</style>

                                {/* Performed By */}
                                <div>
                                    <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: '700', fontSize: '0.875rem' }}>{t('performed_by')}</label>
                                    <SearchableSelect
                                        options={users.map(u => ({
                                            label: `${u.firstName} ${u.lastName}`,
                                            value: u.id,
                                            subLabel: u.role
                                        }))}
                                        value={localFilters.performedById}
                                        onChange={(val) => setLocalFilters(f => ({ ...f, performedById: val }))}
                                        placeholder={t('all_users')}
                                    />
                                </div>

                                {/* Entity Type */}
                                <div>
                                    <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: '700', fontSize: '0.875rem' }}>{t('entity')}</label>
                                    <div style={{ position: 'relative' }}>
                                        <select
                                            value={localFilters.entityType}
                                            onChange={(e) => setLocalFilters(f => ({ ...f, entityType: e.target.value }))}
                                            className="input"
                                            style={{
                                                width: '100%',
                                                padding: '0 1rem',
                                                borderRadius: '1.25rem',
                                                height: '48px',
                                                appearance: 'none',
                                                textAlign: locale === 'ar' ? 'right' : 'left',
                                                background: 'var(--surface)'
                                            }}
                                        >
                                            <option value="">{t('all_entities')}</option>
                                            {entityTypes.map(et => (
                                                <option key={et} value={et}>{(t as any)(`audit_entity_${et}`)}</option>
                                            ))}
                                        </select>
                                    </div>
                                </div>

                                {/* Action */}
                                <div>
                                    <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: '700', fontSize: '0.875rem' }}>{t('action')}</label>
                                    <div style={{ position: 'relative' }}>
                                        <select
                                            value={localFilters.action}
                                            onChange={(e) => setLocalFilters(f => ({ ...f, action: e.target.value }))}
                                            className="input"
                                            style={{
                                                width: '100%',
                                                padding: '0 1rem',
                                                borderRadius: '1.25rem',
                                                height: '48px',
                                                appearance: 'none',
                                                textAlign: locale === 'ar' ? 'right' : 'left',
                                                background: 'var(--surface)'
                                            }}
                                        >
                                            <option value="">{t('all_actions')}</option>
                                            <optgroup label={locale === 'ar' ? 'الفئات' : 'Groups'}>
                                                {actionGroups.map(g => (
                                                    <option key={g} value={g}>{(t as any)(`audit_action_${g}`)}</option>
                                                ))}
                                            </optgroup>
                                            <optgroup label={locale === 'ar' ? 'إجراءات' : 'Actions'}>
                                                {specificActions.map(a => (
                                                    <option key={a} value={a}>{(t as any)(`audit_action_${a}`)}</option>
                                                ))}
                                            </optgroup>
                                        </select>
                                    </div>
                                </div>

                                {/* Date Range */}
                                <DateRangePicker
                                    dateFrom={localFilters.startDate}
                                    dateTo={localFilters.endDate}
                                    onChange={(from, to) => setLocalFilters(f => ({ ...f, startDate: from, endDate: to }))}
                                />

                                <div style={{ display: 'flex', gap: '0.75rem', marginTop: '0.75rem' }}>
                                    <button
                                        onClick={resetFilters}
                                        style={{
                                            flex: 1, height: '48px', borderRadius: '1.25rem', border: '1px solid var(--border)',
                                            background: 'var(--surface)', fontWeight: '700', cursor: 'pointer', fontSize: '0.875rem', color: 'var(--text-soft)'
                                        }}
                                    >
                                        {t('reset')}
                                    </button>
                                    <button
                                        onClick={handleApplyFilters}
                                        style={{
                                            flex: 1, height: '48px', borderRadius: '1.25rem', border: 'none',
                                            background: 'linear-gradient(135deg, var(--brand-primary) 0%, var(--accent-solid) 100%)',
                                            color: 'var(--text-on-accent)', fontWeight: '700', cursor: 'pointer', fontSize: '0.875rem'
                                        }}
                                    >
                                        {t('show_results')}
                                    </button>
                                </div>
                            </div>
                        </>
                    )}
                </div>

                {/* Total Count */}
                <div style={{
                    height: '48px',
                    padding: '0 1.25rem',
                    background: 'var(--text-strong)',
                    borderRadius: '1.25rem',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.75rem',
                    color: 'var(--text-on-accent)'
                }}>
                    <span style={{ fontSize: '0.7rem', fontWeight: '800', opacity: 0.5, textTransform: 'uppercase' }}>{t('total_label')}</span>
                    <span style={{ fontSize: '1.25rem', fontWeight: '900' }}>{totalCount}</span>
                </div>
            </div>
        </div>
    )
}

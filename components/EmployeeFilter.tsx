'use client'
import { useEffect, useState } from 'react'
import { useLanguage } from '@/context/LanguageContext'
import SearchableSelect from './SearchableSelect'
import DateRangePicker from './DateRangePicker'

interface SortOption {
    label: string
    value: string
}

interface EmployeeFilterProps {
    onFilterChange: (filters: { employeeId: string; dateFrom: string; dateTo: string; status: string; search: string }) => void
    selectedEmployeeId: string
    dateFrom: string
    dateTo: string
    totalCount: number
    totalCost?: number
    selectedStatus?: string
    searchQuery?: string
    isEmployee?: boolean
    // New Props for Reorganization
    sortBy?: string
    sortOrder?: 'asc' | 'desc'
    onSortChange?: (field: string, order: 'asc' | 'desc') => void
    sortOptions?: SortOption[]
    primaryAction?: React.ReactNode
}

// Define interface for Employee data locally since it's just for display
interface EmployeeType {
    id: string
    firstName: string
    lastName: string
    role: string
}

export default function EmployeeFilter({
    onFilterChange,
    selectedEmployeeId,
    dateFrom,
    dateTo,
    totalCount,
    totalCost,
    selectedStatus = '',
    searchQuery = '',
    isEmployee = false,
    sortBy,
    sortOrder,
    onSortChange,
    sortOptions,
    primaryAction
}: EmployeeFilterProps) {
    const [employees, setEmployees] = useState<EmployeeType[]>([])
    const [loading, setLoading] = useState(true)
    const [isPopupOpen, setIsPopupOpen] = useState(false)
    const { t, locale } = useLanguage()

    useEffect(() => {
        if (!isEmployee) {
            fetch('/api/users')
                .then(res => res.json())
                .then(data => {
                    const filteredData = data.filter((emp: EmployeeType) => emp.role !== 'ADMIN' && emp.role !== 'SUPER_ADMIN')
                    const sortedData = filteredData.sort((a: EmployeeType, b: EmployeeType) => {
                        const rolePriority: { [key: string]: number } = {
                            'EMPLOYEE': 1,
                            'TEAM_LEADER': 2,
                            'ADMIN': 3,
                            'SUPER_ADMIN': 4
                        }
                        const priorityA = rolePriority[a.role] || 99
                        const priorityB = rolePriority[b.role] || 99
                        return priorityA !== priorityB ? priorityA - priorityB : a.firstName.localeCompare(b.firstName)
                    })
                    setEmployees(sortedData)
                    setLoading(false)
                })
                .catch(err => {
                    console.error('Failed to load employees:', err)
                    setLoading(false)
                })
        } else {
            setLoading(false)
        }
    }, [isEmployee])

    const handleEmployeeChange = (employeeId: string) => {
        onFilterChange({ employeeId, dateFrom, dateTo, status: selectedStatus, search: searchQuery })
    }

    const handleStatusChange = (status: string) => {
        onFilterChange({ employeeId: selectedEmployeeId, dateFrom, dateTo, status, search: searchQuery })
    }

    const handleSearchChange = (search: string) => {
        onFilterChange({ employeeId: selectedEmployeeId, dateFrom, dateTo, status: selectedStatus, search })
    }

    const resetFilters = () => {
        onFilterChange({ employeeId: '', dateFrom: '', dateTo: '', status: '', search: searchQuery })
    }

    const activeFilterCount = [
        selectedEmployeeId ? 1 : 0,
        selectedStatus ? 1 : 0,
        dateFrom || dateTo ? 1 : 0
    ].reduce((a, b) => a + b, 0)

    if (loading) {
        return <div style={{ fontSize: '0.875rem', color: '#64748b', marginBottom: '1.5rem' }}>{t('loading_filters')}</div>
    }

    return (
        <div style={{
            marginBottom: '2rem',
            display: 'flex',
            flexDirection: 'column',
            gap: '1rem',
            position: 'relative'
        }}>
            {/* Unified Toolbar Row */}
            <div style={{
                display: 'flex',
                gap: '1rem',
                alignItems: 'center',
                flexWrap: 'wrap',
                padding: '0.75rem',
                position: 'relative',
                zIndex: 10
            }}>
                {/* Background Layer - Isolated from children to prevent rendering artifacts */}
                <div style={{
                    position: 'absolute',
                    inset: 0,
                    background: 'rgba(255, 255, 255, 0.4)',
                    backdropFilter: 'blur(8px)',
                    borderRadius: '1.5rem',
                    border: '1px solid rgba(255, 255, 255, 0.5)',
                    zIndex: -1,
                    pointerEvents: 'none'
                }} />
                {/* Search - Flexible width */}
                <div style={{ flex: 1, minWidth: '300px', position: 'relative' }}>
                    <div style={{ position: 'absolute', [locale === 'ar' ? 'right' : 'left']: '1.25rem', top: '50%', transform: 'translateY(-50%)', color: '#94a3b8', pointerEvents: 'none' }}>
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                            <circle cx="11" cy="11" r="8"></circle>
                            <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
                        </svg>
                    </div>
                    <input
                        type="text"
                        value={searchQuery}
                        onChange={(e) => handleSearchChange(e.target.value)}
                        placeholder={t('search_placeholder')}
                        className="input"
                        style={{
                            width: '100%',
                            padding: locale === 'ar' ? '0.625rem 3.5rem 0.625rem 1.25rem' : '0.625rem 1.25rem 0.625rem 3.5rem',
                            borderRadius: '1.25rem',
                            fontSize: '0.95rem',
                            border: '1px solid #e2e8f0',
                            textAlign: locale === 'ar' ? 'right' : 'left',
                            background: 'white',
                            height: '48px',
                            minHeight: '48px'
                        }}
                    />
                </div>

                {/* Filters Trigger */}
                {!isEmployee && (
                    <div style={{ position: 'relative' }}>
                        <button
                            onClick={() => setIsPopupOpen(!isPopupOpen)}
                            style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: '0.75rem',
                                padding: '0 1.5rem',
                                borderRadius: '1.25rem',
                                background: activeFilterCount > 0 ? '#eff6ff' : 'white',
                                border: `2px solid ${activeFilterCount > 0 ? '#3b82f6' : '#e2e8f0'}`,
                                color: activeFilterCount > 0 ? '#2563eb' : '#475569',
                                fontWeight: '700',
                                fontSize: '0.95rem',
                                cursor: 'pointer',
                                transition: 'all 0.2s ease',
                                position: 'relative',
                                height: '48px'
                            }}
                        >
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"></polygon>
                            </svg>
                            {t('filters_button' as any) || 'Filters'}
                            {activeFilterCount > 0 && (
                                <span style={{
                                    position: 'absolute',
                                    top: '-4px',
                                    [locale === 'ar' ? 'left' : 'right']: '-4px',
                                    background: '#3b82f6',
                                    color: 'white',
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

                        {/* Popup / Modal */}
                        {isPopupOpen && (
                            <>
                                <div onClick={() => setIsPopupOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 999 }} />
                                <div style={{
                                    position: 'absolute',
                                    top: 'calc(100% + 0.75rem)',
                                    [locale === 'ar' ? 'left' : 'right']: 0,
                                    width: '320px',
                                    backgroundColor: '#ffffff',
                                    borderRadius: '1.25rem',
                                    padding: '1.5rem',
                                    boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.15), 0 10px 10px -5px rgba(0, 0, 0, 0.04)',
                                    border: '1px solid #e2e8f0',
                                    zIndex: 1000,
                                    display: 'flex',
                                    flexDirection: 'column',
                                    gap: '1.25rem',
                                    animation: 'popIn 0.2s ease-out',
                                    opacity: 1
                                }}>
                                    <style>{`@keyframes popIn { from { opacity: 0; transform: translateY(-8px); } to { opacity: 1; transform: translateY(0); } }`}</style>

                                    {/* Sort controls at the top of filter popup */}
                                    {onSortChange && sortOptions && (
                                        <div style={{ paddingBottom: '1.25rem', borderBottom: '1px solid #f1f5f9' }}>
                                            <label style={{ display: 'block', marginBottom: '0.75rem', fontWeight: '800', fontSize: '0.75rem', textTransform: 'uppercase', color: '#64748b', letterSpacing: '0.05em' }}>{t('sort_by')}</label>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                                <select
                                                    value={sortBy}
                                                    onChange={(e) => onSortChange(e.target.value, sortOrder || 'asc')}
                                                    className="input"
                                                    style={{
                                                        flex: 1,
                                                        padding: locale === 'ar' ? '0 0.75rem 0 2rem' : '0 2rem 0 0.75rem',
                                                        borderRadius: '0.75rem',
                                                        fontSize: '0.875rem',
                                                        backgroundColor: '#f8fafc',
                                                        border: '1px solid #e2e8f0',
                                                        cursor: 'pointer',
                                                        height: '42px',
                                                        textAlign: locale === 'ar' ? 'right' : 'left'
                                                    }}
                                                >
                                                    {sortOptions.map(opt => (
                                                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                                                    ))}
                                                </select>
                                                <button
                                                    onClick={() => onSortChange(sortBy || '', sortOrder === 'asc' ? 'desc' : 'asc')}
                                                    style={{
                                                        height: '42px',
                                                        width: '42px',
                                                        borderRadius: '0.75rem',
                                                        border: '1px solid #e2e8f0',
                                                        background: 'white',
                                                        cursor: 'pointer',
                                                        display: 'flex',
                                                        alignItems: 'center',
                                                        justifyContent: 'center',
                                                        color: '#475569'
                                                    }}
                                                >
                                                    {sortOrder === 'asc' ? '↑' : '↓'}
                                                </button>
                                            </div>
                                        </div>
                                    )}

                                    <div>
                                        <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: '700', fontSize: '0.875rem' }}>{t('filter_by_employee')}</label>
                                        <SearchableSelect
                                            options={employees.map(emp => ({ label: `${emp.firstName} ${emp.lastName}`, value: emp.id, subLabel: emp.role }))}
                                            value={selectedEmployeeId}
                                            onChange={handleEmployeeChange}
                                            placeholder={t('placeholder_all_employees')}
                                        />
                                    </div>
                                    <div>
                                        <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: '700', fontSize: '0.875rem' }}>{t('filter_by_status')}</label>
                                        <select
                                            value={selectedStatus}
                                            onChange={(e) => handleStatusChange(e.target.value)}
                                            className="input"
                                            style={{ width: '100%', padding: '0.5rem', borderRadius: '0.75rem', background: '#f8fafc', border: '1px solid #e2e8f0', height: '42px' }}
                                        >
                                            <option value="">{t('placeholder_all_statuses')}</option>
                                            <option value="COMPLETED">{t('status_completed')}</option>
                                            <option value="APPROVED">{t('status_approved')}</option>
                                            <option value="REJECTED">{t('status_rejected')}</option>
                                            <option value="PENDING_CONFIRMATION">{t('status_pending_approval')}</option>
                                            <option value="IN_PROGRESS">{t('status_pending')}</option>
                                            <option value="PENDING">{t('status_pending')}</option>
                                        </select>
                                    </div>
                                    <div>
                                        <DateRangePicker
                                            dateFrom={dateFrom}
                                            dateTo={dateTo}
                                            onChange={(from, to) => onFilterChange({ employeeId: selectedEmployeeId, dateFrom: from, dateTo: to, status: selectedStatus, search: searchQuery })}
                                        />
                                    </div>
                                    <div style={{ display: 'flex', gap: '0.75rem', marginTop: '0.5rem' }}>
                                        <button onClick={resetFilters} style={{ flex: 1, padding: '0.625rem', borderRadius: '0.75rem', border: '1px solid #e2e8f0', background: 'white', fontWeight: '700', cursor: 'pointer' }}>{t('reset_filters' as any) || 'Reset'}</button>
                                        <button onClick={() => setIsPopupOpen(false)} style={{ flex: 1, padding: '0.625rem', borderRadius: '0.75rem', border: 'none', background: '#2563eb', color: 'white', fontWeight: '700', cursor: 'pointer' }}>{t('show_results' as any) || 'Apply'}</button>
                                    </div>
                                </div>
                            </>
                        )}
                    </div>
                )}


                {/* Statistics Box */}
                <div style={{
                    height: '48px',
                    padding: '0 1.25rem',
                    background: '#0f172a',
                    borderRadius: '1.25rem',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.75rem',
                    color: 'white'
                }}>
                    <span style={{ fontSize: '0.7rem', fontWeight: '800', opacity: 0.5, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{t('total_label')}</span>
                    <span style={{ fontSize: '1.25rem', fontWeight: '900' }}>{totalCount}</span>
                </div>

                {/* Primary Action Integration */}
                {primaryAction && (
                    <div style={{ marginLeft: locale === 'ar' ? '0' : 'auto', marginRight: locale === 'ar' ? 'auto' : '0' }}>
                        {primaryAction}
                    </div>
                )}
            </div>

            {/* Total Cost Badge - Below if present */}
            {totalCost !== undefined && (
                <div style={{ display: 'flex', justifyContent: locale === 'ar' ? 'flex-start' : 'flex-end', marginTop: '-0.5rem' }}>
                    <div style={{
                        background: 'linear-gradient(135deg, #fff7ed 0%, #ffedd5 100%)',
                        color: '#9a3412',
                        padding: '0.5rem 1.25rem',
                        borderRadius: '1rem',
                        border: '1px solid #fed7aa',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.5rem',
                        boxShadow: '0 2px 4px rgba(251, 146, 60, 0.05)'
                    }}>
                        <div style={{ background: '#fb923c', color: 'white', padding: '0.25rem', borderRadius: '0.5rem', display: 'flex' }}>
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round">
                                <line x1="12" y1="1" x2="12" y2="23"></line>
                                <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"></path>
                            </svg>
                        </div>
                        <span style={{ fontSize: '0.7rem', fontWeight: '800', opacity: 0.8, textTransform: 'uppercase' }}>{t('total_cost')}:</span>
                        <span style={{ fontSize: '1.125rem', fontWeight: '900' }}>
                            {totalCost.toLocaleString(undefined, { minimumFractionDigits: 2 })} <span style={{ fontSize: '0.75rem' }}>EGP</span>
                        </span>
                    </div>
                </div>
            )}
        </div>
    )
}

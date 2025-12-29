'use client'
import { useEffect, useState } from 'react'
import { useLanguage } from '@/context/LanguageContext'
import SearchableSelect from './SearchableSelect'
import DateRangePicker from './DateRangePicker'

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
    isEmployee = false
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
                    const filteredData = data.filter((emp: EmployeeType) => emp.role !== 'ADMIN')
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
        return <div style={{ fontSize: '0.875rem', color: '#64748b' }}>{t('loading_filters')}</div>
    }

    return (
        <div style={{
            marginBottom: '2rem',
            display: 'flex',
            flexDirection: 'column',
            gap: '1rem'
        }}>
            {/* Top row: Standalone Search and Filter Button */}
            <div style={{ display: 'flex', gap: '1rem', alignItems: 'center', position: 'relative' }}>
                <div style={{ flex: 1, position: 'relative' }}>
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
                            fontSize: '1rem',
                            border: '1px solid #e2e8f0',
                            transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
                            boxShadow: '0 2px 4px rgba(0,0,0,0.02)',
                            textAlign: locale === 'ar' ? 'right' : 'left',
                            background: 'white',
                            height: 'auto',
                            minHeight: '42px'
                        }}
                    />
                </div>

                {!isEmployee && (
                    <div style={{ position: 'relative' }}>
                        <button
                            onClick={() => setIsPopupOpen(!isPopupOpen)}
                            style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: '0.75rem',
                                padding: '0.75rem 1.5rem',
                                borderRadius: '1.25rem',
                                background: activeFilterCount > 0 ? '#eff6ff' : 'white',
                                border: `2px solid ${activeFilterCount > 0 ? '#3b82f6' : '#e2e8f0'}`,
                                color: activeFilterCount > 0 ? '#2563eb' : '#475569',
                                fontWeight: '700',
                                fontSize: '0.95rem',
                                cursor: 'pointer',
                                transition: 'all 0.2s ease',
                                position: 'relative',
                                boxShadow: activeFilterCount > 0 ? '0 4px 6px -1px rgba(59, 130, 246, 0.1)' : '0 2px 4px rgba(0,0,0,0.02)',
                                height: 'auto',
                                minHeight: '42px'
                            }}
                        >
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"></polygon>
                            </svg>
                            {t('filters_button' as any) || 'Filters'}
                            {activeFilterCount > 0 && (
                                <span style={{
                                    position: 'absolute',
                                    top: '-8px',
                                    [locale === 'ar' ? 'left' : 'right']: '-8px',
                                    background: '#3b82f6',
                                    color: 'white',
                                    width: '22px',
                                    height: '22px',
                                    borderRadius: '50%',
                                    fontSize: '0.75rem',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    border: '2px solid white',
                                    boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
                                }}>
                                    {activeFilterCount}
                                </span>
                            )}
                        </button>

                        {/* Popup / Modal */}
                        {isPopupOpen && (
                            <>
                                {/* Backdrop for closing */}
                                <div
                                    onClick={() => setIsPopupOpen(false)}
                                    style={{
                                        position: 'fixed',
                                        top: 0,
                                        left: 0,
                                        right: 0,
                                        bottom: 0,
                                        zIndex: 999
                                    }}
                                />
                                {/* Modal Content */}
                                <div style={{
                                    position: 'absolute',
                                    top: 'calc(100% + 0.75rem)',
                                    [locale === 'ar' ? 'right' : 'left']: 'auto',
                                    [locale === 'ar' ? 'left' : 'right']: 0,
                                    width: '380px',
                                    background: 'white',
                                    borderRadius: '1.5rem',
                                    padding: '1.75rem',
                                    boxShadow: '0 25px 50px -12px rgba(15, 23, 42, 0.15)',
                                    border: '1px solid #f1f5f9',
                                    zIndex: 1000,
                                    display: 'flex',
                                    flexDirection: 'column',
                                    gap: '1.5rem',
                                    animation: 'popIn 0.2s cubic-bezier(0.16, 1, 0.3, 1)'
                                }}>
                                    <style>{`
                                        @keyframes popIn {
                                            from { opacity: 0; transform: translateY(-10px) scale(0.95); }
                                            to { opacity: 1; transform: translateY(0) scale(1); }
                                        }
                                    `}</style>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                        <h3 style={{ margin: 0, fontSize: '1.125rem', fontWeight: '800', color: '#0f172a' }}>
                                            {t('active_filters' as any) || 'Filter Options'}
                                        </h3>
                                        <button
                                            onClick={() => setIsPopupOpen(false)}
                                            style={{ background: '#f8fafc', border: 'none', cursor: 'pointer', color: '#94a3b8', padding: '0.5rem', borderRadius: '0.75rem', display: 'flex', alignItems: 'center' }}
                                        >
                                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                                                <line x1="18" y1="6" x2="6" y2="18"></line>
                                                <line x1="6" y1="6" x2="18" y2="18"></line>
                                            </svg>
                                        </button>
                                    </div>

                                    <div>
                                        <label style={{ display: 'block', marginBottom: '0.625rem', fontWeight: '700', fontSize: '0.875rem', color: '#475569' }}>
                                            {t('filter_by_employee')}
                                        </label>
                                        <SearchableSelect
                                            options={employees.map(emp => ({
                                                label: `${emp.firstName} ${emp.lastName}`,
                                                value: emp.id,
                                                subLabel: emp.role
                                            }))}
                                            value={selectedEmployeeId}
                                            onChange={handleEmployeeChange}
                                            placeholder={t('placeholder_all_employees')}
                                        />
                                    </div>

                                    <div>
                                        <label style={{ display: 'block', marginBottom: '0.625rem', fontWeight: '700', fontSize: '0.875rem', color: '#475569' }}>
                                            {t('filter_by_status')}
                                        </label>
                                        <select
                                            value={selectedStatus}
                                            onChange={(e) => handleStatusChange(e.target.value)}
                                            className="input"
                                            style={{
                                                width: '100%',
                                                padding: '0.625rem 1rem',
                                                borderRadius: '1rem',
                                                fontSize: '0.95rem',
                                                background: '#f8fafc',
                                                border: '1px solid #e2e8f0',
                                                textAlign: locale === 'ar' ? 'right' : 'left',
                                                cursor: 'pointer',
                                                height: 'auto',
                                                minHeight: '42px'
                                            }}
                                        >
                                            <option value="">{t('placeholder_all_statuses')}</option>
                                            <option value="COMPLETED">{t('status_completed')}</option>
                                            <option value="APPROVED">{t('status_approved')}</option>
                                            <option value="REJECTED">{t('status_rejected')}</option>
                                            <option value="PENDING_CONFIRMATION">{t('status_pending_approval')}</option>
                                            <option value="IN_PROGRESS">{t('status_pending')}</option>
                                        </select>
                                    </div>

                                    <div>
                                        <label style={{ display: 'block', marginBottom: '0.625rem', fontWeight: '700', fontSize: '0.875rem', color: '#475569' }}>
                                            {t('date_range')}
                                        </label>
                                        <DateRangePicker
                                            dateFrom={dateFrom}
                                            dateTo={dateTo}
                                            onChange={(from, to) => onFilterChange({ employeeId: selectedEmployeeId, dateFrom: from, dateTo: to, status: selectedStatus, search: searchQuery })}
                                        />
                                    </div>

                                    <div style={{ display: 'flex', gap: '1rem', marginTop: '0.5rem', borderTop: '1px solid #f1f5f9', paddingTop: '1.25rem' }}>
                                        <button
                                            onClick={resetFilters}
                                            style={{
                                                flex: 1,
                                                padding: '0.75rem',
                                                borderRadius: '1rem',
                                                border: '1px solid #e2e8f0',
                                                background: 'white',
                                                color: '#64748b',
                                                fontWeight: '700',
                                                fontSize: '0.875rem',
                                                cursor: 'pointer',
                                                transition: 'all 0.2s ease',
                                                height: 'auto',
                                                minHeight: '42px'
                                            }}
                                        >
                                            {t('reset_filters' as any) || 'Reset'}
                                        </button>
                                        <button
                                            onClick={() => setIsPopupOpen(false)}
                                            style={{
                                                flex: 2,
                                                padding: '0.75rem',
                                                borderRadius: '1rem',
                                                border: 'none',
                                                background: '#2563eb',
                                                color: 'white',
                                                fontWeight: '700',
                                                fontSize: '0.875rem',
                                                cursor: 'pointer',
                                                boxShadow: '0 4px 12px rgba(37, 99, 235, 0.2)',
                                                transition: 'all 0.2s ease',
                                                height: 'auto',
                                                minHeight: '42px'
                                            }}
                                        >
                                            {t('show_results' as any) || 'Show Results'}
                                        </button>
                                    </div>
                                </div>
                            </>
                        )}
                    </div>
                )}

                {/* Totals Tooltip Style */}
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                    <div style={{
                        height: '48px',
                        padding: '0 1.5rem',
                        background: '#0f172a',
                        borderRadius: '1.25rem',
                        display: 'flex',
                        flexDirection: 'column',
                        justifyContent: 'center',
                        color: 'white',
                        minWidth: '100px',
                        boxShadow: '0 4px 6px -1px rgba(15, 23, 42, 0.2)'
                    }}>
                        <span style={{ fontSize: '0.65rem', fontWeight: '800', opacity: 0.6, letterSpacing: '0.05em' }}>{t('total_label')}</span>
                        <span style={{ fontSize: '1.125rem', fontWeight: '800', marginTop: '-2px' }}>{totalCount}</span>
                    </div>
                </div>
            </div>

            {/* Cost display if available (Premium Badge) */}
            {totalCost !== undefined && (
                <div style={{ display: 'flex', justifyContent: locale === 'ar' ? 'flex-start' : 'flex-end' }}>
                    <div style={{
                        background: 'linear-gradient(135deg, #fff7ed 0%, #ffedd5 100%)',
                        color: '#9a3412',
                        padding: '0.75rem 1.5rem',
                        borderRadius: '1.25rem',
                        border: '1px solid #fed7aa',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.75rem',
                        boxShadow: '0 2px 4px rgba(251, 146, 60, 0.05)'
                    }}>
                        <div style={{ background: '#fb923c', color: 'white', padding: '0.35rem', borderRadius: '0.75rem', display: 'flex', alignItems: 'center' }}>
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                                <line x1="12" y1="1" x2="12" y2="23"></line>
                                <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"></path>
                            </svg>
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column' }}>
                            <span style={{ fontSize: '0.65rem', fontWeight: '800', opacity: 0.7, textTransform: 'uppercase' }}>{t('total_cost')}</span>
                            <span style={{ fontSize: '1.25rem', fontWeight: '900', letterSpacing: '-0.02em' }}>
                                {totalCost.toLocaleString(undefined, { minimumFractionDigits: 2 })} <span style={{ fontSize: '0.875rem' }}>EGP</span>
                            </span>
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}

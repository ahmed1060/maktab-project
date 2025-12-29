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
    const { t, locale } = useLanguage()

    useEffect(() => {
        fetch('/api/users')
            .then(res => res.json())
            .then(data => {
                // Filter out ADMIN role
                const filteredData = data.filter((emp: EmployeeType) => emp.role !== 'ADMIN')

                // Sort by role: EMPLOYEE -> TEAM_LEADER -> SUPER_ADMIN
                const sortedData = filteredData.sort((a: EmployeeType, b: EmployeeType) => {
                    const rolePriority: { [key: string]: number } = {
                        'EMPLOYEE': 1,
                        'TEAM_LEADER': 2,
                        'ADMIN': 3,
                        'SUPER_ADMIN': 4
                    }
                    const priorityA = rolePriority[a.role] || 99
                    const priorityB = rolePriority[b.role] || 99

                    if (priorityA !== priorityB) {
                        return priorityA - priorityB
                    }
                    // Secondary sort by name if same role
                    return a.firstName.localeCompare(b.firstName)
                })
                setEmployees(sortedData)
                setLoading(false)
            })
            .catch(err => {
                console.error('Failed to load employees:', err)
                setLoading(false)
            })
    }, [])

    const handleEmployeeChange = (employeeId: string) => {
        onFilterChange({ employeeId, dateFrom, dateTo, status: selectedStatus, search: searchQuery })
    }

    const handleStatusChange = (status: string) => {
        onFilterChange({ employeeId: selectedEmployeeId, dateFrom, dateTo, status, search: searchQuery })
    }

    const handleSearchChange = (search: string) => {
        onFilterChange({ employeeId: selectedEmployeeId, dateFrom, dateTo, status: selectedStatus, search })
    }

    if (loading) {
        return <div style={{ fontSize: '0.875rem', color: '#64748b' }}>{t('loading_filters')}</div>
    }

    return (
        <div style={{
            marginBottom: '2rem',
            background: 'white',
            padding: '1.5rem',
            borderRadius: '1rem',
            boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
            display: 'flex',
            flexDirection: 'column',
            gap: '1.5rem'
        }}>
            {/* Top row: Search and Totals */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '2rem', flexWrap: 'wrap' }}>
                <div style={{ flex: 1, minWidth: '300px' }}>
                    <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: '600', fontSize: '0.875rem', color: '#475569' }}>
                        {t('search_label' as any) || 'Search by Title'}
                    </label>
                    <div style={{ position: 'relative' }}>
                        <div style={{ position: 'absolute', [locale === 'ar' ? 'right' : 'left']: '1rem', top: '50%', transform: 'translateY(-50%)', color: '#94a3b8' }}>
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <circle cx="11" cy="11" r="8"></circle>
                                <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
                            </svg>
                        </div>
                        <input
                            type="text"
                            value={searchQuery}
                            onChange={(e) => handleSearchChange(e.target.value)}
                            placeholder={t('search_placeholder' as any) || 'Search...'}
                            className="input"
                            style={{
                                width: '100%',
                                padding: locale === 'ar' ? '0.75rem 3rem 0.75rem 1rem' : '0.75rem 1rem 0.75rem 3rem',
                                borderRadius: '0.75rem',
                                fontSize: '0.95rem',
                                textAlign: locale === 'ar' ? 'right' : 'left'
                            }}
                        />
                    </div>
                </div>

                <div style={{ display: 'flex', gap: '1rem' }}>
                    <div style={{
                        background: '#eff6ff',
                        color: '#2563eb',
                        padding: '0.75rem 1.25rem',
                        borderRadius: '0.75rem',
                        textAlign: 'center',
                        minWidth: '100px',
                        border: '1px solid #dbeafe'
                    }}>
                        <div style={{ fontSize: '0.75rem', fontWeight: '600', marginBottom: '0.25rem', opacity: 0.8 }}>
                            {t('total_label')}
                        </div>
                        <div style={{ fontSize: '1.5rem', fontWeight: 'bold' }}>
                            {totalCount}
                        </div>
                    </div>

                    {totalCost !== undefined && (
                        <div style={{
                            background: '#fff7ed',
                            color: '#ea580c',
                            padding: '0.75rem 1.25rem',
                            borderRadius: '0.75rem',
                            textAlign: 'center',
                            minWidth: '130px',
                            border: '1px solid #ffedd5'
                        }}>
                            <div style={{ fontSize: '0.75rem', fontWeight: '600', marginBottom: '0.25rem', opacity: 0.8 }}>
                                {t('total_cost')}
                            </div>
                            <div style={{ fontSize: '1.5rem', fontWeight: 'bold' }}>
                                {totalCost.toLocaleString(undefined, { minimumFractionDigits: 2 })} EGP
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {/* Bottom Row: Detailed Filters (Hidden for Employees) */}
            {!isEmployee && (
                <div style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
                    gap: '1.5rem',
                    borderTop: '1px solid #f1f5f9',
                    paddingTop: '1.5rem'
                }}>
                    <div>
                        <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: '600', fontSize: '0.875rem', color: '#475569' }}>
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
                        <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: '600', fontSize: '0.875rem', color: '#475569' }}>
                            {t('filter_by_status')}
                        </label>
                        <select
                            value={selectedStatus}
                            onChange={(e) => handleStatusChange(e.target.value)}
                            className="input"
                            style={{
                                width: '100%',
                                padding: '0.75rem 1rem',
                                borderRadius: '0.75rem',
                                fontSize: '0.875rem',
                                background: 'white',
                                textAlign: locale === 'ar' ? 'right' : 'left'
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

                    <div style={{ gridColumn: 'span 1', minWidth: '320px' }}>
                        <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: '600', fontSize: '0.875rem', color: '#475569' }}>
                            {t('date_range' as any) || 'Date Range'}
                        </label>
                        <DateRangePicker
                            dateFrom={dateFrom}
                            dateTo={dateTo}
                            onChange={(from, to) => onFilterChange({ employeeId: selectedEmployeeId, dateFrom: from, dateTo: to, status: selectedStatus, search: searchQuery })}
                        />
                    </div>
                </div>
            )}
        </div>
    )
}

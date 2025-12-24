'use client'
import { useEffect, useState } from 'react'
import { useLanguage } from '@/context/LanguageContext'
import SearchableSelect from './SearchableSelect'
import DateRangePicker from './DateRangePicker'

interface EmployeeFilterProps {
    onFilterChange: (filters: { employeeId: string; dateFrom: string; dateTo: string; status: string }) => void
    selectedEmployeeId: string
    dateFrom: string
    dateTo: string
    totalCount: number
    totalCost?: number
    selectedStatus?: string
}

// Define interface for Employee data locally since it's just for display
interface EmployeeType {
    id: string
    firstName: string
    lastName: string
    role: string
}

export default function EmployeeFilter({ onFilterChange, selectedEmployeeId, dateFrom, dateTo, totalCount, totalCost, selectedStatus = '' }: EmployeeFilterProps) {
    const [employees, setEmployees] = useState<EmployeeType[]>([])
    const [loading, setLoading] = useState(true)
    const { t } = useLanguage()

    useEffect(() => {
        fetch('/api/users')
            .then(res => res.json())
            .then(data => {
                // Sort by role: EMPLOYEE -> TEAM_LEADER -> ADMIN -> SUPER_ADMIN
                const sortedData = data.sort((a: EmployeeType, b: EmployeeType) => {
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
        onFilterChange({ employeeId, dateFrom, dateTo, status: selectedStatus })
    }

    const handleStatusChange = (status: string) => {
        onFilterChange({ employeeId: selectedEmployeeId, dateFrom, dateTo, status })
    }

    if (loading) {
        return <div style={{ fontSize: '0.875rem', color: '#64748b' }}>{t('loading_filters')}</div>
    }

    return (
        <div style={{
            marginBottom: '1.5rem',
            display: 'flex',
            gap: '1rem',
            alignItems: 'flex-end',
            justifyContent: 'space-between',
            flexWrap: 'wrap'
        }}>
            <div style={{ display: 'flex', gap: '1rem', alignItems: 'flex-end', flex: 1, flexWrap: 'wrap' }}>
                <div>
                    <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: '600', fontSize: '0.875rem' }}>
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
                    <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: '600', fontSize: '0.875rem' }}>
                        {t('filter_by_status')}
                    </label>
                    <select
                        value={selectedStatus}
                        onChange={(e) => handleStatusChange(e.target.value)}
                        style={{
                            padding: '0.5rem 1rem',
                            borderRadius: '0.5rem',
                            border: '1px solid #cbd5e1',
                            fontSize: '0.875rem',
                            minWidth: '180px',
                            cursor: 'pointer',
                            background: 'white'
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

                <DateRangePicker
                    dateFrom={dateFrom}
                    dateTo={dateTo}
                    onChange={(from, to) => onFilterChange({ employeeId: selectedEmployeeId, dateFrom: from, dateTo: to, status: selectedStatus })}
                />
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                <div style={{
                    background: '#3b82f6',
                    color: 'white',
                    padding: '0.5rem 1rem',
                    borderRadius: '0.5rem',
                    textAlign: 'center',
                    minWidth: '90px'
                }}>
                    <div style={{ fontSize: '0.7rem', fontWeight: '600', marginBottom: '0.15rem', opacity: 0.9 }}>
                        {t('total_label')}
                    </div>
                    <div style={{ fontSize: '1.25rem', fontWeight: 'bold' }}>
                        {totalCount}
                    </div>
                </div>

                {totalCost !== undefined && (
                    <div style={{
                        background: '#f59e0b',
                        color: 'white',
                        padding: '0.5rem 1rem',
                        borderRadius: '0.5rem',
                        textAlign: 'center',
                        minWidth: '120px'
                    }}>
                        <div style={{ fontSize: '0.7rem', fontWeight: '600', marginBottom: '0.15rem', opacity: 0.9 }}>
                            {t('total_cost')}
                        </div>
                        <div style={{ fontSize: '1.25rem', fontWeight: 'bold' }}>
                            {totalCost.toFixed(2)} EGP
                        </div>
                    </div>
                )}
            </div>
        </div>
    )
}

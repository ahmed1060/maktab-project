'use client'
import { useState, useEffect } from 'react'
import Link from 'next/link'
import ObligationListItem from '@/components/ObligationListItem'
import EmployeeFilter from '@/components/EmployeeFilter'
import SortControl from '@/components/SortControl'
import { useLanguage } from '@/context/LanguageContext'

interface ObligationsClientProps {
    obligations: any[]
    role: string
}

export default function ObligationsClient({ obligations, role }: ObligationsClientProps) {
    const { t } = useLanguage()
    const [filters, setFilters] = useState({
        employeeId: '',
        dateFrom: '',
        dateTo: '',
        status: '',
        search: ''
    })

    const filteredObligations = obligations.filter(ob => {
        // Filter by search query (title)
        if (filters.search && !ob.title.toLowerCase().includes(filters.search.toLowerCase())) {
            return false
        }

        // Filter by employee
        if (filters.employeeId && ob.assigneeId !== filters.employeeId) {
            return false
        }

        // Filter by status
        if (filters.status && ob.status !== filters.status) {
            return false
        }

        // Filter by date range (using createdAt)
        if (filters.dateFrom) {
            const obDate = new Date(ob.createdAt)
            const fromDate = new Date(filters.dateFrom)
            if (obDate < fromDate) {
                return false
            }
        }

        if (filters.dateTo) {
            const obDate = new Date(ob.createdAt)
            const toDate = new Date(filters.dateTo)
            toDate.setHours(23, 59, 59, 999)
            if (obDate > toDate) {
                return false
            }
        }

        return true
    })

    const [sortBy, setSortBy] = useState('smart')
    const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc')

    // Sorting Logic
    const sortedObligations = [...filteredObligations].sort((a, b) => {
        let comparison = 0

        switch (sortBy) {
            case 'smart':
                const getPriority = (status: string) => {
                    if (status === 'IN_PROGRESS') return 1
                    if (status === 'PENDING_CONFIRMATION') return 2
                    if (status === 'PENDING') return 3
                    if (status === 'APPROVED') return 4
                    if (status === 'REJECTED') return 5
                    if (status === 'COMPLETED') return 6
                    return 99
                }
                comparison = getPriority(a.status) - getPriority(b.status)
                if (comparison === 0) {
                    comparison = new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
                }
                break

            case 'createdAt':
                comparison = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
                break

            default:
                comparison = 0
        }

        return sortOrder === 'asc' ? comparison : -comparison
    })

    return (
        <div>
            <EmployeeFilter
                onFilterChange={setFilters}
                selectedEmployeeId={filters.employeeId}
                dateFrom={filters.dateFrom}
                dateTo={filters.dateTo}
                totalCount={filteredObligations.length}
                selectedStatus={filters.status}
                searchQuery={filters.search}
                isEmployee={role === 'EMPLOYEE'}
                sortBy={sortBy}
                sortOrder={sortOrder}
                onSortChange={(field, order) => { setSortBy(field); setSortOrder(order) }}
                sortOptions={[
                    { label: t('smart_sort'), value: 'smart' },
                    { label: t('deadline_label'), value: 'deadline' },
                    { label: t('date_created'), value: 'createdAt' },
                ]}
                primaryAction={
                    ['ADMIN', 'SUPER_ADMIN', 'TEAM_LEADER'].includes(role) && (
                        <Link href="/dashboard/obligations/new" className="btn btn-primary" style={{ textDecoration: 'none', height: '48px', display: 'flex', alignItems: 'center', borderRadius: '1.25rem' }}>
                            {t('add_obligation')}
                        </Link>
                    )
                }
            />

            <div style={{ display: 'grid', gap: '1rem' }}>
                {sortedObligations.length > 0 ? (
                    sortedObligations.map(ob => (
                        <ObligationListItem key={ob.id} obligation={ob as any} />
                    ))
                ) : (
                    <div className="card" style={{ textAlign: 'center', padding: '2rem', color: '#64748b' }}>
                        {t('no_obligations_found')}
                    </div>
                )}
            </div>
        </div>
    )
}

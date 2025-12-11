'use client'
import { useState } from 'react'
import Link from 'next/link'
import ObligationListItem from '@/components/ObligationListItem'
import EmployeeFilter from '@/components/EmployeeFilter'
import SortControl from '@/components/SortControl'

interface ObligationsClientProps {
    obligations: any[]
    role: string
}

export default function ObligationsClient({ obligations, role }: ObligationsClientProps) {
    const [filters, setFilters] = useState({
        employeeId: '',
        dateFrom: '',
        dateTo: '',
        status: ''
    })

    const filteredObligations = obligations.filter(ob => {
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
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
                <h1>Obligations</h1>
                {['ADMIN', 'SUPER_ADMIN', 'TEAM_LEADER'].includes(role) && (
                    <Link href="/dashboard/obligations/new" className="btn btn-primary" style={{ textDecoration: 'none' }}>
                        Add Obligation
                    </Link>
                )}
            </div>

            {['ADMIN', 'SUPER_ADMIN', 'TEAM_LEADER'].includes(role) && (
                <EmployeeFilter
                    onFilterChange={setFilters}
                    selectedEmployeeId={filters.employeeId}
                    dateFrom={filters.dateFrom}
                    dateTo={filters.dateTo}
                    totalCount={filteredObligations.length}
                    selectedStatus={filters.status}
                />
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '1rem' }}>
                <SortControl
                    options={[
                        { label: 'Smart Sort (Status)', value: 'smart' },
                        { label: 'Date Created', value: 'createdAt' },
                    ]}
                    sortBy={sortBy}
                    sortOrder={sortOrder}
                    onSortChange={(field, order) => { setSortBy(field); setSortOrder(order) }}
                />
            </div>

            <div style={{ display: 'grid', gap: '1rem' }}>
                {sortedObligations.length > 0 ? (
                    sortedObligations.map(ob => (
                        <ObligationListItem key={ob.id} obligation={ob as any} />
                    ))
                ) : (
                    <div className="card" style={{ textAlign: 'center', padding: '2rem', color: '#64748b' }}>
                        No obligations found for the selected filters
                    </div>
                )}
            </div>
        </div>
    )
}

'use client'
import { useState } from 'react'
import Link from 'next/link'
import ObligationListItem from '@/components/ObligationListItem'
import EmployeeFilter from '@/components/EmployeeFilter'

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

    // Custom sorting: PENDING_CONFIRMATION first, then IN_PROGRESS, then others by updatedAt DESC
    const sortedObligations = filteredObligations.sort((a, b) => {
        // Priority order
        const getPriority = (status: string) => {
            if (status === 'PENDING_CONFIRMATION') return 1
            if (status === 'IN_PROGRESS') return 2
            return 3 // APPROVED, COMPLETED, REJECTED
        }

        const priorityA = getPriority(a.status)
        const priorityB = getPriority(b.status)

        // If different priorities, sort by priority
        if (priorityA !== priorityB) {
            return priorityA - priorityB
        }

        // If same priority and both are completed statuses, sort by updatedAt DESC
        if (priorityA === 3) {
            return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
        }

        // Otherwise maintain original order
        return 0
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

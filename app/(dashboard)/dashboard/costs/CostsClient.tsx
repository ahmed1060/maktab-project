'use client'
import { useState, useMemo } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import CostCard from '@/components/CostCard'
import EmployeeFilter from '@/components/EmployeeFilter'
import { useLanguage } from '@/context/LanguageContext'
import Pagination from '@/components/Pagination'

interface CostsClientProps {
    tasksWithCosts: any[]
    userRole: string
    total: number
    page: number
    totalPages: number
}

export default function CostsClient({ tasksWithCosts, userRole, total, page, totalPages }: CostsClientProps) {
    const { t, locale } = useLanguage()
    const router = useRouter()
    const searchParams = useSearchParams()

    const filters = {
        employeeId: searchParams.get('employeeId') || '',
        dateFrom: searchParams.get('dateFrom') || '',
        dateTo: searchParams.get('dateTo') || '',
        search: searchParams.get('search') || ''
    }

    const isEmployee = userRole === 'EMPLOYEE'
    const [isUpdating, setIsUpdating] = useState(false)
    const [showFeedback, setShowFeedback] = useState(false)
    const [feedbackMessage, setFeedbackMessage] = useState('')

    const allCostEntries = tasksWithCosts.flatMap(task => {
        const mCosts = typeof task.memberCosts === 'string' ? JSON.parse(task.memberCosts) : (task.memberCosts || {})
        const userCosts = Object.entries(mCosts)

        if (userCosts.length === 0 && task.totalCost > 0) {
            return [{
                ...task,
                displayCost: task.totalCost,
                displayAssignee: task.assignee,
                individualPaymentStatus: task.paymentStatus
            }]
        }

        return userCosts.map(([uid, amount]) => {
            const assignee = task.assignees?.find((a: any) => a.id === uid) || (task.assigneeId === uid ? task.assignee : null)
            const mPaymentStatus = typeof task.memberPaymentStatus === 'string' ? JSON.parse(task.memberPaymentStatus) : (task.memberPaymentStatus || {})

            return {
                ...task,
                displayCost: Number(amount),
                displayAssignee: assignee || { firstName: t('unknown_user' as any) || 'Unknown', lastName: '', id: uid },
                individualPaymentStatus: mPaymentStatus[uid] || 'PENDING_PAYMENT'
            }
        })
    })

    // Filter flattened entries locally to ensure only the selected employee's card shows if employeeId is set
    const filteredEntries = allCostEntries.filter(entry => {
        if (filters.employeeId && entry.displayAssignee.id !== filters.employeeId) {
            return false
        }
        return true
    })

    const sortBy = searchParams.get('sortBy') || 'date'
    const sortOrder = (searchParams.get('sortOrder') || 'desc') as 'asc' | 'desc'

    const sortedEntries = [...filteredEntries].sort((a, b) => {
        let comparison = 0
        if (sortBy === 'date') {
            comparison = new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime()
        } else if (sortBy === 'amount') {
            comparison = a.displayCost - b.displayCost
        }
        return sortOrder === 'asc' ? comparison : -comparison
    })

    const handleFilterChange = (newFilters: any) => {
        const params = new URLSearchParams(searchParams.toString())
        if (newFilters.employeeId) params.set('employeeId', newFilters.employeeId)
        else params.delete('employeeId')

        if (newFilters.dateFrom) params.set('dateFrom', newFilters.dateFrom)
        else params.delete('dateFrom')

        if (newFilters.dateTo) params.set('dateTo', newFilters.dateTo)
        else params.delete('dateTo')

        if (newFilters.search) params.set('search', newFilters.search)
        else params.delete('search')

        params.set('page', '1') // Reset to first page on filter change
        router.push(`/dashboard/costs?${params.toString()}`)
    }

    const handleSortChange = (field: string, order: 'asc' | 'desc') => {
        const params = new URLSearchParams(searchParams.toString())
        params.set('sortBy', field)
        params.set('sortOrder', order)
        router.push(`/dashboard/costs?${params.toString()}`)
    }

    const handlePageChange = (p: number) => {
        const params = new URLSearchParams(searchParams.toString())
        params.set('page', p.toString())
        router.push(`/dashboard/costs?${params.toString()}`)
    }

    const handleMarkAllAsPaid = async () => {
        if (sortedEntries.length === 0) return

        setIsUpdating(true)
        try {
            const taskIds = Array.from(new Set(sortedEntries.map(entry => entry.id)))
            const res = await fetch('/api/tasks/payment/bulk', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ taskIds })
            })

            if (res.ok) {
                setFeedbackMessage(t('successfully_marked_paid'))
                setShowFeedback(true)
                setTimeout(() => setShowFeedback(false), 5000)
                router.refresh()
            } else {
                setFeedbackMessage(t('failed_update_payment_status'))
                setShowFeedback(true)
                setTimeout(() => setShowFeedback(false), 5000)
            }
        } catch (error) {
            console.error('Bulk payment update failed', error)
            setFeedbackMessage(t('error_generic'))
            setShowFeedback(true)
            setTimeout(() => setShowFeedback(false), 5000)
        } finally {
            setIsUpdating(false)
        }
    }

    return (
        <div style={{ direction: locale === 'ar' ? 'rtl' : 'ltr' }}>
            {showFeedback && (
                <div style={{
                    position: 'fixed',
                    top: '20px',
                    [locale === 'ar' ? 'left' : 'right']: '20px',
                    background: feedbackMessage === t('successfully_marked_paid') ? '#dcfce7' : '#fee2e2',
                    color: feedbackMessage === t('successfully_marked_paid') ? '#166534' : '#991b1b',
                    padding: '1rem 1.5rem',
                    borderRadius: '0.5rem',
                    boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
                    zIndex: 1000,
                    fontWeight: '600',
                    width: 'calc(100vw - 3rem)',
                    maxWidth: '350px'
                }}>
                    {feedbackMessage}
                </div>
            )}


            <EmployeeFilter
                onFilterChange={handleFilterChange}
                selectedEmployeeId={filters.employeeId}
                dateFrom={filters.dateFrom}
                dateTo={filters.dateTo}
                totalCount={total}
                totalCost={0} // We can't easily calculate total cost across all pages without another count or complex query
                isEmployee={isEmployee}
                hideSearch={false}
                searchQuery={filters.search}
                hideStatusFilter={true}
                sortBy={sortBy}
                sortOrder={sortOrder}
                onSortChange={handleSortChange}
                sortOptions={[
                    { label: t('date' as any), value: 'date' },
                    { label: t('amount_label'), value: 'amount' },
                ]}
                primaryAction={
                    ['ADMIN', 'SUPER_ADMIN'].includes(userRole) && tasksWithCosts.length > 0 && (
                        <button
                            onClick={handleMarkAllAsPaid}
                            disabled={isUpdating}
                            style={{
                                background: '#10b981',
                                color: 'white',
                                border: 'none',
                                borderRadius: '1.25rem',
                                padding: '0 1.5rem',
                                cursor: isUpdating ? 'not-allowed' : 'pointer',
                                fontSize: '0.875rem',
                                fontWeight: '700',
                                opacity: isUpdating ? 0.6 : 1,
                                height: '48px',
                                display: 'flex',
                                alignItems: 'center'
                            }}
                        >
                            {isUpdating ? t('marking_as_paid') : `${t('mark_all_as_paid')} (${tasksWithCosts.length})`}
                        </button>
                    )
                }
            />

            {sortedEntries.length === 0 ? (
                <div className="card" style={{ textAlign: 'center', padding: '3rem', color: '#64748b' }}>
                    <p style={{ fontSize: '1.1rem', marginBottom: '0.5rem' }}>
                        {filters.employeeId || filters.dateFrom || filters.dateTo || filters.search
                            ? t('no_costs_found_filters')
                            : t('no_costs_found_yet')}
                    </p>
                    <p style={{ fontSize: '0.9rem' }}>{t('approved_tasks_costs_hint')}</p>
                </div>
            ) : (
                <div style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
                    gap: '1.5rem'
                }}>
                    {sortedEntries.map((entry, index) => (
                        <CostCard
                            key={`${entry.id}-${entry.displayAssignee.id}-${index}`}
                            task={{
                                ...entry,
                                totalCost: entry.displayCost,
                                assignee: entry.displayAssignee,
                                paymentStatus: entry.individualPaymentStatus // Pass individual status to card
                            }}
                        />
                    ))}
                </div>
            )}

            <Pagination
                currentPage={page}
                totalPages={totalPages}
                onPageChange={handlePageChange}
            />
        </div>
    )
}

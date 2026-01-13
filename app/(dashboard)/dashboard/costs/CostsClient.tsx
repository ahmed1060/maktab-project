'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import CostCard from '@/components/CostCard'
import EmployeeFilter from '@/components/EmployeeFilter'
import SortControl from '@/components/SortControl'
import { useLanguage } from '@/context/LanguageContext'

interface CostsClientProps {
    tasksWithCosts: any[]
    userRole: string
}

export default function CostsClient({ tasksWithCosts, userRole }: CostsClientProps) {
    const { t, locale } = useLanguage()
    const router = useRouter()
    const [filters, setFilters] = useState({
        employeeId: '',
        dateFrom: '',
        dateTo: '',
        search: ''
    })
    const isEmployee = userRole === 'EMPLOYEE'
    const [isUpdating, setIsUpdating] = useState(false)
    const [showFeedback, setShowFeedback] = useState(false)
    const [feedbackMessage, setFeedbackMessage] = useState('')

    const allCostEntries = tasksWithCosts.flatMap(task => {
        const mCosts = typeof task.memberCosts === 'string' ? JSON.parse(task.memberCosts) : (task.memberCosts || {})
        const userCosts = Object.entries(mCosts)

        if (userCosts.length === 0 && task.totalCost > 0) {
            // Legacy or single assignee with totalCost but no memberCosts yet
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

    const filteredEntries = allCostEntries.filter(entry => {
        // Filter by search query (title)
        if (filters.search && !entry.title.toLowerCase().includes(filters.search.toLowerCase())) {
            return false
        }

        // Filter by employee
        if (filters.employeeId && entry.displayAssignee.id !== filters.employeeId) {
            return false
        }

        // Filter by date range (using updatedAt - when task was approved/completed)
        if (filters.dateFrom) {
            const taskDate = new Date(entry.updatedAt)
            const fromDate = new Date(filters.dateFrom)
            if (taskDate < fromDate) {
                return false
            }
        }

        if (filters.dateTo) {
            const taskDate = new Date(entry.updatedAt)
            const toDate = new Date(filters.dateTo)
            toDate.setHours(23, 59, 59, 999)
            if (taskDate > toDate) {
                return false
            }
        }

        return true
    })

    const [sortBy, setSortBy] = useState('date')
    const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc')

    const sortedEntries = [...filteredEntries].sort((a, b) => {
        let comparison = 0
        if (sortBy === 'date') {
            comparison = new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime()
        } else if (sortBy === 'amount') {
            comparison = a.displayCost - b.displayCost
        }
        return sortOrder === 'asc' ? comparison : -comparison
    })

    const totalCost = sortedEntries.reduce((sum, entry) => sum + entry.displayCost, 0)

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
                onFilterChange={setFilters}
                selectedEmployeeId={filters.employeeId}
                dateFrom={filters.dateFrom}
                dateTo={filters.dateTo}
                totalCount={filteredEntries.length}
                totalCost={totalCost}
                isEmployee={isEmployee}
                hideSearch={true}
                hideStatusFilter={true}
                sortBy={sortBy}
                sortOrder={sortOrder}
                onSortChange={(field, order) => { setSortBy(field); setSortOrder(order) }}
                sortOptions={[
                    { label: t('date' as any), value: 'date' },
                    { label: t('amount_label'), value: 'amount' },
                ]}
                primaryAction={
                    ['ADMIN', 'SUPER_ADMIN'].includes(userRole) && sortedEntries.length > 0 && (
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
                            {isUpdating ? t('marking_as_paid') : `${t('mark_all_as_paid')} (${sortedEntries.length})`}
                        </button>
                    )
                }
            />

            {sortedEntries.length === 0 ? (
                <div className="card" style={{ textAlign: 'center', padding: '3rem', color: '#64748b' }}>
                    <p style={{ fontSize: '1.1rem', marginBottom: '0.5rem' }}>
                        {filters.employeeId || filters.dateFrom || filters.dateTo
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
        </div>
    )
}

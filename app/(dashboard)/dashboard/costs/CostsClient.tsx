'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import CostCard from '@/components/CostCard'
import EmployeeFilter from '@/components/EmployeeFilter'
import SortControl from '@/components/SortControl'

interface CostsClientProps {
    tasksWithCosts: any[]
    userRole: string
}

export default function CostsClient({ tasksWithCosts, userRole }: CostsClientProps) {
    const router = useRouter()
    const [filters, setFilters] = useState({
        employeeId: '',
        dateFrom: '',
        dateTo: ''
    })
    const [isUpdating, setIsUpdating] = useState(false)
    const [showFeedback, setShowFeedback] = useState(false)
    const [feedbackMessage, setFeedbackMessage] = useState('')

    const filteredTasks = tasksWithCosts.filter(task => {
        // Filter by employee
        if (filters.employeeId && task.assignee.id !== filters.employeeId) {
            return false
        }

        // Filter by date range (using updatedAt - when task was approved/completed)
        if (filters.dateFrom) {
            const taskDate = new Date(task.updatedAt)
            const fromDate = new Date(filters.dateFrom)
            if (taskDate < fromDate) {
                return false
            }
        }

        if (filters.dateTo) {
            const taskDate = new Date(task.updatedAt)
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

    const sortedTasks = [...filteredTasks].sort((a, b) => {
        let comparison = 0
        if (sortBy === 'date') {
            comparison = new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime()
        } else if (sortBy === 'amount') {
            comparison = a.totalCost - b.totalCost
        }
        return sortOrder === 'asc' ? comparison : -comparison
    })

    const totalCost = sortedTasks.reduce((sum, task) => sum + task.totalCost, 0)

    const handleMarkAllAsPaid = async () => {
        if (sortedTasks.length === 0) return

        setIsUpdating(true)
        try {
            const taskIds = sortedTasks.map(task => task.id)
            const res = await fetch('/api/tasks/payment/bulk', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ taskIds })
            })

            if (res.ok) {
                const data = await res.json()
                setFeedbackMessage(`Successfully marked ${data.count} task(s) as paid!`)
                setShowFeedback(true)
                setTimeout(() => setShowFeedback(false), 5000)
                router.refresh()
            } else {
                setFeedbackMessage('Failed to update payment status')
                setShowFeedback(true)
                setTimeout(() => setShowFeedback(false), 5000)
            }
        } catch (error) {
            console.error('Bulk payment update failed', error)
            setFeedbackMessage('An error occurred')
            setShowFeedback(true)
            setTimeout(() => setShowFeedback(false), 5000)
        } finally {
            setIsUpdating(false)
        }
    }

    return (
        <div>
            {showFeedback && (
                <div style={{
                    position: 'fixed',
                    top: '20px',
                    right: '20px',
                    background: feedbackMessage.includes('Successfully') ? '#dcfce7' : '#fee2e2',
                    color: feedbackMessage.includes('Successfully') ? '#166534' : '#991b1b',
                    padding: '1rem 1.5rem',
                    borderRadius: '0.5rem',
                    boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
                    zIndex: 1000,
                    fontWeight: '600'
                }}>
                    {feedbackMessage}
                </div>
            )}


            <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', marginBottom: '2rem' }}>

                {['ADMIN', 'SUPER_ADMIN'].includes(userRole) && sortedTasks.length > 0 && (
                    <button
                        onClick={handleMarkAllAsPaid}
                        disabled={isUpdating}
                        style={{
                            background: '#10b981',
                            color: 'white',
                            border: 'none',
                            borderRadius: '0.5rem',
                            padding: '0.75rem 1.5rem',
                            cursor: isUpdating ? 'not-allowed' : 'pointer',
                            fontSize: '0.875rem',
                            fontWeight: '600',
                            opacity: isUpdating ? 0.6 : 1
                        }}
                    >
                        {isUpdating ? 'Updating...' : `Mark All as Paid (${sortedTasks.length})`}
                    </button>
                )}
            </div>

            <EmployeeFilter
                onFilterChange={setFilters}
                selectedEmployeeId={filters.employeeId}
                dateFrom={filters.dateFrom}
                dateTo={filters.dateTo}
                totalCount={filteredTasks.length}
                totalCost={totalCost}
            />

            <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '1rem' }}>
                <SortControl
                    options={[
                        { label: 'Date', value: 'date' },
                        { label: 'Amount', value: 'amount' },
                    ]}
                    sortBy={sortBy}
                    sortOrder={sortOrder}
                    onSortChange={(field, order) => { setSortBy(field); setSortOrder(order) }}
                />
            </div>

            {sortedTasks.length === 0 ? (
                <div className="card" style={{ textAlign: 'center', padding: '3rem', color: '#64748b' }}>
                    <p style={{ fontSize: '1.1rem', marginBottom: '0.5rem' }}>
                        {filters.employeeId || filters.dateFrom || filters.dateTo
                            ? 'No approved tasks with costs for the selected filters'
                            : 'No approved tasks with costs yet'}
                    </p>
                    <p style={{ fontSize: '0.9rem' }}>Approved tasks with cost entries will appear here</p>
                </div>
            ) : (
                <div style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
                    gap: '1.5rem'
                }}>
                    {sortedTasks.map(task => (
                        <CostCard key={task.id} task={task} />
                    ))}
                </div>
            )}
        </div>
    )
}

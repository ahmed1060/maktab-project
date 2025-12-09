'use client'
import { useState } from 'react'
import Link from 'next/link'
import TaskListItem from '@/components/TaskListItem'
import EmployeeFilter from '@/components/EmployeeFilter'
import SortControl from '@/components/SortControl'

interface TasksClientProps {
    tasks: any[]
    role: string
    currentUserId: string
}

export default function TasksClient({ tasks, role, currentUserId }: TasksClientProps) {
    const [filters, setFilters] = useState({
        employeeId: '',
        dateFrom: '',
        dateTo: '',
        status: ''
    })

    const filteredTasks = tasks.filter(task => {
        // Filter by employee
        if (filters.employeeId && task.assigneeId !== filters.employeeId) {
            return false
        }

        // Filter by status
        if (filters.status && task.status !== filters.status) {
            return false
        }

        // Filter by date range (using createdAt)
        if (filters.dateFrom) {
            const taskDate = new Date(task.createdAt)
            const fromDate = new Date(filters.dateFrom)
            if (taskDate < fromDate) {
                return false
            }
        }

        if (filters.dateTo) {
            const taskDate = new Date(task.createdAt)
            const toDate = new Date(filters.dateTo)
            toDate.setHours(23, 59, 59, 999) // End of day
            if (taskDate > toDate) {
                return false
            }
        }

        return true
    })

    const [sortBy, setSortBy] = useState('smart')
    const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc')

    // Sorting Logic
    const sortedTasks = [...filteredTasks].sort((a, b) => {
        let comparison = 0

        switch (sortBy) {
            case 'smart':
                // Priority: PENDING_CONFIRMATION (1) -> IN_PROGRESS (2) -> Others (3)
                const getPriority = (status: string) => {
                    if (status === 'PENDING_CONFIRMATION') return 1
                    if (status === 'IN_PROGRESS') return 2
                    return 3
                }
                comparison = getPriority(a.status) - getPriority(b.status)
                // Secondary sort by updatedAt desc for smart sort
                if (comparison === 0) {
                    return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
                }
                return comparison

            case 'deadline':
                comparison = new Date(a.deadline).getTime() - new Date(b.deadline).getTime()
                break

            case 'difficulty':
                comparison = (a.difficulty || 0) - (b.difficulty || 0)
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
                <h1>Tasks</h1>
                {['ADMIN', 'SUPER_ADMIN', 'TEAM_LEADER'].includes(role) && (
                    <Link href="/dashboard/tasks/new" className="btn btn-primary" style={{ textDecoration: 'none' }}>
                        Create Task
                    </Link>
                )}
            </div>

            {['ADMIN', 'SUPER_ADMIN', 'TEAM_LEADER'].includes(role) && (
                <EmployeeFilter
                    onFilterChange={setFilters}
                    selectedEmployeeId={filters.employeeId}
                    dateFrom={filters.dateFrom}
                    dateTo={filters.dateTo}
                    totalCount={filteredTasks.length}
                    selectedStatus={filters.status}
                />
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '1rem' }}>
                <SortControl
                    options={[
                        { label: 'Smart Sort (Status)', value: 'smart' },
                        { label: 'Deadline', value: 'deadline' },
                        { label: 'Difficulty', value: 'difficulty' },
                        { label: 'Date Created', value: 'createdAt' },
                    ]}
                    sortBy={sortBy}
                    sortOrder={sortOrder}
                    onSortChange={(field, order) => { setSortBy(field); setSortOrder(order) }}
                />
            </div>

            <div style={{ display: 'grid', gap: '1rem' }}>
                {sortedTasks.length > 0 ? (
                    sortedTasks.map(task => (
                        <TaskListItem key={task.id} task={task as any} currentUserId={currentUserId} />
                    ))
                ) : (
                    <div className="card" style={{ textAlign: 'center', padding: '2rem', color: '#64748b' }}>
                        No tasks found for the selected filters
                    </div>
                )}
            </div>
        </div>
    )
}

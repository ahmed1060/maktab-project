'use client'
import { useState } from 'react'
import Link from 'next/link'
import TaskListItem from '@/components/TaskListItem'
import EmployeeFilter from '@/components/EmployeeFilter'

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

    // Custom sorting: PENDING_CONFIRMATION first, then IN_PROGRESS, then others by updatedAt DESC
    const sortedTasks = filteredTasks.sort((a, b) => {
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

'use client'
import { useState, useEffect } from 'react'
import Link from 'next/link'
import TaskListItem from '@/components/TaskListItem'
import EmployeeFilter from '@/components/EmployeeFilter'
import SortControl from '@/components/SortControl'
import { useLanguage } from '@/context/LanguageContext'

interface TasksClientProps {
    tasks: any[]
    role: string
    currentUserId: string
}

export default function TasksClient({ tasks, role, currentUserId }: TasksClientProps) {
    const { t } = useLanguage()
    const [filters, setFilters] = useState({
        employeeId: '',
        dateFrom: '',
        dateTo: '',
        status: '',
        search: ''
    })

    const filteredTasks = tasks.filter(task => {
        // Filter by search query (title)
        if (filters.search && !task.title.toLowerCase().includes(filters.search.toLowerCase())) {
            return false
        }

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
                // Priority: IN_PROGRESS (1) -> PENDING_CONFIRMATION (2) -> PENDING (3) -> APPROVED (4) -> REJECTED (5) -> COMPLETED (6)
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
                // Secondary sort by updatedAt desc for smart sort
                if (comparison === 0) {
                    comparison = new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
                }
                break

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
            <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', marginBottom: '1.5rem' }}>
                {['ADMIN', 'SUPER_ADMIN', 'TEAM_LEADER'].includes(role) && (
                    <Link href="/dashboard/tasks/new" className="btn btn-primary" style={{ textDecoration: 'none' }}>
                        {t('create_new_task')}
                    </Link>
                )}
            </div>

            <EmployeeFilter
                onFilterChange={setFilters}
                selectedEmployeeId={filters.employeeId}
                dateFrom={filters.dateFrom}
                dateTo={filters.dateTo}
                totalCount={filteredTasks.length}
                selectedStatus={filters.status}
                searchQuery={filters.search}
                isEmployee={role === 'EMPLOYEE'}
            />

            <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '1rem' }}>
                <SortControl
                    options={[
                        { label: t('smart_sort'), value: 'smart' },
                        { label: t('deadline_label'), value: 'deadline' },
                        { label: t('difficulty'), value: 'difficulty' },
                        { label: t('date_created'), value: 'createdAt' },
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
                        {t('no_tasks_found')}
                    </div>
                )}
            </div>
        </div>
    )
}

'use client'
import { useState, useEffect } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import TaskListItem from '@/components/TaskListItem'
import EmployeeFilter from '@/components/EmployeeFilter'
import Pagination from '@/components/Pagination'
import { useLanguage } from '@/context/LanguageContext'

interface TasksClientProps {
    tasks: any[]
    total: number
    page: number
    totalPages: number
    role: string
    currentUserId: string
    view: string
}

export default function TasksClient({ tasks, total, page, totalPages, role, currentUserId, view }: TasksClientProps) {
    const { t, locale } = useLanguage()
    const router = useRouter()
    const searchParams = useSearchParams()
    const highlightId = searchParams?.get('highlight')

    const [filters, setFilters] = useState({
        employeeId: searchParams?.get('employeeId') || '',
        dateFrom: searchParams?.get('dateFrom') || '', // Note: we should handle these in server component too if we want true filtering
        dateTo: searchParams?.get('dateTo') || '',
        status: searchParams?.get('status') || '',
        search: searchParams?.get('search') || ''
    })

    const [sortBy, setSortBy] = useState(searchParams?.get('sortBy') || 'smart')
    const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>(searchParams?.get('sortOrder') as any || 'asc')

    const updateQueryParams = (newFilters: any) => {
        const params = new URLSearchParams(searchParams?.toString())
        Object.keys(newFilters).forEach(key => {
            if (newFilters[key]) {
                params.set(key, newFilters[key])
            } else {
                params.delete(key)
            }
        })
        params.set('page', '1') // Reset to page 1 on filter change
        router.push(`/dashboard/tasks?${params.toString()}`)
    }

    const handlePageChange = (newPage: number) => {
        const params = new URLSearchParams(searchParams?.toString())
        params.set('page', newPage.toString())
        router.push(`/dashboard/tasks?${params.toString()}`)
    }

    // Sorting Logic (Still client-side for the current 10 items, or we can move to server too)
    // Given the smart sort logic is complex, keeping it client-side for the page results is okay, 
    // but ideally sorting should also be server-side. For now, let's keep it consistent.
    const sortedTasks = [...tasks].sort((a, b) => {
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

    // Scroll to highlighted task
    useEffect(() => {
        if (highlightId && tasks.length > 0) {
            const element = document.getElementById(`task-${highlightId}`);
            if (element) {
                element.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
        }
    }, [highlightId, tasks]);

    return (
        <div>
            {['EMPLOYEE', 'TEAM_LEADER'].includes(role) && (
                <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '1.25rem' }}>
                    <button
                        onClick={() => updateQueryParams({ view: 'my' })}
                        className="btn"
                        style={{
                            background: view === 'my' ? 'var(--btn-primary)' : '#f1f5f9',
                            color: view === 'my' ? '#fff' : '#0f172a',
                            border: 'none',
                            padding: '0.6rem 1.75rem',
                            borderRadius: '99px',
                            fontSize: '0.95rem',
                            fontWeight: '800',
                            transition: 'all 0.2s ease',
                            boxShadow: view === 'my' ? '0 4px 12px rgba(139, 92, 246, 0.25)' : 'none'
                        }}
                    >
                        {t('my_tasks' as any)}
                    </button>
                    <button
                        onClick={() => updateQueryParams({ view: 'active' })}
                        className="btn"
                        style={{
                            background: view === 'active' ? 'var(--btn-primary)' : '#f1f5f9',
                            color: view === 'active' ? '#fff' : '#0f172a',
                            border: 'none',
                            padding: '0.6rem 1.75rem',
                            borderRadius: '99px',
                            fontSize: '0.95rem',
                            fontWeight: '800',
                            transition: 'all 0.2s ease',
                            boxShadow: view === 'active' ? '0 4px 12px rgba(139, 92, 246, 0.25)' : 'none'
                        }}
                    >
                        {t('active_tasks' as any)}
                    </button>
                </div>
            )}
            <EmployeeFilter
                onFilterChange={(newFilters) => {
                    setFilters(prev => ({ ...prev, ...newFilters }))
                    updateQueryParams(newFilters)
                }}
                selectedEmployeeId={filters.employeeId}
                dateFrom={filters.dateFrom}
                dateTo={filters.dateTo}
                totalCount={total}
                selectedStatus={filters.status}
                searchQuery={filters.search}
                placeholder={locale === 'ar' ? 'بحث في عنوان المهمة أو الوصف' : 'Search Task Title or Description'}
                isEmployee={role === 'EMPLOYEE'}
                sortBy={sortBy}
                sortOrder={sortOrder}
                onSortChange={(field, order) => { setSortBy(field); setSortOrder(order) }}
                sortOptions={[
                    { label: t('smart_sort'), value: 'smart' },
                    { label: t('deadline_label'), value: 'deadline' },
                    { label: t('difficulty'), value: 'difficulty' },
                    { label: t('date_created'), value: 'createdAt' },
                ]}
                primaryAction={
                    ['ADMIN', 'SUPER_ADMIN', 'TEAM_LEADER'].includes(role) && (
                        <Link href="/dashboard/tasks/new" className="btn btn-primary" style={{ textDecoration: 'none', height: '48px', display: 'flex', alignItems: 'center', borderRadius: '1.25rem' }}>
                            {t('create_new_task')}
                        </Link>
                    )
                }
            />

            <div style={{ display: 'grid', gap: '1rem' }}>
                {sortedTasks.length > 0 ? (
                    sortedTasks.map(task => (
                        <TaskListItem
                            key={task.id}
                            task={task as any}
                            currentUserId={currentUserId}
                            isHighlighted={highlightId === task.id}
                        />
                    ))
                ) : (
                    <div className="card" style={{ textAlign: 'center', padding: '2rem', color: '#64748b' }}>
                        {t('no_tasks_found')}
                    </div>
                )}
            </div>

            <Pagination
                currentPage={page}
                totalPages={totalPages}
                onPageChange={handlePageChange}
            />
        </div>
    )
}

'use client'
import { useState, useEffect } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import ObligationListItem from '@/components/ObligationListItem'
import EmployeeFilter from '@/components/EmployeeFilter'
import Pagination from '@/components/Pagination'
import { useLanguage } from '@/context/LanguageContext'
import { useHeader } from '@/context/HeaderContext'

interface ObligationsClientProps {
    obligations: any[]
    total: number
    page: number
    totalPages: number
    role: string
}

export default function ObligationsClient({ obligations, total, page, totalPages, role }: ObligationsClientProps) {
    const { t, locale } = useLanguage()
    const { setTitle, setSubtitle } = useHeader()
    const router = useRouter()
    const searchParams = useSearchParams()
    const highlightId = searchParams?.get('highlight')

    const [filters, setFilters] = useState({
        employeeId: searchParams?.get('employeeId') || '',
        status: searchParams?.get('status') || '',
        search: searchParams?.get('search') || '',
        dateFrom: searchParams?.get('dateFrom') || '',
        dateTo: searchParams?.get('dateTo') || ''
    })

    const updateQueryParams = (newFilters: any) => {
        const params = new URLSearchParams(searchParams?.toString())
        Object.keys(newFilters).forEach(key => {
            if (newFilters[key]) {
                params.set(key, newFilters[key])
            } else {
                params.delete(key)
            }
        })
        params.set('page', '1')
        router.push(`/dashboard/obligations?${params.toString()}`)
    }

    const handlePageChange = (newPage: number) => {
        const params = new URLSearchParams(searchParams?.toString())
        params.set('page', newPage.toString())
        router.push(`/dashboard/obligations?${params.toString()}`)
    }

    const [sortBy, setSortBy] = useState(searchParams?.get('sortBy') || 'smart')
    const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>(searchParams?.get('sortOrder') as any || 'asc')

    // Sorting Logic (current page)
    const sortedObligations = [...obligations].sort((a, b) => {
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

    useEffect(() => {
        if (highlightId && obligations.length > 0) {
            const element = document.getElementById(`obligation-${highlightId}`);
            if (element) {
                element.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
        }
    }, [highlightId, obligations]);

    useEffect(() => {
        setTitle(t('obligations'))
        setSubtitle(t('obligations_subtitle' as any))
        return () => {
            setTitle(null)
            setSubtitle(null)
        }
    }, [setTitle, setSubtitle, t])

    return (
        <div>
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
                placeholder={locale === 'ar' ? 'بحث في العنوان أو الوصف' : 'Search Title or Description'}
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
                        <ObligationListItem
                            key={ob.id}
                            obligation={ob as any}
                            isHighlighted={highlightId === ob.id}
                        />
                    ))
                ) : (
                    <div className="card" style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-soft)' }}>
                        {t('no_obligations_found')}
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

'use client'
import { useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import CostCard from '@/components/CostCard'
import EmployeeFilter from '@/components/EmployeeFilter'
import { useLanguage } from '@/context/LanguageContext'
import { useModules } from '@/lib/useModules'
import { useHeader } from '@/context/HeaderContext'
import { useEffect } from 'react'
import Pagination from '@/components/Pagination'
import { useCan } from '@/lib/useCan'
import { shareOwed, unallocatedCost } from '@/lib/cost-shares'
import { usePlaceFilters } from '@/components/locations/usePlaceFilters'
import ConfirmModal from '@/components/ConfirmModal'

interface CostsClientProps {
    tasksWithCosts: any[]
    total: number
    page: number
    totalPages: number
    /** What the whole filtered list still owes, or the picked employee's share of it (CLIENTS_PLAN.md §3.5). */
    totalDue: number
    /** What Mark all as paid would pay, every part of every task in the list, as it's confirmed (§4.1). */
    toPay: { count: number; amount: number; digest: string } | null
}

export default function CostsClient({ tasksWithCosts, total, page, totalPages, totalDue, toPay }: CostsClientProps) {
    const { t, locale } = useLanguage()
    const { setTitle, setSubtitle } = useHeader()
    const modules = useModules()
    const router = useRouter()
    const searchParams = useSearchParams()

    const filters = {
        // A Super Admin's chosen company, so Mark all as paid pays its costs only.
        company: searchParams.get('company') || '',
        employeeId: searchParams.get('employeeId') || '',
        dateFrom: searchParams.get('dateFrom') || '',
        dateTo: searchParams.get('dateTo') || '',
        search: searchParams.get('search') || '',
        // So Mark all as paid pays only the client's and location's shown (CLIENTS_PLAN.md §3.4).
        clientId: searchParams.get('clientId') || '',
        locationId: searchParams.get('locationId') || '',
    }
    const placeFilters = usePlaceFilters({ clientId: filters.clientId, locationId: filters.locationId })

    const { can, companyWide } = useCan()
    const isEmployee = !can('tasks.pay')
    const [isUpdating, setIsUpdating] = useState(false)
    const [confirming, setConfirming] = useState(false)
    const [showFeedback, setShowFeedback] = useState(false)
    const [feedbackMessage, setFeedbackMessage] = useState('')

    const allCostEntries = tasksWithCosts.flatMap(task => {
        const mCosts = typeof task.memberCosts === 'string' ? JSON.parse(task.memberCosts) : (task.memberCosts || {})
        const userCosts = Object.entries(mCosts)

        const mPaymentStatus = typeof task.memberPaymentStatus === 'string' ? JSON.parse(task.memberPaymentStatus) : (task.memberPaymentStatus || {})
        // Only the shares still to pay: one already paid, as one employee's
        // costs are by Mark all as paid, isn't waiting any more.
        const shares = userCosts.filter(([uid, amount]) => shareOwed(amount, mPaymentStatus[uid])).map(([uid, amount]) => {
            const assignee = task.assignees?.find((a: any) => a.id === uid)

            return {
                ...task,
                displayCost: Number(amount),
                displayAssignee: assignee || { firstName: t('unknown_user' as any) || 'Unknown', lastName: '', id: uid },
                individualPaymentStatus: mPaymentStatus[uid] || 'PENDING_PAYMENT'
            }
        })

        // What of the cost is no one's share: all of it for a cost not split
        // by member, as a task's was before memberCosts, or what a task had
        // then beside the shares added since. The task's own card: a task has
        // assignees, not an assignee, so it names them all.
        const unallocated = unallocatedCost(task.totalCost, mCosts)
        if (unallocated <= 0) return shares
        const names = (task.assignees || []).map((a: any) => `${a.firstName} ${a.lastName}`.trim()).filter(Boolean)
        return [...shares, {
            ...task,
            displayCost: unallocated,
            displayAssignee: { id: null, firstName: names.join(locale === 'ar' ? '، ' : ', ') || t('unknown_user'), lastName: '' },
            individualPaymentStatus: task.paymentStatus
        }]
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

        for (const key of ['clientId', 'locationId']) {
            if (newFilters[key]) params.set(key, newFilters[key])
            else params.delete(key)
        }

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

    // Pays exactly what the window said, and refuses if the list has changed since (CLIENTS_PLAN.md §4.1).
    const handleMarkAllAsPaid = async () => {
        if (!toPay) return
        setIsUpdating(true)
        try {
            const res = await fetch('/api/tasks/payment/bulk', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ filters, confirm: { digest: toPay.digest } })
            })

            if (res.status === 409) {
                // Changed since it was shown: shown again as it is now.
                setFeedbackMessage(t('costs_pay_changed'))
                setShowFeedback(true)
                setTimeout(() => setShowFeedback(false), 5000)
                router.refresh()
            } else if (res.ok) {
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
            setConfirming(false)
        }
    }
    const money = (n: number) => n.toLocaleString(locale === 'ar' ? 'ar-EG' : 'en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

    useEffect(() => {
        setTitle(modules.label('costs'))
        setSubtitle(t('costs_subtitle' as any))
        return () => {
            setTitle(null)
            setSubtitle(null)
        }
    }, [setTitle, setSubtitle, t, modules])

    return (
        <div style={{ direction: locale === 'ar' ? 'rtl' : 'ltr' }}>
            {showFeedback && (
                <div style={{
                    position: 'fixed',
                    top: '20px',
                    [locale === 'ar' ? 'left' : 'right']: '20px',
                    background: feedbackMessage === t('successfully_marked_paid') ? 'var(--ok-bg)' : 'var(--danger-bg)',
                    color: feedbackMessage === t('successfully_marked_paid') ? 'var(--ok-fg)' : 'var(--danger-fg)',
                    padding: '1rem 1.5rem',
                    borderRadius: '0.5rem',
                    boxShadow: '0 4px 12px var(--shadow-weak)',
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
                totalCost={totalDue}
                totalCostLabel={t('costs_total_due')}
                extraFilters={placeFilters}
                isEmployee={isEmployee}
                hideSearch={false}
                searchQuery={filters.search}
                placeholder={locale === 'ar' ? 'بحث في عنوان المهمة' : 'Search Task Title'}
                hideStatusFilter={true}
                sortBy={sortBy}
                sortOrder={sortOrder}
                onSortChange={handleSortChange}
                sortOptions={[
                    { label: t('date' as any), value: 'date' },
                    { label: t('amount_label'), value: 'amount' },
                ]}
                primaryAction={
                    // Paying everything at once is for those who pay across the
                    // company; a Team Leader pays their team's one at a time.
                    companyWide('tasks.pay') && total > 0 && toPay && toPay.count > 0 && (
                        <button
                            onClick={() => setConfirming(true)}
                            disabled={isUpdating}
                            style={{
                                background: 'var(--ok-fill)',
                                color: 'var(--text-on-accent)',
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
                            {isUpdating ? t('marking_as_paid') : `${t('mark_all_as_paid')} (${total})`}
                        </button>
                    )
                }
            />

            {sortedEntries.length === 0 ? (
                <div className="card" style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-soft)' }}>
                    <p style={{ fontSize: '1.1rem', marginBottom: '0.5rem' }}>
                        {filters.employeeId || filters.dateFrom || filters.dateTo || filters.search || filters.clientId || filters.locationId
                            ? t('no_costs_found_filters')
                            : t('no_costs_found_yet')}
                    </p>
                    <p style={{ fontSize: '0.9rem' }}>{t('approved_tasks_costs_hint')}</p>
                </div>
            ) : (
                <div style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fill, minmax(min(300px, 100%), 1fr))',
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

            <ConfirmModal
                isOpen={confirming && !!toPay}
                title={t('mark_all_as_paid')}
                message={toPay ? t('costs_pay_question').replace('{count}', toPay.count.toLocaleString(locale === 'ar' ? 'ar-EG' : 'en-GB')).replace('{amount}', money(toPay.amount)) : ''}
                confirmText={toPay ? t('costs_pay_button').replace('{count}', toPay.count.toLocaleString(locale === 'ar' ? 'ar-EG' : 'en-GB')).replace('{amount}', money(toPay.amount)) : ''}
                cancelText={t('cancel')}
                onConfirm={handleMarkAllAsPaid}
                onCancel={() => setConfirming(false)}
                variant="warning"
            />
        </div>
    )
}

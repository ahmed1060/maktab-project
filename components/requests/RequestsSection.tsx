'use client'
import { useState } from 'react'
import useSWR from 'swr'
import { fetcher } from '@/lib/swr-fetcher'
import RequestCard from './RequestCard'
import CreateRequestModal from './CreateRequestModal'
import ViewRequestModal from './ViewRequestModal'
import { useLanguage } from '@/context/LanguageContext'
import { useToast } from '@/context/ToastContext'
import { useCompany } from '@/context/CompanyContext'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import EmployeeFilter from '@/components/EmployeeFilter'
import Pagination from '@/components/Pagination'
import { useFadingHighlight } from '@/lib/useFadingHighlight'
import { useAdjustOnChange } from '@/lib/useAdjustOnChange'
import { useCan } from '@/lib/useCan'

const NO_REQUESTS: any[] = []

export default function RequestsSection({ userRole }: { userRole: string }) {
    const { t, locale } = useLanguage()
    const seesOthersRequests = useCan().can('requests.view')
    const { showToast } = useToast()
    const { selectedCompanyId } = useCompany()
    const searchParams = useSearchParams()
    const [isCreateModalOpen, setIsCreateModalOpen] = useState(false)
    const [selectedRequest, setSelectedRequest] = useState<any>(null)
    const [isViewModalOpen, setIsViewModalOpen] = useState(false)
    const [sortBy, setSortBy] = useState('updatedAt')
    const [order, setOrder] = useState('desc')
    const [filters, setFilters] = useState({
        employeeId: '',
        search: '',
        status: '',
        dateFrom: '',
        dateTo: ''
    })
    const [page, setPage] = useState(1)
    // Held for ten seconds after arriving via ?highlight=, then released
    // so a card that remounts later does not scroll and pulse again. See
    // lib/useFadingHighlight.ts.
    const highlightId = useFadingHighlight(searchParams.get('highlight'), 10_000)


    let requestsUrl = `/api/requests?sortBy=${sortBy}&order=${order}&page=${page}&limit=10`
    if (selectedCompanyId) requestsUrl += `&companyId=${selectedCompanyId}`
    if (filters.search) requestsUrl += `&search=${encodeURIComponent(filters.search)}`
    if (filters.status) requestsUrl += `&status=${filters.status}`
    if (filters.employeeId) requestsUrl += `&userId=${filters.employeeId}`
    // Keyed by the whole query, so an answer for filters that have since
    // changed can never land on top of the current ones. The previous page
    // stays up while the next loads, as it did before.
    const { data: result, isLoading: loading, mutate: fetchRequests } = useSWR(requestsUrl, fetcher, { keepPreviousData: true })
    const listed = result?.success ? result.data : undefined
    const requests: any[] = listed?.data || NO_REQUESTS
    const total: number = listed?.total || 0
    const totalPages: number = listed?.totalPages || 0

    // Back to page 1 in the same render the filters change, so the first
    // fetch for the new filters already asks for page 1. As an effect this
    // fetched the old page of the new results first, then page 1 — two
    // requests, and a list and pager that disagreed if they came back out of
    // order. See lib/useAdjustOnChange.ts.
    useAdjustOnChange([selectedCompanyId, filters, sortBy, order], () => setPage(1))

    const handleCreateRequest = async (title: string, details: string) => {
        try {
            const body: any = { title, details }
            if (userRole === 'SUPER_ADMIN' && selectedCompanyId) {
                body.companyId = selectedCompanyId
            }

            const res = await fetch('/api/requests', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            })
            if (res.ok) {
                showToast(t('request_submitted_success') || 'Request submitted successfully', 'success')
                fetchRequests()
            } else {
                showToast(t('failed_submit_request') || 'Failed to submit request', 'error')
            }
        } catch {
            showToast(t('error_generic'), 'error')
        }
    }

    const handleStatusUpdate = async (id: string, status: string) => {
        try {
            const res = await fetch(`/api/requests/${id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ status })
            })
            if (res.ok) {
                const result = await res.json()
                const updatedRequest = result.data
                showToast(t('request_action_success') || 'Status updated', 'success')
                fetchRequests()
                if (selectedRequest && selectedRequest.id === id) {
                    setSelectedRequest({ ...selectedRequest, ...updatedRequest })
                }
            } else {
                showToast(t('error_generic'), 'error')
            }
        } catch {
            showToast(t('error_generic'), 'error')
        }
    }

    const handleDeleteRequest = async (id: string) => {
        try {
            const res = await fetch(`/api/requests/${id}`, {
                method: 'DELETE'
            })
            if (res.ok) {
                showToast(t('item_deleted_success' as any) || 'Request deleted successfully', 'success')
                setIsViewModalOpen(false)
                fetchRequests()
            } else {
                showToast(t('error_generic'), 'error')
            }
        } catch {
            showToast(t('error_generic'), 'error')
        }
    }

    const handleViewRequest = (request: any) => {
        setSelectedRequest(request)
        setIsViewModalOpen(true)
    }

    return (
        <section style={{ marginBottom: '3rem' }}>
            <style>{`
                @keyframes popIn { 
                    from { opacity: 0; transform: translateY(-8px); } 
                    to { opacity: 1; transform: translateY(0); } 
                }
            `}</style>

            {/* History Button Row - Restore to old place */}
            <div style={{
                display: 'flex',
                justifyContent: locale === 'ar' ? 'flex-start' : 'flex-end',
                marginBottom: '1rem'
            }}>
                <Link
                    href="/dashboard/requests/history"
                    className="btn"
                    style={{
                        padding: '0 1.5rem',
                        height: '48px',
                        fontSize: '0.95rem',
                        background: 'color-mix(in srgb, var(--warn-bg) 40%, transparent)',
                        color: 'var(--warn-fg-mid)',
                        border: '1px solid color-mix(in srgb, var(--warn-border) 30%, transparent)',
                        fontWeight: '800',
                        borderRadius: '1.25rem',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.5rem',
                        backdropFilter: 'blur(10px)',
                        textDecoration: 'none',
                        boxShadow: '0 4px 12px color-mix(in srgb, var(--warn-border) 10%, transparent)'
                    }}
                >
                    📜 {t('history')}
                </Link>
            </div>

            {/* Employee Filter & Toolbar */}
            <EmployeeFilter
                onFilterChange={(newFilters) => {
                    setFilters(prev => ({ ...prev, ...newFilters }))
                }}
                selectedEmployeeId={filters.employeeId}
                dateFrom={filters.dateFrom}
                dateTo={filters.dateTo}
                totalCount={total}
                selectedStatus={filters.status}
                searchQuery={filters.search}
                placeholder={t('search_by_title')}
                isEmployee={!seesOthersRequests}
                sortBy={sortBy}
                sortOrder={order as any}
                onSortChange={(field, ord) => {
                    setSortBy(field)
                    setOrder(ord)
                }}
                sortOptions={[
                    { label: t('date_updated'), value: 'updatedAt' },
                    { label: t('date_created'), value: 'createdAt' },
                ]}
                statusOptions={[
                    { label: t('status_pending'), value: 'PENDING' },
                    { label: t('status_in_progress'), value: 'IN_PROGRESS' },
                ]}
                hideDateFilter={true}
                primaryAction={
                    <button
                        onClick={() => setIsCreateModalOpen(true)}
                        className="btn btn-primary"
                        style={{
                            padding: '0 1.5rem',
                            height: '48px',
                            fontSize: '0.95rem',
                            fontWeight: '800',
                            borderRadius: '1.25rem',
                            background: 'linear-gradient(135deg, var(--brand-primary) 0%, var(--accent-solid) 100%)',
                            border: 'none',
                            color: 'var(--text-on-accent)',
                            boxShadow: '0 4px 15px color-mix(in srgb, var(--primary) 30%, transparent)',
                            whiteSpace: 'nowrap',
                            display: 'flex',
                            alignItems: 'center'
                        }}
                    >
                        {t('make_a_request')}
                    </button>
                }
            />

            {loading ? (
                <div className="card" style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-soft)' }}>
                    {t('loading_data')}
                </div>
            ) : requests.length === 0 ? (
                <div className="card" style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-faint)' }}>
                    {t('no_requests_found')}
                </div>
            ) : (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(350px, 100%), 1fr))', gap: '1.25rem' }}>
                    {requests.map(req => (
                        <RequestCard
                            key={req.id}
                            request={req}
                            onView={handleViewRequest}
                            onStatusUpdate={handleStatusUpdate}
                            isHighlighted={req.id === highlightId}
                        />
                    ))}
                </div>
            )}

            <Pagination
                currentPage={page}
                totalPages={totalPages}
                onPageChange={(p) => setPage(p)}
            />

            <CreateRequestModal
                isOpen={isCreateModalOpen}
                onClose={() => setIsCreateModalOpen(false)}
                onSubmit={handleCreateRequest}
            />

            <ViewRequestModal
                isOpen={isViewModalOpen}
                onClose={() => setIsViewModalOpen(false)}
                request={selectedRequest}
                userRole={userRole}
                onDelete={handleDeleteRequest}
                onStatusUpdate={handleStatusUpdate}
            />
        </section>
    )
}

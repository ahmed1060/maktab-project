'use client'
import { useState } from 'react'
import useSWR from 'swr'
import { fetcher } from '@/lib/swr-fetcher'
import { useLanguage } from '@/context/LanguageContext'
import RequestCard from '@/components/requests/RequestCard'
import ViewRequestModal from '@/components/requests/ViewRequestModal'
import Link from 'next/link'
import { useToast } from '@/context/ToastContext'
import { useCompany } from '@/context/CompanyContext'
import { useSearchParams } from 'next/navigation'
import EmployeeFilter from '@/components/EmployeeFilter'
import Pagination from '@/components/Pagination'
import { useFadingHighlight } from '@/lib/useFadingHighlight'
import { useAdjustOnChange } from '@/lib/useAdjustOnChange'
import { useCan } from '@/lib/useCan'

const NO_REQUESTS: any[] = []

export default function RequestsHistoryClient({ userRole }: { userRole: string }) {
    const { t, locale } = useLanguage()
    const seesOthersRequests = useCan().can('requests.view')
    const { showToast } = useToast()
    const { selectedCompanyId } = useCompany()
    const [selectedRequest, setSelectedRequest] = useState<any>(null)
    const [isViewModalOpen, setIsViewModalOpen] = useState(false)
    const [sortBy, setSortBy] = useState('updatedAt')
    const [order, setOrder] = useState('desc')
    // Filter states
    const [filters, setFilters] = useState({
        employeeId: '',
        search: '',
        status: '',
        dateFrom: '',
        dateTo: ''
    })
    const [page, setPage] = useState(1)
    const searchParams = useSearchParams()
    // Held for ten seconds after arriving via ?highlight=, then released
    // so a card that remounts later does not scroll and pulse again. See
    // lib/useFadingHighlight.ts.
    const highlightId = useFadingHighlight(searchParams.get('highlight'), 10_000)

    let historyUrl = `/api/requests?history=true&sortBy=${sortBy}&order=${order}&page=${page}&limit=10`
    if (filters.search) historyUrl += `&search=${encodeURIComponent(filters.search)}`
    if (filters.employeeId) historyUrl += `&userId=${filters.employeeId}`
    if (selectedCompanyId) historyUrl += `&companyId=${selectedCompanyId}`
    // Keyed by the whole query, so an answer for filters that have since
    // changed can never land on top of the current ones. The previous page
    // stays up while the next loads, as it did before.
    const { data: result, isLoading: loading, mutate: fetchHistory } = useSWR(historyUrl, fetcher, { keepPreviousData: true })
    const requests: any[] = result?.data?.data || NO_REQUESTS
    const total: number = result?.data?.total || 0
    const totalPages: number = result?.data?.totalPages || 0

    // Back to page 1 in the same render the filters change, so the first
    // fetch for the new filters already asks for page 1. As an effect this
    // fetched the old page of the new results first, then page 1 — two
    // requests, and a list and pager that disagreed if they came back out of
    // order. See lib/useAdjustOnChange.ts.
    useAdjustOnChange([filters, selectedCompanyId, sortBy, order], () => setPage(1))

    const handleDeleteRequest = async (id: string) => {
        try {
            const res = await fetch(`/api/requests/${id}`, {
                method: 'DELETE'
            })
            if (res.ok) {
                showToast(t('item_deleted_success' as any) || 'Request deleted successfully', 'success')
                setIsViewModalOpen(false)
                fetchHistory()
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
                fetchHistory()
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

    return (
        <section style={{ padding: '0', marginBottom: '3rem' }}>
            <style>{`
                @keyframes popIn { 
                    from { opacity: 0; transform: translateY(-8px); } 
                    to { opacity: 1; transform: translateY(0); } 
                }
            `}</style>


            {/* Back Button Row - Restore to old place */}
            <div style={{
                display: 'flex',
                justifyContent: 'flex-start',
                marginBottom: '1rem'
            }}>
                <Link
                    href="/dashboard/requests"
                    className="glass"
                    style={{
                        width: '40px',
                        height: '40px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: 'var(--brand-primary-text)',
                        textDecoration: 'none',
                        transition: 'all 0.3s ease',
                        border: '1px solid var(--veil-40)',
                        borderRadius: '0.75rem',
                        background: 'var(--veil-40)',
                        backdropFilter: 'blur(8px)',
                        transform: locale === 'ar' ? 'scaleX(-1)' : 'none'
                    }}
                    title={t('back_to_requests')}
                >
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <line x1="19" y1="12" x2="5" y2="12"></line>
                        <polyline points="12 19 5 12 12 5"></polyline>
                    </svg>
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
                hideStatusFilter={true}
                hideDateFilter={true}
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

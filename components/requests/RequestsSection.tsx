'use client'
import { useState, useEffect } from 'react'
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


export default function RequestsSection({ userRole }: { userRole: string }) {
    const { t, locale } = useLanguage()
    const { showToast } = useToast()
    const { selectedCompanyId } = useCompany()
    const searchParams = useSearchParams()
    const [requests, setRequests] = useState<any[]>([])
    const [loading, setLoading] = useState(true)
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
    const [total, setTotal] = useState(0)
    const [totalPages, setTotalPages] = useState(0)
    const [highlightId, setHighlightId] = useState<string | null>(null)


    const fetchRequests = async () => {
        try {
            let url = `/api/requests?sortBy=${sortBy}&order=${order}&page=${page}&limit=10`
            if (selectedCompanyId) url += `&companyId=${selectedCompanyId}`
            if (filters.search) url += `&search=${encodeURIComponent(filters.search)}`
            if (filters.status) url += `&status=${filters.status}`
            if (filters.employeeId) url += `&userId=${filters.employeeId}`

            const res = await fetch(url)
            if (res.ok) {
                const data = await res.json()
                setRequests(data.data || [])
                setTotal(data.total || 0)
                setTotalPages(data.totalPages || 0)
            }
        } catch (error) {
            console.error("Error fetching requests:", error)
        } finally {
            setLoading(false)
        }
    }

    useEffect(() => {
        fetchRequests()
    }, [selectedCompanyId, filters, sortBy, order, page])

    useEffect(() => {
        setPage(1)
    }, [selectedCompanyId, filters, sortBy, order])

    useEffect(() => {
        const highlight = searchParams.get('highlight')
        if (highlight) {
            setHighlightId(highlight)
        }
    }, [searchParams])

    useEffect(() => {
        if (highlightId && requests.length > 0) {
            const req = requests.find(r => r.id === highlightId)
            if (req) {
                // We no longer auto-open the modal
                // Instead, we let the RequestCard show the highlight

                // Clear highlight after 10 seconds to stop the pulse
                const timer = setTimeout(() => setHighlightId(null), 10000)
                return () => clearTimeout(timer)
            }
        }
    }, [highlightId, requests])

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
        } catch (error) {
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
                const updatedData = await res.json()
                showToast(t('request_action_success') || 'Status updated', 'success')
                fetchRequests()
                if (selectedRequest && selectedRequest.id === id) {
                    setSelectedRequest({ ...selectedRequest, ...updatedData })
                }
            } else {
                showToast(t('error_generic'), 'error')
            }
        } catch (error) {
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
        } catch (error) {
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
                        background: 'rgba(254, 243, 199, 0.4)',
                        color: '#b45309',
                        border: '1px solid rgba(251, 191, 36, 0.3)',
                        fontWeight: '800',
                        borderRadius: '1.25rem',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.5rem',
                        backdropFilter: 'blur(10px)',
                        textDecoration: 'none',
                        boxShadow: '0 4px 12px rgba(251, 191, 36, 0.1)'
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
                isEmployee={userRole === 'EMPLOYEE'}
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
                            background: 'linear-gradient(135deg, #6366f1 0%, #a855f7 100%)',
                            border: 'none',
                            color: 'white',
                            boxShadow: '0 4px 15px rgba(99, 102, 241, 0.3)',
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
                <div className="card" style={{ padding: '2rem', textAlign: 'center', color: '#64748b' }}>
                    {t('loading_data')}
                </div>
            ) : requests.length === 0 ? (
                <div className="card" style={{ padding: '2rem', textAlign: 'center', color: '#94a3b8' }}>
                    {t('no_requests_found')}
                </div>
            ) : (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(350px, 1fr))', gap: '1.25rem' }}>
                    {requests.map(req => (
                        <RequestCard
                            key={req.id}
                            request={req}
                            userRole={userRole}
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

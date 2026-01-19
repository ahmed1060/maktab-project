'use client'
import { useState, useEffect } from 'react'
import { useLanguage } from '@/context/LanguageContext'
import RequestCard from '@/components/requests/RequestCard'
import ViewRequestModal from '@/components/requests/ViewRequestModal'
import Link from 'next/link'
import { useToast } from '@/context/ToastContext'
import { useCompany } from '@/context/CompanyContext'
import EmployeeFilter from '@/components/EmployeeFilter'
import Pagination from '@/components/Pagination'

export default function RequestsHistoryClient({ userRole }: { userRole: string }) {
    const { t, locale } = useLanguage()
    const { showToast } = useToast()
    const { selectedCompanyId } = useCompany()
    const [requests, setRequests] = useState<any[]>([])
    const [loading, setLoading] = useState(true)
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
    const [total, setTotal] = useState(0)
    const [totalPages, setTotalPages] = useState(0)

    const fetchHistory = async () => {
        try {
            let url = `/api/requests?history=true&sortBy=${sortBy}&order=${order}&page=${page}&limit=10`
            if (filters.search) url += `&search=${encodeURIComponent(filters.search)}`
            if (filters.employeeId) url += `&userId=${filters.employeeId}`
            if (selectedCompanyId) url += `&companyId=${selectedCompanyId}`

            const res = await fetch(url)
            if (res.ok) {
                const data = await res.json()
                setRequests(data.data || [])
                setTotal(data.total || 0)
                setTotalPages(data.totalPages || 0)
            }
        } catch (error) {
            console.error("Error fetching history:", error)
        } finally {
            setLoading(false)
        }
    }

    useEffect(() => {
        fetchHistory()
    }, [filters, selectedCompanyId, sortBy, order, page])

    useEffect(() => {
        setPage(1)
    }, [filters, selectedCompanyId, sortBy, order])

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
        } catch (error) {
            showToast(t('error_generic'), 'error')
        }
    }

    const handleViewRequest = (request: any) => {
        setSelectedRequest(request)
        setIsViewModalOpen(true)
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
                        color: '#6366f1',
                        textDecoration: 'none',
                        transition: 'all 0.3s ease',
                        border: '1px solid rgba(255, 255, 255, 0.4)',
                        borderRadius: '0.75rem',
                        background: 'rgba(255, 255, 255, 0.4)',
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
                hideStatusFilter={true}
                hideDateFilter={true}
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
            />
        </section>
    )
}

'use client'
import { useState, useEffect } from 'react'
import { useLanguage } from '@/context/LanguageContext'
import RequestCard from '@/components/requests/RequestCard'
import ViewRequestModal from '@/components/requests/ViewRequestModal'
import Link from 'next/link'

export default function RequestsHistoryClient({ userRole }: { userRole: string }) {
    const { t, locale } = useLanguage()
    const [requests, setRequests] = useState<any[]>([])
    const [loading, setLoading] = useState(true)
    const [selectedRequest, setSelectedRequest] = useState<any>(null)
    const [isViewModalOpen, setIsViewModalOpen] = useState(false)
    const [search, setSearch] = useState('')
    const [filterUserId, setFilterUserId] = useState('')
    const [employees, setEmployees] = useState<any[]>([])

    const fetchEmployees = async () => {
        if (!['ADMIN', 'SUPER_ADMIN', 'TEAM_LEADER'].includes(userRole)) return
        try {
            const res = await fetch('/api/users?limit=100')
            if (res.ok) {
                const data = await res.json()
                setEmployees(data.data || [])
            }
        } catch (error) {
            console.error("Error fetching employees:", error)
        }
    }

    const fetchHistory = async () => {
        try {
            let url = '/api/requests?history=true'
            if (search) url += `&search=${encodeURIComponent(search)}`
            if (filterUserId) url += `&userId=${filterUserId}`

            const res = await fetch(url)
            if (res.ok) {
                const data = await res.json()
                setRequests(data)
            }
        } catch (error) {
            console.error("Error fetching history:", error)
        } finally {
            setLoading(false)
        }
    }

    useEffect(() => {
        fetchHistory()
    }, [search, filterUserId])

    useEffect(() => {
        fetchEmployees()
    }, [])

    const handleViewRequest = (request: any) => {
        setSelectedRequest(request)
        setIsViewModalOpen(true)
    }

    return (
        <div style={{ padding: '2rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '2rem', flexDirection: locale === 'ar' ? 'row-reverse' : 'row' }}>
                <Link href="/dashboard/requests" className="btn" style={{ background: '#f1f5f9', color: '#64748b', padding: '0.5rem 1rem' }}>
                    {locale === 'ar' ? '← العودة' : '← Back'}
                </Link>
                <h1 style={{ fontSize: '2rem', fontWeight: '800', color: '#1e293b', margin: 0 }}>
                    📜 {t('requests_history')}
                </h1>
            </div>

            <div style={{ display: 'flex', gap: '1rem', marginBottom: '2rem', flexWrap: 'wrap', flexDirection: locale === 'ar' ? 'row-reverse' : 'row' }}>
                <div style={{ position: 'relative', flex: 1, minWidth: '250px' }}>
                    <input
                        type="text"
                        placeholder={t('search_by_title')}
                        className="input"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        style={{ paddingInlineStart: '2.5rem' }}
                    />
                    <span style={{ position: 'absolute', [locale === 'ar' ? 'right' : 'left']: '1rem', top: '50%', transform: 'translateY(-50%)', opacity: 0.5 }}>🔍</span>
                </div>

                {['ADMIN', 'SUPER_ADMIN', 'TEAM_LEADER'].includes(userRole) && (
                    <div style={{ minWidth: '200px' }}>
                        <select
                            className="input"
                            value={filterUserId}
                            onChange={(e) => setFilterUserId(e.target.value)}
                        >
                            <option value="">{t('all_employees')}</option>
                            {employees.map(emp => (
                                <option key={emp.id} value={emp.id}>{emp.firstName} {emp.lastName}</option>
                            ))}
                        </select>
                    </div>
                )}
            </div>

            {loading ? (
                <div className="glass-card" style={{ padding: '3rem', textAlign: 'center', color: '#64748b' }}>
                    {t('loading_data')}
                </div>
            ) : requests.length === 0 ? (
                <div className="glass-card" style={{ padding: '3rem', textAlign: 'center', color: '#94a3b8' }}>
                    {t('no_requests_found')}
                </div>
            ) : (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(350px, 1fr))', gap: '1.5rem' }}>
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

            <ViewRequestModal
                isOpen={isViewModalOpen}
                onClose={() => setIsViewModalOpen(false)}
                request={selectedRequest}
            />
        </div>
    )
}

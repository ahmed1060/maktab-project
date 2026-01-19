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

    useEffect(() => {
        const fetchHistory = async () => {
            try {
                const res = await fetch('/api/requests?history=true')
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
        fetchHistory()
    }, [])

    const handleViewRequest = (request: any) => {
        setSelectedRequest(request)
        setIsViewModalOpen(true)
    }

    return (
        <div style={{ padding: '2rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '2rem', flexDirection: locale === 'ar' ? 'row-reverse' : 'row' }}>
                <Link href="/dashboard" className="btn" style={{ background: '#f1f5f9', color: '#64748b', padding: '0.5rem 1rem' }}>
                    {locale === 'ar' ? '← العودة' : '← Back'}
                </Link>
                <h1 style={{ fontSize: '2rem', fontWeight: '800', color: '#1e293b', margin: 0 }}>
                    📜 {t('requests_history') || (locale === 'ar' ? 'سجل الطلبات' : 'Requests History')}
                </h1>
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

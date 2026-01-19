'use client'
import { useState } from 'react'
import { useLanguage } from '@/context/LanguageContext'

interface RequestCardProps {
    request: any
    userRole: string
    onView: (request: any) => void
    onStatusUpdate?: (id: string, status: string) => Promise<void>
}

export default function RequestCard({ request, userRole, onView, onStatusUpdate }: RequestCardProps) {
    const { t, locale } = useLanguage()
    const [updating, setUpdating] = useState(false)

    const handleUpdate = async (status: string) => {
        if (!onStatusUpdate || updating) return
        setUpdating(true)
        try {
            await onStatusUpdate(request.id, status)
        } finally {
            setUpdating(false)
        }
    }

    const isAdmin = ['ADMIN', 'SUPER_ADMIN', 'TEAM_LEADER'].includes(userRole)

    return (
        <div className="glass-card" style={{ padding: '1.25rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', transition: 'all 0.2s', borderLeft: locale === 'ar' ? 'none' : '4px solid #6366f1', borderRight: locale === 'ar' ? '4px solid #6366f1' : 'none' }}>
            <div style={{ flex: 1, textAlign: locale === 'ar' ? 'right' : 'left' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.25rem', flexDirection: locale === 'ar' ? 'row-reverse' : 'row' }}>
                    <h3 style={{ fontSize: '1.1rem', fontWeight: '700', margin: 0, color: '#1e293b' }}>{request.title}</h3>
                    <span className="badge" style={{
                        background: request.status === 'PENDING' ? '#fef9c3' : request.status === 'IN_PROGRESS' ? '#e0f2fe' : '#dcfce7',
                        color: request.status === 'PENDING' ? '#854d0e' : request.status === 'IN_PROGRESS' ? '#0369a1' : '#166534',
                        fontSize: '0.7rem'
                    }}>
                        {t(`status_${request.status.toLowerCase()}` as any)}
                    </span>
                </div>
                {isAdmin && request.user && (
                    <div style={{ fontSize: '0.85rem', color: '#64748b' }}>
                        {t('by' as any) || 'By'}: {request.user.firstName} {request.user.lastName}
                    </div>
                )}
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexDirection: locale === 'ar' ? 'row-reverse' : 'row' }}>
                <button
                    onClick={() => onView(request)}
                    className="btn"
                    style={{
                        padding: '0.4rem 0.8rem',
                        fontSize: '0.85rem',
                        background: 'rgba(255,255,255,0.5)',
                        border: '1px solid rgba(0,0,0,0.1)',
                        color: '#6366f1',
                        fontWeight: '600'
                    }}
                >
                    {t('view_request' as any) || 'View Request'}
                </button>

                {isAdmin && request.status !== 'COMPLETED' && (
                    <button
                        onClick={() => handleUpdate(request.status === 'PENDING' ? 'IN_PROGRESS' : 'COMPLETED')}
                        disabled={updating}
                        style={{
                            background: request.status === 'PENDING' ? '#e0f2fe' : '#dcfce7',
                            border: `1px solid ${request.status === 'PENDING' ? '#38bdf8' : '#22c55e'}`,
                            color: request.status === 'PENDING' ? '#0369a1' : '#166534',
                            width: '36px',
                            height: '36px',
                            borderRadius: '50%',
                            cursor: updating ? 'not-allowed' : 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            transition: 'all 0.2s',
                            boxShadow: '0 4px 6px -1px rgba(0,0,0,0.1)'
                        }}
                        title={request.status === 'PENDING' ? (locale === 'ar' ? 'قيد التنفيذ' : 'Mark In Progress') : (locale === 'ar' ? 'مكتمل' : 'Mark Completed')}
                    >
                        {updating ? (
                            <div className="animate-spin-local" style={{ width: '16px', height: '16px', border: `2px solid ${request.status === 'PENDING' ? '#0369a1' : '#166534'}`, borderTopColor: 'transparent', borderRadius: '50%' }} />
                        ) : '✓'}
                    </button>
                )}
            </div>
            <style jsx>{`
                .animate-spin-local {
                    animation: spin 1s linear infinite;
                }
                @keyframes spin {
                    from { transform: rotate(0deg); }
                    to { transform: rotate(360deg); }
                }
            `}</style>
        </div>
    )
}

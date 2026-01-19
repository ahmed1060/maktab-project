import { useState } from 'react'
import Modal from '@/components/Modal'
import { useLanguage } from '@/context/LanguageContext'

interface ViewRequestModalProps {
    isOpen: boolean
    onClose: () => void
    request: any
    userRole: string
    onDelete: (id: string) => Promise<void>
    onStatusUpdate?: (id: string, status: string) => Promise<void>
}

export default function ViewRequestModal({ isOpen, onClose, request, userRole, onDelete, onStatusUpdate }: ViewRequestModalProps) {
    const { t, locale } = useLanguage()
    const [updating, setUpdating] = useState(false)

    if (!request) return null

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
        <Modal
            isOpen={isOpen}
            onClose={onClose}
            title={t('request_details')}
        >
            <div>
                <div style={{ marginBottom: '1.5rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '1rem' }}>
                        <h3 style={{ margin: '0 0 0.5rem 0', color: '#1e293b', fontSize: '1.25rem', flex: 1 }}>{request.title}</h3>

                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', alignItems: 'flex-end' }}>
                            {(request.status !== 'COMPLETED' || userRole === 'SUPER_ADMIN') && (
                                <button
                                    onClick={() => {
                                        if (confirm(t('confirm_item_delete'))) {
                                            onDelete(request.id)
                                        }
                                    }}
                                    className="btn"
                                    style={{
                                        background: '#fef2f2',
                                        color: '#dc2626',
                                        padding: '0.4rem 0.85rem',
                                        fontSize: '0.8125rem',
                                        border: 'none',
                                        borderRadius: '0.75rem',
                                        cursor: 'pointer',
                                        whiteSpace: 'nowrap',
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '0.4rem'
                                    }}
                                >
                                    🗑️ {t('delete')}
                                </button>
                            )}

                            {isAdmin && request.status !== 'COMPLETED' && (
                                <button
                                    onClick={() => handleUpdate(request.status === 'PENDING' ? 'IN_PROGRESS' : 'COMPLETED')}
                                    disabled={updating}
                                    style={{
                                        background: request.status === 'PENDING' ? '#e0f2fe' : '#dcfce7',
                                        border: `1px solid ${request.status === 'PENDING' ? '#38bdf8' : '#22c55e'}`,
                                        color: request.status === 'PENDING' ? '#0369a1' : '#166534',
                                        padding: '0.4rem 0.85rem',
                                        borderRadius: '0.75rem',
                                        fontSize: '0.8125rem',
                                        fontWeight: '600',
                                        cursor: updating ? 'not-allowed' : 'pointer',
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '0.4rem',
                                        transition: 'all 0.2s',
                                        boxShadow: '0 4px 6px -1px rgba(0,0,0,0.1)'
                                    }}
                                    title={request.status === 'PENDING' ? t('mark_in_progress' as any) : t('mark_completed' as any)}
                                >
                                    {updating ? (
                                        <div className="animate-spin-local" style={{ width: '14px', height: '14px', border: `2px solid ${request.status === 'PENDING' ? '#0369a1' : '#166534'}`, borderTopColor: 'transparent', borderRadius: '50%' }} />
                                    ) : (
                                        <span style={{ fontSize: '1rem' }}>✓</span>
                                    )}
                                    {request.status === 'PENDING' ? t('mark_in_progress' as any) : t('mark_completed' as any)}
                                </button>
                            )}
                        </div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                        <span className="badge" style={{
                            background: request.status === 'PENDING' ? '#fef9c3' : request.status === 'IN_PROGRESS' ? '#e0f2fe' : '#dcfce7',
                            color: request.status === 'PENDING' ? '#854d0e' : request.status === 'IN_PROGRESS' ? '#0369a1' : '#166534',
                            fontSize: '0.75rem',
                            fontWeight: '600'
                        }} title={t(`status_${request.status.toLowerCase()}` as any)}>
                            {t(`status_${request.status.toLowerCase()}` as any)}
                        </span>
                        <span style={{ fontSize: '0.85rem', color: '#94a3b8' }}>
                            {new Date(request.createdAt).toLocaleString(locale)}
                        </span>
                    </div>
                </div>

                {request.user && (
                    <div style={{ padding: '1rem', background: '#f8fafc', borderRadius: '0.75rem', marginBottom: '1.5rem', display: 'flex', alignItems: 'center', gap: '1rem' }}>
                        <div style={{
                            width: '40px',
                            height: '40px',
                            borderRadius: '50%',
                            background: '#e2e8f0',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontSize: '1rem',
                            overflow: 'hidden'
                        }}>
                            {request.user.avatar ? (
                                <img src={request.user.avatar} alt="avatar" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                            ) : (
                                <span>{(request.user.firstName?.[0] || 'U').toUpperCase()}</span>
                            )}
                        </div>
                        <div>
                            <div style={{ fontWeight: '600', color: '#334155' }}>{request.user.firstName} {request.user.lastName}</div>
                            <div style={{ fontSize: '0.75rem', color: '#64748b' }}>{request.user.role}</div>
                        </div>
                    </div>
                )}

                <div style={{
                    marginBottom: '1.5rem',
                    padding: '1rem',
                    background: 'rgba(99, 102, 241, 0.03)',
                    border: '1px dashed rgba(99, 102, 241, 0.2)',
                    borderRadius: '0.75rem',
                    fontSize: '0.85rem'
                }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem', color: '#64748b' }}>
                        <span>📅 {t('requested_on')}:</span>
                        <span style={{ fontWeight: '600', color: '#334155' }}>{new Date(request.createdAt).toLocaleString(locale)}</span>
                    </div>
                    {request.inProgressAt && (
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem', color: '#64748b' }}>
                            <span>🚀 {t('started_at')}:</span>
                            <span style={{ fontWeight: '600', color: '#334155' }}>{new Date(request.inProgressAt).toLocaleString(locale)}</span>
                        </div>
                    )}
                    {request.completedAt && (
                        <div style={{ display: 'flex', justifyContent: 'space-between', color: '#64748b' }}>
                            <span>✅ {t('finished_at')}:</span>
                            <span style={{ fontWeight: '600', color: '#334155' }}>{new Date(request.completedAt).toLocaleString(locale)}</span>
                        </div>
                    )}
                </div>

                <div style={{
                    whiteSpace: 'pre-wrap',
                    color: '#475569',
                    lineHeight: '1.7',
                    padding: '1.5rem',
                    background: 'white',
                    border: '1px solid #f1f5f9',
                    borderRadius: '0.75rem',
                    minHeight: '150px'
                }}>
                    {request.details}
                </div>
            </div>
        </Modal>
    )
}

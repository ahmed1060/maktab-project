'use client'
import Modal from '@/components/Modal'
import { useLanguage } from '@/context/LanguageContext'

interface ViewRequestModalProps {
    isOpen: boolean
    onClose: () => void
    request: any
}

export default function ViewRequestModal({ isOpen, onClose, request }: ViewRequestModalProps) {
    const { t, locale } = useLanguage()

    if (!request) return null

    return (
        <Modal
            isOpen={isOpen}
            onClose={onClose}
            title={t('request_details' as any) || (locale === 'ar' ? 'تفاصيل الطلب' : 'Request Details')}
        >
            <div style={{ textAlign: locale === 'ar' ? 'right' : 'left' }}>
                <div style={{ marginBottom: '1.5rem' }}>
                    <h3 style={{ margin: '0 0 0.5rem 0', color: '#1e293b', fontSize: '1.25rem' }}>{request.title}</h3>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexDirection: locale === 'ar' ? 'row-reverse' : 'row' }}>
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
                    <div style={{ padding: '1rem', background: '#f8fafc', borderRadius: '0.75rem', marginBottom: '1.5rem', display: 'flex', alignItems: 'center', gap: '1rem', flexDirection: locale === 'ar' ? 'row-reverse' : 'row' }}>
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

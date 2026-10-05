import { useState } from 'react'
import Image from 'next/image'
import Modal from '@/components/Modal'
import ConfirmModal from '@/components/ConfirmModal'
import { useLanguage } from '@/context/LanguageContext'
import { useCan } from '@/lib/useCan'

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
    const [confirmingDelete, setConfirmingDelete] = useState(false)
    const canReview = useCan().can('requests.review')

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

    return (
        <Modal
            isOpen={isOpen}
            onClose={onClose}
            title={t('request_details')}
        >
            <div>
                <div style={{ marginBottom: '1.5rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '1rem' }}>
                        <h3 style={{ margin: '0 0 0.5rem 0', color: 'var(--text-main)', fontSize: '1.25rem', flex: 1 }}>{request.title}</h3>

                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', alignItems: 'flex-end' }}>
                            {(request.status !== 'COMPLETED' || userRole === 'SUPER_ADMIN') && (
                                <button
                                    onClick={() => setConfirmingDelete(true)}
                                    className="btn"
                                    style={{
                                        background: 'var(--danger-bg-subtle)',
                                        color: 'var(--danger-fg-strong)',
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
                                    <span aria-hidden="true">🗑️</span> {t('delete')}
                                </button>
                            )}

                            {canReview && request.status !== 'COMPLETED' && (
                                <button
                                    onClick={() => handleUpdate(request.status === 'PENDING' ? 'IN_PROGRESS' : 'COMPLETED')}
                                    disabled={updating}
                                    style={{
                                        background: request.status === 'PENDING' ? 'var(--info-bg)' : 'var(--ok-bg)',
                                        border: `1px solid ${request.status === 'PENDING' ? 'var(--info-solid-sky-light)' : 'var(--ok-solid-alt)'}`,
                                        color: request.status === 'PENDING' ? 'var(--info-fg)' : 'var(--ok-fg)',
                                        padding: '0.4rem 0.85rem',
                                        borderRadius: '0.75rem',
                                        fontSize: '0.8125rem',
                                        fontWeight: '600',
                                        cursor: updating ? 'not-allowed' : 'pointer',
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '0.4rem',
                                        transition: 'all 0.2s',
                                        boxShadow: '0 4px 6px -1px var(--shadow-weak)'
                                    }}
                                    title={request.status === 'PENDING' ? t('mark_in_progress' as any) : t('mark_completed' as any)}
                                >
                                    {updating ? (
                                        <div className="animate-spin-local" style={{ width: '14px', height: '14px', border: `2px solid ${request.status === 'PENDING' ? 'var(--info-fg)' : 'var(--ok-fg)'}`, borderTopColor: 'transparent', borderRadius: '50%' }} />
                                    ) : (
                                        <span aria-hidden="true" style={{ fontSize: '1rem' }}>✓</span>
                                    )}
                                    {request.status === 'PENDING' ? t('mark_in_progress' as any) : t('mark_completed' as any)}
                                </button>
                            )}
                        </div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                        <span className="badge" style={{
                            background: request.status === 'PENDING' ? 'var(--warn-bg-yellow)' : request.status === 'IN_PROGRESS' ? 'var(--info-bg)' : 'var(--ok-bg)',
                            color: request.status === 'PENDING' ? 'var(--warn-fg-yellow)' : request.status === 'IN_PROGRESS' ? 'var(--info-fg)' : 'var(--ok-fg)',
                            fontSize: '0.75rem',
                            fontWeight: '600'
                        }} title={t(`status_${request.status.toLowerCase()}` as any)}>
                            {t(`status_${request.status.toLowerCase()}` as any)}
                        </span>
                        <span style={{ fontSize: '0.85rem', color: 'var(--text-faint)' }}>
                            {new Date(request.createdAt).toLocaleString(locale)}
                        </span>
                    </div>
                </div>

                {request.user && (
                    <div style={{ padding: '1rem', background: 'var(--surface-subtle)', borderRadius: '0.75rem', marginBottom: '1.5rem', display: 'flex', alignItems: 'center', gap: '1rem' }}>
                        <div style={{
                            width: '40px',
                            height: '40px',
                            borderRadius: '50%',
                            background: 'var(--border)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontSize: '1rem',
                            overflow: 'hidden'
                        }}>
                            {request.user.avatar ? (
                                <Image src={request.user.avatar} alt="avatar" width={40} height={40} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                            ) : (
                                <span>{(request.user.firstName?.[0] || 'U').toUpperCase()}</span>
                            )}
                        </div>
                        <div>
                            <div style={{ fontWeight: '600', color: 'var(--text-body)' }}>{request.user.firstName} {request.user.lastName}</div>
                            <div style={{ fontSize: '0.75rem', color: 'var(--text-soft)' }}>{request.user.role}</div>
                        </div>
                    </div>
                )}

                <div style={{
                    marginBottom: '1.5rem',
                    padding: '1rem',
                    background: 'color-mix(in srgb, var(--primary) 3%, transparent)',
                    border: '1px dashed color-mix(in srgb, var(--primary) 20%, transparent)',
                    borderRadius: '0.75rem',
                    fontSize: '0.85rem'
                }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem', color: 'var(--text-soft)' }}>
                        <span><span aria-hidden="true">📅</span> {t('requested_on')}:</span>
                        <span style={{ fontWeight: '600', color: 'var(--text-body)' }}>{new Date(request.createdAt).toLocaleString(locale)}</span>
                    </div>
                    {request.inProgressAt && (
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem', color: 'var(--text-soft)' }}>
                            <span><span aria-hidden="true">🚀</span> {t('started_at')}:</span>
                            <span style={{ fontWeight: '600', color: 'var(--text-body)' }}>{new Date(request.inProgressAt).toLocaleString(locale)}</span>
                        </div>
                    )}
                    {request.completedAt && (
                        <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--text-soft)' }}>
                            <span><span aria-hidden="true">✅</span> {t('finished_at')}:</span>
                            <span style={{ fontWeight: '600', color: 'var(--text-body)' }}>{new Date(request.completedAt).toLocaleString(locale)}</span>
                        </div>
                    )}
                </div>

                <div style={{
                    whiteSpace: 'pre-wrap',
                    color: 'var(--text-muted)',
                    lineHeight: '1.7',
                    padding: '1.5rem',
                    background: 'var(--surface)',
                    border: '1px solid var(--surface-sunk)',
                    borderRadius: '0.75rem',
                    minHeight: '150px'
                }}>
                    {request.details}
                </div>
            </div>

            {/* Nested inside the request modal on purpose: it asks about the
                thing that modal is showing, and closing the outer one to ask
                would take the item being deleted off the screen. */}
            <ConfirmModal
                isOpen={confirmingDelete}
                title={t('confirm_item_delete_title')}
                message={t('confirm_item_delete')}
                confirmText={t('delete')}
                onCancel={() => setConfirmingDelete(false)}
                onConfirm={() => {
                    setConfirmingDelete(false)
                    onDelete(request.id)
                }}
            />
        </Modal>
    )
}

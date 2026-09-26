'use client'
import { useState, useEffect, useRef } from 'react'
import { useLanguage } from '@/context/LanguageContext'
import { useTemporaryHighlight } from '@/lib/useTemporaryHighlight'
import { useCan } from '@/lib/useCan'

interface RequestCardProps {
    request: any
    onView: (request: any) => void
    onStatusUpdate?: (id: string, status: string) => Promise<void>
    isHighlighted?: boolean
}

export default function RequestCard({ request, onView, onStatusUpdate, isHighlighted }: RequestCardProps) {
    const { t } = useLanguage()
    const [updating, setUpdating] = useState(false)
    const cardRef = useRef<HTMLDivElement>(null)

    const showVisualHighlight = useTemporaryHighlight(isHighlighted)

    // Scrolling stays an effect of its own: it touches the DOM rather than
    // state, and it has to happen once when the card becomes the highlighted
    // one — which is what arriving here from a notification means.
    useEffect(() => {
        if (!isHighlighted) return
        cardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }, [isHighlighted])

    const handleUpdate = async (status: string) => {
        if (!onStatusUpdate || updating) return
        setUpdating(true)
        try {
            await onStatusUpdate(request.id, status)
        } finally {
            setUpdating(false)
        }
    }

    const { can } = useCan()
    const canSeeWho = can('requests.view')
    const canReview = can('requests.review')

    return (
        <div
            ref={cardRef}
            id={`request-${request.id}`}
            className={`glass-card ${showVisualHighlight ? 'highlight-pulse' : ''}`}
            style={{
                padding: '1.25rem',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                transition: 'all 0.3s ease',
                borderInlineStart: showVisualHighlight ? '4px solid var(--accent-solid)' : '4px solid var(--brand-primary)',
                background: showVisualHighlight ? 'var(--highlight-tint)' : 'var(--surface)'
            }}
        >
            <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.25rem' }}>
                    <h3 style={{ fontSize: '1.1rem', fontWeight: '700', margin: 0, color: 'var(--text-main)' }}>{request.title}</h3>
                    <span className="badge" style={{
                        background: request.status === 'PENDING' ? 'var(--warn-bg-yellow)' : request.status === 'IN_PROGRESS' ? 'var(--info-bg)' : 'var(--ok-bg)',
                        color: request.status === 'PENDING' ? 'var(--warn-fg-yellow)' : request.status === 'IN_PROGRESS' ? 'var(--info-fg)' : 'var(--ok-fg)',
                        fontSize: '0.7rem'
                    }}>
                        {t(`status_${request.status.toLowerCase()}` as any)}
                    </span>
                </div>
                {canSeeWho && request.user && (
                    <div style={{ fontSize: '0.85rem', color: 'var(--text-soft)' }}>
                        {t('by' as any) || 'By'}: {request.user.firstName} {request.user.lastName}
                    </div>
                )}
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                <button
                    onClick={() => onView(request)}
                    className="btn"
                    style={{
                        padding: '0.4rem 0.8rem',
                        fontSize: '0.85rem',
                        background: 'var(--veil-50)',
                        border: '1px solid var(--hairline-firm)',
                        color: 'var(--brand-primary)',
                        fontWeight: '600'
                    }}
                >
                    {t('view_request' as any) || 'View Request'}
                </button>

                {canReview && request.status !== 'COMPLETED' && (
                    <button
                        onClick={() => handleUpdate(request.status === 'PENDING' ? 'IN_PROGRESS' : 'COMPLETED')}
                        disabled={updating}
                        style={{
                            background: request.status === 'PENDING' ? 'var(--info-bg)' : 'var(--ok-bg)',
                            border: `1px solid ${request.status === 'PENDING' ? 'var(--info-solid-sky-light)' : 'var(--ok-solid-alt)'}`,
                            color: request.status === 'PENDING' ? 'var(--info-fg)' : 'var(--ok-fg)',
                            width: '36px',
                            height: '36px',
                            borderRadius: '50%',
                            cursor: updating ? 'not-allowed' : 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            transition: 'all 0.2s',
                            boxShadow: '0 4px 6px -1px var(--shadow-weak)'
                        }}
                        title={request.status === 'PENDING' ? t('mark_in_progress' as any) : t('mark_completed' as any)}
                    >
                        {updating ? (
                            <div className="animate-spin-local" style={{ width: '16px', height: '16px', border: `2px solid ${request.status === 'PENDING' ? 'var(--info-fg)' : 'var(--ok-fg)'}`, borderTopColor: 'transparent', borderRadius: '50%' }} />
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

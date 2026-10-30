'use client'
import Link from 'next/link'
import { useState } from 'react'
import { useLanguage } from '@/context/LanguageContext'
import { useTemporaryHighlight } from '@/lib/useTemporaryHighlight'

interface CostCardProps {
    task: {
        id: string
        title: string
        totalCost: number
        status: string
        assignee: {
            firstName: string
            lastName: string
        }
        paymentStatus?: string
        /** Of this person's costs on the task, what their cash advance paid (CLIENTS_PLAN.md §7.5). */
        fromAdvance?: number
    }
    isHighlighted?: boolean
    /** What the amount is, when it's not the whole cost: the cost name the list is filtered by (CLIENTS_PLAN.md §5.9). */
    amountLabel?: string | null
}

export default function CostCard({ task, isHighlighted, amountLabel }: CostCardProps) {
    const { t, locale } = useLanguage()
    const [isHovered, setIsHovered] = useState(false)
    const showVisualHighlight = useTemporaryHighlight(isHighlighted)

    // Status mapping using translation keys
    const getStatusKey = (status: string) => {
        switch (status) {
            case 'APPROVED': return 'status_approved'
            case 'COMPLETED': return 'status_completed'
            case 'REJECTED': return 'status_rejected'
            default: return 'status_pending'
        }
    }

    return (
        <Link
            href={`/dashboard/tasks/${task.id}`}
            style={{ textDecoration: 'none', color: 'inherit' }}
        >
            <div
                id={`cost-${task.id}`}
                className={`card ${showVisualHighlight ? 'highlight-pulse' : ''}`}
                style={{
                    cursor: 'pointer',
                    transition: 'all 0.2s ease',
                    border: showVisualHighlight ? '2px solid var(--accent-solid)' : '2px solid var(--border)',
                    height: '100%',
                    transform: (isHovered || showVisualHighlight) ? 'translateY(-2px)' : 'translateY(0)',
                    boxShadow: (isHovered || showVisualHighlight) ? '0 4px 12px var(--shadow-weak)' : 'none',
                    borderColor: showVisualHighlight ? 'var(--accent-solid)' : (isHovered ? 'var(--info-solid)' : 'var(--border)'),
                    background: showVisualHighlight ? 'var(--highlight-tint)' : 'var(--surface)',
                    textAlign: locale === 'ar' ? 'right' : 'left',
                    direction: locale === 'ar' ? 'rtl' : 'ltr'
                }}
                onMouseEnter={() => setIsHovered(true)}
                onMouseLeave={() => setIsHovered(false)}
            >
                <div style={{ marginBottom: '1rem' }}>
                    <h3 style={{ margin: '0 0 0.5rem 0', fontSize: '1.1rem' }}>{task.title}</h3>
                    <div style={{ fontSize: '0.85rem', color: 'var(--text-soft)' }}>
                        {t('assignee_label')}: {task.assignee.firstName} {task.assignee.lastName}
                    </div>
                </div>

                <div style={{
                    background: 'var(--warn-bg)',
                    border: '2px solid var(--warn-solid)',
                    borderRadius: '0.5rem',
                    padding: '1rem',
                    textAlign: 'center'
                }}>
                    {/* A cost name, as typed, can be long: it wraps rather than run out of the box. */}
                    <div style={{ fontSize: '0.75rem', color: 'var(--warn-fg)', fontWeight: '600', marginBottom: '0.25rem', overflowWrap: 'anywhere' }}>
                        {amountLabel || (task.fromAdvance ? t('advances_to_pay_back') : t('total_cost'))}
                    </div>
                    <div style={{ fontSize: '1.75rem', fontWeight: 'bold', color: 'var(--warn-fg)' }}>
                        {new Intl.NumberFormat(locale === 'ar' ? 'ar-EG' : 'en-EG', { minimumFractionDigits: 2 }).format(task.totalCost)} {t('egp')}
                    </div>
                    {/* What their cash advance paid of it, never paid again (CLIENTS_PLAN.md §7.2). */}
                    {!amountLabel && !!task.fromAdvance && (
                        <div style={{ fontSize: 'var(--text-xs)', color: 'var(--warn-fg)', marginTop: 'var(--space-1)' }}>
                            {t('advances_from_advance')}: {new Intl.NumberFormat(locale === 'ar' ? 'ar-EG' : 'en-EG', { minimumFractionDigits: 2 }).format(task.fromAdvance)} {t('egp')}
                        </div>
                    )}
                </div>

                <div style={{
                    marginTop: '1rem',
                    display: 'flex',
                    gap: '0.5rem'
                }}>
                    <div style={{
                        flex: 1,
                        padding: '0.5rem',
                        borderRadius: '0.25rem',
                        background: task.status === 'APPROVED'
                            ? 'var(--ok-bg)'
                            : task.status === 'COMPLETED'
                                ? 'var(--info-bg)'
                                : 'var(--danger-bg)', // REJECTED
                        color: task.status === 'APPROVED'
                            ? 'var(--ok-fg)'
                            : task.status === 'COMPLETED'
                                ? 'var(--info-fg)'
                                : 'var(--danger-fg)', // REJECTED
                        fontSize: '0.75rem',
                        fontWeight: '700',
                        textAlign: 'center'
                    }}>
                        {t(getStatusKey(task.status) as any)}
                    </div>
                </div>
            </div>
        </Link>
    )
}

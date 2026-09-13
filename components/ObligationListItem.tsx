'use client'
import { useState, useEffect } from 'react'
import Link from 'next/link'
import { useLanguage } from '@/context/LanguageContext'
import Modal from './Modal'
import SafeDate from './SafeDate'
import { RECURRENCE_STYLE } from '@/lib/recurrence'


interface ObligationListItemProps {
    obligation: {
        id: string
        title: string
        description: string
        status: string
        deadline: Date | string
        assignees: {
            firstName: string
            lastName: string
        }[]
        createdAt: Date | string
        lastStatusUpdateBy?: string
        difficulty: number
        recurrence?: string | null
    }
    isHighlighted?: boolean
}

export default function ObligationListItem({ obligation, isHighlighted }: ObligationListItemProps) {
    const [isModalOpen, setIsModalOpen] = useState(false)
    const [mounted, setMounted] = useState(false)
    const { t, locale } = useLanguage()

    useEffect(() => {
        setMounted(true)
    }, [])

    const getButtonLabel = () => {
        if (obligation.status === 'PENDING') return t('start_obligation')
        if (obligation.status === 'IN_PROGRESS') return t('continue_obligation')
        return t('open_obligation')
    }

    const recurrenceStyle = obligation.recurrence ? RECURRENCE_STYLE[obligation.recurrence] : undefined

    const isOverdue = new Date(obligation.deadline) < new Date() && !['COMPLETED', 'APPROVED', 'REJECTED'].includes(obligation.status)

    return (
        <div id={`obligation-${obligation.id}`} className={`card ${isHighlighted ? 'highlight-shading' : ''}`} style={{
            background: isOverdue ? 'var(--danger-bg-tint)' : undefined,
            borderColor: isOverdue ? 'var(--danger-border)' : undefined
        }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
                    <h3
                        style={{ margin: 0, cursor: 'pointer', transition: 'color 0.2s', color: 'inherit' }}
                        title={obligation.title}
                        onClick={() => setIsModalOpen(true)}
                        onMouseEnter={(e) => e.currentTarget.style.color = 'var(--info-solid-hover)'}
                        onMouseLeave={(e) => e.currentTarget.style.color = 'inherit'}
                    >
                        {obligation.title.length > 50 ? obligation.title.substring(0, 50) + '...' : obligation.title}
                    </h3>
                    <span style={{
                        padding: '0.15rem 0.5rem',
                        borderRadius: '0.5rem',
                        background: 'var(--info-solid)',
                        color: 'white',
                        fontWeight: 'bold',
                        fontSize: '0.7rem'
                    }}>
                        {obligation.difficulty} {t('pts')}
                    </span>
                    {recurrenceStyle && (
                        <span
                            title={t('recurrence_label')}
                            style={{
                                padding: '0.15rem 0.5rem',
                                borderRadius: '0.5rem',
                                background: recurrenceStyle.bg,
                                color: recurrenceStyle.color,
                                fontWeight: 'bold',
                                fontSize: '0.7rem',
                                whiteSpace: 'nowrap'
                            }}
                        >
                            {t(recurrenceStyle.labelKey as any)}
                        </span>
                    )}
                </div>
                <span style={{
                    fontSize: '0.75rem',
                    fontWeight: '600',
                    padding: '0.25rem 0.75rem',
                    borderRadius: '9999px',
                    background: obligation.status === 'COMPLETED' || obligation.status === 'APPROVED' ? 'var(--ok-bg)' : obligation.status === 'REJECTED' ? 'var(--danger-bg)' : 'var(--surface-sunk)',
                    color: obligation.status === 'COMPLETED' || obligation.status === 'APPROVED' ? 'var(--ok-fg)' : obligation.status === 'REJECTED' ? 'var(--danger-fg)' : 'var(--text-muted)',
                    display: 'inline-flex',
                    alignItems: 'center'
                }}>
                    {t(`status_${obligation.status.toLowerCase()}` as any)}
                    {obligation.lastStatusUpdateBy && (['COMPLETED', 'REJECTED', 'APPROVED'].includes(obligation.status)) && (
                        <span style={{ [locale === 'ar' ? 'marginRight' : 'marginLeft']: '0.25rem', fontSize: '0.65rem', opacity: 0.8, fontWeight: 'normal' }}>
                            • {obligation.lastStatusUpdateBy}
                        </span>
                    )}
                </span>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '1rem' }}>
                <div style={{ fontSize: '0.875rem', color: 'var(--text-soft)' }}>
                    <div>
                        {obligation.assignees && obligation.assignees.length > 1 ? (t('assignees_label' as any) || 'Assignees') : t('assignee_label')}: {obligation.assignees && obligation.assignees.length >= 1
                            ? obligation.assignees.length <= 2
                                ? obligation.assignees.map(a => `${a.firstName} ${a.lastName}`).join(', ')
                                : `${obligation.assignees[0].firstName} ${obligation.assignees[0].lastName} + ${obligation.assignees.length - 1}`
                            : '---'}
                    </div>
                    <div style={{ marginTop: '0.25rem' }}>
                        {mounted && (
                            <>
                                {t('created_label')}: <SafeDate date={obligation.createdAt} locale={locale} format="short" /> | {t('deadline_label')}: <SafeDate date={obligation.deadline} locale={locale} format="short" />
                            </>
                        )}
                    </div>
                </div>
                <Link href={`/dashboard/obligations/${obligation.id}`} className="btn btn-primary" style={{ textDecoration: 'none', fontSize: '0.875rem' }}>
                    {getButtonLabel()}
                </Link>
            </div>

            <Modal
                isOpen={isModalOpen}
                onClose={() => setIsModalOpen(false)}
                title={obligation.title}
            >
                <p style={{ lineHeight: '1.6' }}>{obligation.description}</p>
            </Modal>
        </div>
    )
}

'use client'
import { useState, useEffect } from 'react'
import Link from 'next/link'
import { useLanguage } from '@/context/LanguageContext'
import Modal from './Modal'

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

    const isOverdue = new Date(obligation.deadline) < new Date() && !['COMPLETED', 'APPROVED', 'REJECTED'].includes(obligation.status)

    return (
        <div id={`obligation-${obligation.id}`} className={`card ${isHighlighted ? 'highlight-shading' : ''}`} style={{
            background: isOverdue ? '#fff1f2' : undefined,
            borderColor: isOverdue ? '#fecaca' : undefined
        }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                    <h3
                        style={{ margin: 0, cursor: 'pointer', transition: 'color 0.2s', color: 'inherit' }}
                        title={obligation.title}
                        onClick={() => setIsModalOpen(true)}
                        onMouseEnter={(e) => e.currentTarget.style.color = '#2563eb'}
                        onMouseLeave={(e) => e.currentTarget.style.color = 'inherit'}
                    >
                        {obligation.title.length > 50 ? obligation.title.substring(0, 50) + '...' : obligation.title}
                    </h3>
                    <span style={{
                        padding: '0.15rem 0.5rem',
                        borderRadius: '0.5rem',
                        background: '#3b82f6',
                        color: 'white',
                        fontWeight: 'bold',
                        fontSize: '0.7rem'
                    }}>
                        {obligation.difficulty} {t('pts')}
                    </span>
                </div>
                <span style={{
                    fontSize: '0.75rem',
                    fontWeight: '600',
                    padding: '0.25rem 0.75rem',
                    borderRadius: '9999px',
                    background: obligation.status === 'COMPLETED' || obligation.status === 'APPROVED' ? '#dcfce7' : obligation.status === 'REJECTED' ? '#fee2e2' : '#f1f5f9',
                    color: obligation.status === 'COMPLETED' || obligation.status === 'APPROVED' ? '#166534' : obligation.status === 'REJECTED' ? '#991b1b' : '#475569',
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
                <div style={{ fontSize: '0.875rem', color: '#64748b' }}>
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
                                {t('created_label')}: {new Date(obligation.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} {new Date(obligation.createdAt).toLocaleDateString(locale === 'ar' ? 'ar-EG' : 'en-GB')} | {t('deadline_label')}: {new Date(obligation.deadline).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} {new Date(obligation.deadline).toLocaleDateString(locale === 'ar' ? 'ar-EG' : 'en-GB')}
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

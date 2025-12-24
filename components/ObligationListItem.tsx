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
        assignee: {
            firstName: string
            lastName: string
        }
        createdAt: Date | string
        lastStatusUpdateBy?: string
    }
}

export default function ObligationListItem({ obligation }: ObligationListItemProps) {
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

    return (
        <div className="card">
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
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
                    fontSize: '0.75rem',
                    fontWeight: '600',
                    padding: '0.25rem 0.75rem',
                    borderRadius: '9999px',
                    background: obligation.status === 'COMPLETED' ? '#dcfce7' : obligation.status === 'REJECTED' ? '#fee2e2' : '#f1f5f9',
                    color: obligation.status === 'COMPLETED' ? '#166534' : obligation.status === 'REJECTED' ? '#991b1b' : '#475569',
                    display: 'inline-flex',
                    alignItems: 'center'
                }}>
                    {t(`status_${obligation.status.toLowerCase()}` as any)}
                    {obligation.lastStatusUpdateBy && obligation.status === 'COMPLETED' && (
                        <span style={{ [locale === 'ar' ? 'marginRight' : 'marginLeft']: '0.25rem', fontSize: '0.65rem', opacity: 0.8 }}>
                            {t('by')} {obligation.lastStatusUpdateBy}
                        </span>
                    )}
                </span>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '1rem' }}>
                <div style={{ fontSize: '0.875rem', color: '#64748b' }}>
                    <div>{t('assignee_label')}: {obligation.assignee.firstName} {obligation.assignee.lastName}</div>
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

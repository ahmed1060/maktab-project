'use client'
import Link from 'next/link'
import { useState } from 'react'
import { useLanguage } from '@/context/LanguageContext'

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
    }
}

export default function CostCard({ task }: CostCardProps) {
    const { t, locale } = useLanguage()
    const [isHovered, setIsHovered] = useState(false)

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
                className="card"
                style={{
                    cursor: 'pointer',
                    transition: 'all 0.2s ease',
                    border: '2px solid #e2e8f0',
                    height: '100%',
                    transform: isHovered ? 'translateY(-2px)' : 'translateY(0)',
                    boxShadow: isHovered ? '0 4px 12px rgba(0,0,0,0.1)' : 'none',
                    borderColor: isHovered ? '#3b82f6' : '#e2e8f0',
                    textAlign: locale === 'ar' ? 'right' : 'left',
                    direction: locale === 'ar' ? 'rtl' : 'ltr'
                }}
                onMouseEnter={() => setIsHovered(true)}
                onMouseLeave={() => setIsHovered(false)}
            >
                <div style={{ marginBottom: '1rem' }}>
                    <h3 style={{ margin: '0 0 0.5rem 0', fontSize: '1.1rem' }}>{task.title}</h3>
                    <div style={{ fontSize: '0.85rem', color: '#64748b' }}>
                        {t('assignee_label')}: {task.assignee.firstName} {task.assignee.lastName}
                    </div>
                </div>

                <div style={{
                    background: '#fef3c7',
                    border: '2px solid #f59e0b',
                    borderRadius: '0.5rem',
                    padding: '1rem',
                    textAlign: 'center'
                }}>
                    <div style={{ fontSize: '0.75rem', color: '#92400e', fontWeight: '600', marginBottom: '0.25rem' }}>
                        {t('total_cost')}
                    </div>
                    <div style={{ fontSize: '1.75rem', fontWeight: 'bold', color: '#92400e' }}>
                        {new Intl.NumberFormat(locale === 'ar' ? 'ar-EG' : 'en-EG', { minimumFractionDigits: 2 }).format(task.totalCost)} {t('egp')}
                    </div>
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
                            ? '#dcfce7'
                            : task.status === 'COMPLETED'
                                ? '#e0f2fe'
                                : '#fee2e2', // REJECTED
                        color: task.status === 'APPROVED'
                            ? '#166534'
                            : task.status === 'COMPLETED'
                                ? '#0369a1'
                                : '#991b1b', // REJECTED
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

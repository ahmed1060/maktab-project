'use client'
import { useState, useEffect } from 'react'
import Link from 'next/link'
import { formatTaskStatus } from '@/lib/formatStatus'
import { useLanguage } from '@/context/LanguageContext'
import Modal from './Modal'

interface TaskListItemProps {
    task: {
        id: string
        title: string
        description: string
        status: string
        deadline: Date | string
        assigneeId: string
        assignee: {
            firstName: string
            lastName: string
        }
        assignees?: {
            id: string
            firstName: string
            lastName: string
        }[]
        creator?: {
            firstName: string
            lastName: string
        }
        createdAt: Date | string
        lastStatusUpdateBy?: string
        difficulty: number
    }
    currentUserId: string
}

export default function TaskListItem({ task, currentUserId }: TaskListItemProps) {
    const [isModalOpen, setIsModalOpen] = useState(false)
    const [mounted, setMounted] = useState(false)
    const { t, locale } = useLanguage()

    useEffect(() => {
        setMounted(true)
    }, [])

    const getButtonLabel = () => {
        if (currentUserId !== task.assigneeId) return t('view_task')
        if (task.status === 'PENDING') return t('start_task')
        if (task.status === 'IN_PROGRESS') return t('continue_task')
        return t('open_task')
    }

    return (
        <div className="glass-card" style={{ marginBottom: '1rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                    <h3
                        style={{ margin: 0, cursor: 'pointer', transition: 'color 0.2s', color: 'inherit' }}
                        title={task.title}
                        onClick={() => setIsModalOpen(true)}
                        onMouseEnter={(e) => e.currentTarget.style.color = '#2563eb'}
                        onMouseLeave={(e) => e.currentTarget.style.color = 'inherit'}
                    >
                        {task.title.length > 50 ? task.title.substring(0, 50) + '...' : task.title}
                    </h3>
                    <span style={{
                        padding: '0.15rem 0.5rem',
                        borderRadius: '0.5rem',
                        background: '#3b82f6',
                        color: 'white',
                        fontWeight: 'bold',
                        fontSize: '0.7rem',
                        display: 'inline-flex',
                        alignItems: 'center'
                    }}>
                        {task.difficulty} {t('pts')}
                    </span>
                </div>
                <span style={{
                    fontSize: '0.75rem',
                    fontWeight: '600',
                    padding: '0.25rem 0.75rem',
                    borderRadius: '9999px',
                    background: task.status === 'APPROVED' || task.status === 'COMPLETED' ? '#dcfce7' : task.status === 'PENDING_CONFIRMATION' ? '#fef9c3' : task.status === 'REJECTED' ? '#fee2e2' : '#f1f5f9',
                    color: task.status === 'APPROVED' || task.status === 'COMPLETED' ? '#166534' : task.status === 'PENDING_CONFIRMATION' ? '#854d0e' : task.status === 'REJECTED' ? '#991b1b' : '#475569',
                    display: 'inline-flex',
                    alignItems: 'center'
                }}>
                    {t(`status_${task.status.toLowerCase()}` as any)}
                    {task.lastStatusUpdateBy && (['APPROVED', 'COMPLETED', 'REJECTED'].includes(task.status)) && (
                        <span style={{ [locale === 'ar' ? 'marginRight' : 'marginLeft']: '0.25rem', fontSize: '0.65rem', opacity: 0.8, fontWeight: 'normal' }}>
                            • {task.lastStatusUpdateBy}
                        </span>
                    )}
                </span>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '1rem' }}>
                <div style={{ fontSize: '0.875rem', color: '#64748b' }}>
                    <div style={{ marginBottom: '0.25rem' }}>
                        {(currentUserId === task.assigneeId || (task.assignees as any)?.some((a: any) => a.id === currentUserId)) && task.creator ? (
                            <span>{t('assigned_by')}: <strong>{task.creator.firstName} {task.creator.lastName}</strong></span>
                        ) : (
                            <span>
                                {task.assignees && task.assignees.length > 1 ? (t('assignees_label' as any) || 'Assignees') : t('assignee_label')}: {task.assignees && task.assignees.length > 1
                                    ? task.assignees.length <= 2
                                        ? task.assignees.map(a => `${a.firstName} ${a.lastName}`).join(', ')
                                        : `${task.assignees[0].firstName} ${task.assignees[0].lastName} + ${task.assignees.length - 1}`
                                    : `${task.assignee.firstName} ${task.assignee.lastName}`}
                            </span>
                        )}
                    </div>
                    <div>
                        {mounted && (
                            <>
                                {t('created_label')}: {new Date(task.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} {new Date(task.createdAt).toLocaleDateString(locale === 'ar' ? 'ar-EG' : 'en-GB')} | {t('deadline_label')}: {new Date(task.deadline).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} {new Date(task.deadline).toLocaleDateString(locale === 'ar' ? 'ar-EG' : 'en-GB')}
                            </>
                        )}
                    </div>
                </div>
                <Link href={`/dashboard/tasks/${task.id}`} className="btn btn-primary" style={{ textDecoration: 'none', fontSize: '0.875rem' }}>
                    {getButtonLabel()}
                </Link>
            </div>

            <Modal
                isOpen={isModalOpen}
                onClose={() => setIsModalOpen(false)}
                title={task.title}
            >
                <p style={{ lineHeight: '1.6' }}>{task.description}</p>
            </Modal>
        </div>
    )
}

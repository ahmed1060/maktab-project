'use client'
import { useState } from 'react'
import Link from 'next/link'
import { useLanguage } from '@/context/LanguageContext'
import Modal from './Modal'
import SafeDate from './SafeDate'
import { useHydrated } from '@/lib/useHydrated'
import { useTemporaryHighlight } from '@/lib/useTemporaryHighlight'

interface TaskListItemProps {
    task: {
        id: string
        title: string
        description: string
        status: string
        deadline: Date | string
        assignees: {
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
        totalCost?: number
        memberCosts?: any
    }
    currentUserId: string
    currentUserName?: string
    isHighlighted?: boolean
}

export default function TaskListItem({ task, currentUserId, isHighlighted }: TaskListItemProps) {
    const [isModalOpen, setIsModalOpen] = useState(false)
    const showVisualHighlight = useTemporaryHighlight(isHighlighted)
    const mounted = useHydrated()
    const { t, locale } = useLanguage()

    const getButtonLabel = () => {
        const isSelfAssigned = task.assignees?.some((a: any) => a.id === currentUserId)
        if (!isSelfAssigned) return t('view_task')
        if (task.status === 'PENDING') return t('start_task')
        if (task.status === 'IN_PROGRESS') return t('continue_task')
        return t('open_task')
    }

    const memberCostsArr = task.memberCosts ? (typeof task.memberCosts === 'string' ? JSON.parse(task.memberCosts) : task.memberCosts) : {}
    const userCost = memberCostsArr[currentUserId] || 0
    const isMultiAssignee = (task.assignees?.length || 0) > 1
    const isOverdue = new Date(task.deadline) < new Date() && ['PENDING', 'IN_PROGRESS'].includes(task.status)

    return (
        <div id={`task-${task.id}`} className={`glass-card ${showVisualHighlight ? 'highlight-pulse' : ''}`} style={{
            marginBottom: '1rem',
            borderInlineStart: showVisualHighlight ? '4px solid var(--accent-solid)' : '',
            transition: 'all 0.3s ease',
            background: isOverdue ? 'var(--danger-bg)' : (showVisualHighlight ? 'var(--highlight-tint)' : ''),
            borderColor: isOverdue ? 'var(--danger-border-firm)' : undefined
        }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                    {/* The title opens the quick view: a button, so the keyboard reaches it too (audit L1). */}
                    <h3 style={{ margin: 0 }}>
                        <button type="button" className="title-button" title={task.title} onClick={() => setIsModalOpen(true)}>
                            {task.title.length > 50 ? task.title.substring(0, 50) + '...' : task.title}
                        </button>
                    </h3>
                    <span style={{
                        padding: '0.15rem 0.5rem',
                        borderRadius: '0.5rem',
                        background: 'var(--info-fill)',
                        color: 'var(--text-on-accent)',
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
                    // A status never wraps. Without this, "In Progress" breaks
                    // onto two lines on a narrow screen and the 9999px radius
                    // rounds the now-tall box into a full ellipse.
                    whiteSpace: 'nowrap',
                    background: task.status === 'APPROVED' || task.status === 'COMPLETED' ? 'var(--ok-bg)' : task.status === 'PENDING_CONFIRMATION' ? 'var(--warn-bg-yellow)' : task.status === 'REJECTED' ? 'var(--danger-bg)' : 'var(--surface-sunk)',
                    color: task.status === 'APPROVED' || task.status === 'COMPLETED' ? 'var(--ok-fg)' : task.status === 'PENDING_CONFIRMATION' ? 'var(--warn-fg-yellow)' : task.status === 'REJECTED' ? 'var(--danger-fg)' : 'var(--text-muted)',
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
                <div style={{ fontSize: '0.875rem', color: 'var(--text-soft)' }}>
                    <div style={{ marginBottom: '0.25rem' }}>
                        {task.assignees?.some((a: any) => a.id === currentUserId) && task.creator ? (
                            <span>{t('assigned_by')}: <strong>{task.creator.firstName} {task.creator.lastName}</strong></span>
                        ) : (
                            <span>
                                {task.assignees && task.assignees.length > 1 ? (t('assignees_label' as any) || 'Assignees') : t('assignee_label')}: {task.assignees && task.assignees.length >= 1
                                    ? task.assignees.length <= 2
                                        ? task.assignees.map(a => `${a.firstName} ${a.lastName}`).join(', ')
                                        : `${task.assignees[0].firstName} ${task.assignees[0].lastName} + ${task.assignees.length - 1}`
                                    : '---'}
                            </span>
                        )}
                    </div>
                    <div style={{ fontSize: '0.75rem', opacity: 0.7, marginTop: '0.25rem' }}>
                        {mounted && (
                            <>
                                {t('created_label')}: <SafeDate date={task.createdAt} locale={locale} format="short" /> | {t('deadline_label')}: <SafeDate date={task.deadline} locale={locale} format="short" />
                            </>
                        )}
                    </div>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', alignItems: 'flex-end' }}>
                    {isMultiAssignee && userCost > 0 && (
                        <div style={{ background: 'var(--info-fill)', color: 'var(--text-on-accent)', padding: '0.2rem 0.6rem', borderRadius: '0.5rem', fontSize: '0.75rem', fontWeight: 'bold' }}>
                            {locale === 'ar' ? 'تكلفني' : 'My Cost'}: {userCost.toFixed(2)}
                        </div>
                    )}
                    <Link href={`/dashboard/tasks/${task.id}`} className="btn btn-primary" style={{ textDecoration: 'none', fontSize: '0.875rem' }}>
                        {getButtonLabel()}
                    </Link>
                </div>
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

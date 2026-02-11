'use client'
import { useState, useEffect } from 'react'
import Link from 'next/link'
import { useLanguage } from '@/context/LanguageContext'
import Modal from './Modal'
import SafeDate from './SafeDate'


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
    const [showVisualHighlight, setShowVisualHighlight] = useState(isHighlighted)
    const [mounted, setMounted] = useState(false)
    const { t, locale } = useLanguage()

    useEffect(() => {
        setMounted(true)
        if (isHighlighted) {
            setShowVisualHighlight(true)
            const timer = setTimeout(() => {
                setShowVisualHighlight(false)
            }, 6000)
            return () => clearTimeout(timer)
        } else {
            setShowVisualHighlight(false)
        }
    }, [isHighlighted])

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
            borderInlineStart: showVisualHighlight ? '4px solid #a855f7' : '',
            transition: 'all 0.3s ease',
            background: isOverdue ? '#fee2e2' : (showVisualHighlight ? 'rgba(168, 85, 247, 0.05)' : ''),
            borderColor: isOverdue ? '#fca5a5' : undefined
        }}>
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
                        <div style={{ background: '#3b82f6', color: 'white', padding: '0.2rem 0.6rem', borderRadius: '0.5rem', fontSize: '0.75rem', fontWeight: 'bold' }}>
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

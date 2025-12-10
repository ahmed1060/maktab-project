'use client'
import { useState, useEffect } from 'react'
import Link from 'next/link'
import { formatTaskStatus } from '@/lib/formatStatus'
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
        creator?: {
            firstName: string
            lastName: string
        }
        createdAt: Date | string
        lastStatusUpdateBy?: string
    }
    currentUserId: string
}

export default function TaskListItem({ task, currentUserId }: TaskListItemProps) {
    const [isModalOpen, setIsModalOpen] = useState(false)
    const [mounted, setMounted] = useState(false)

    useEffect(() => {
        setMounted(true)
    }, [])

    const getButtonLabel = () => {
        if (currentUserId !== task.assigneeId) return 'View Task'
        if (task.status === 'PENDING') return 'Start Task'
        if (task.status === 'IN_PROGRESS') return 'Continue Task'
        return 'Open Task'
    }

    return (
        <div className="card">
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <h3 style={{ margin: 0 }} title={task.title}>
                    {task.title.length > 50 ? task.title.substring(0, 50) + '...' : task.title}
                </h3>
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
                    {formatTaskStatus(task.status)}
                    {task.lastStatusUpdateBy && (task.status === 'APPROVED' || task.status === 'COMPLETED' || task.status === 'REJECTED') && (
                        <span style={{ marginLeft: '0.25rem', fontSize: '0.65rem', opacity: 0.8 }}>
                            by {task.lastStatusUpdateBy}
                        </span>
                    )}
                </span>
            </div>

            <div style={{ margin: '1rem 0' }}>
                <button
                    onClick={() => setIsModalOpen(true)}
                    style={{
                        background: 'none',
                        border: 'none',
                        color: 'blue',
                        textDecoration: 'underline',
                        cursor: 'pointer',
                        padding: 0,
                        fontSize: '0.9rem'
                    }}
                >
                    View Description
                </button>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '1rem' }}>
                <div style={{ fontSize: '0.875rem', color: '#64748b' }}>
                    <div style={{ marginBottom: '0.25rem' }}>
                        {currentUserId === task.assigneeId && task.creator ? (
                            <span>Assigned by: <strong>{task.creator.firstName} {task.creator.lastName}</strong></span>
                        ) : (
                            <span>Assignee: {task.assignee.firstName} {task.assignee.lastName}</span>
                        )}
                    </div>
                    <div>
                        {mounted && (
                            <>
                                Created: {new Date(task.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} {new Date(task.createdAt).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' })} | Deadline: {new Date(task.deadline).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} {new Date(task.deadline).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' })}
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

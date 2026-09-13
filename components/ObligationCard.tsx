"use client"

import { useState, useEffect } from "react"
import SafeDate from "./SafeDate"


interface Obligation {
    id: string
    title: string
    description: string
    status: string
    deadline: string
    assignee: { firstName: string, lastName: string }
    attachments?: string
}

interface Attachment {
    url: string
    name: string
}

export default function ObligationCard({ obligation, userRole, isHighlighted }: { obligation: Obligation, userRole: string, isHighlighted?: boolean }) {
    const [status, setStatus] = useState(obligation.status)
    const [uploading, setUploading] = useState(false)
    const [showVisualHighlight, setShowVisualHighlight] = useState(isHighlighted)

    useEffect(() => {
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

    const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        if (!e.target.files?.[0]) return
        setUploading(true)

        const formData = new FormData()
        formData.append('file', e.target.files[0])

        try {
            const res = await fetch('/api/upload', {
                method: 'POST',
                body: formData
            })
            const data = await res.json()

            if (data.success) {
                await updateObligation('COMPLETED', [{ url: data.url, name: e.target.files[0].name }])
            }
        } catch (error) {
            console.error("Upload failed", error)
        } finally {
            setUploading(false)
        }
    }

    const updateObligation = async (newStatus: string, attachments?: Attachment[]) => {
        try {
            const res = await fetch(`/api/obligations/${obligation.id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ status: newStatus, attachments })
            })

            if (res.ok) {
                setStatus(newStatus)
                window.location.reload() // Refresh to show updated state
            }
        } catch (_error) {
            console.error("Update failed", _error)
        }
    }

    const isOverdue = new Date(obligation.deadline) < new Date() && ['PENDING', 'IN_PROGRESS'].includes(status)

    return (
        <div id={`obligation-${obligation.id}`} className={`card ${showVisualHighlight ? 'highlight-pulse' : ''}`} style={{
            padding: '1rem',
            border: isOverdue ? '1px solid var(--danger-border-firm)' : '1px solid var(--grey-100)',
            borderRadius: '8px',
            background: isOverdue ? 'var(--danger-bg)' : (showVisualHighlight ? 'var(--highlight-tint)' : 'var(--surface)'),
            borderInlineStart: showVisualHighlight ? '4px solid var(--accent-solid)' : (isOverdue ? '1px solid var(--danger-border-firm)' : '1px solid var(--grey-100)'),
            transition: 'all 0.3s ease'
        }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <h3>{obligation.title}</h3>
                <span style={{
                    fontSize: '0.75rem',
                    fontWeight: '600',
                    padding: '0.25rem 0.75rem',
                    borderRadius: '9999px',
                    background: status === 'COMPLETED' ? 'var(--ok-bg)' : status === 'REJECTED' ? 'var(--danger-bg)' : 'var(--surface-sunk)',
                    color: status === 'COMPLETED' ? 'var(--ok-fg)' : status === 'REJECTED' ? 'var(--danger-fg)' : 'var(--text-muted)'
                }}>
                    {status}
                </span>
            </div>
            <p style={{ margin: '0.5rem 0' }}>{obligation.description}</p>
            <div style={{ fontSize: '0.875rem', color: 'var(--text-soft)', marginBottom: '1rem' }}>
                Assignee: {obligation.assignee.firstName} {obligation.assignee.lastName} | Deadline: <SafeDate date={obligation.deadline} locale="en" format="dateOnly" />
            </div>

            {userRole === 'EMPLOYEE' && status === 'PENDING' && (
                <div style={{ marginTop: '1rem' }}>
                    <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.875rem' }}>Upload Evidence to Complete:</label>
                    <input
                        type="file"
                        onChange={handleUpload}
                        disabled={uploading}
                        style={{ display: 'block', width: '100%' }}
                    />
                    {uploading && <span style={{ fontSize: '0.75rem', color: 'var(--grey-600)' }}>Uploading...</span>}
                </div>
            )}

            {obligation.attachments && (
                <div style={{ marginTop: '1rem', padding: '0.5rem', background: 'var(--surface-subtle)', borderRadius: '4px' }}>
                    <strong>Evidence:</strong>
                    {JSON.parse(obligation.attachments).map((att: Attachment, i: number) => (
                        <div key={i}>
                            <a href={att.url} target="_blank" rel="noopener noreferrer" style={{ color: 'blue', textDecoration: 'underline' }}>
                                {att.name || 'View Attachment'}
                            </a>
                        </div>
                    ))}
                </div>
            )}
        </div>
    )
}

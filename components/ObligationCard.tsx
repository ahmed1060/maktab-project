"use client"

import { useState } from "react"

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
        } catch (error) {
            console.error("Update failed", error)
        }
    }

    return (
        <div id={`obligation-${obligation.id}`} className={`card ${isHighlighted ? 'highlight-pulse' : ''}`} style={{
            padding: '1rem',
            border: '1px solid #eee',
            borderRadius: '8px',
            background: isHighlighted ? 'rgba(168, 85, 247, 0.05)' : 'white',
            borderInlineStart: isHighlighted ? '4px solid #a855f7' : '1px solid #eee',
            transition: 'all 0.3s ease'
        }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <h3>{obligation.title}</h3>
                <span style={{
                    fontSize: '0.75rem',
                    fontWeight: '600',
                    padding: '0.25rem 0.75rem',
                    borderRadius: '9999px',
                    background: status === 'COMPLETED' ? '#dcfce7' : status === 'REJECTED' ? '#fee2e2' : '#f1f5f9',
                    color: status === 'COMPLETED' ? '#166534' : status === 'REJECTED' ? '#991b1b' : '#475569'
                }}>
                    {status}
                </span>
            </div>
            <p style={{ margin: '0.5rem 0' }}>{obligation.description}</p>
            <div style={{ fontSize: '0.875rem', color: '#64748b', marginBottom: '1rem' }}>
                Assignee: {obligation.assignee.firstName} {obligation.assignee.lastName} | Deadline: {new Date(obligation.deadline).toLocaleDateString()}
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
                    {uploading && <span style={{ fontSize: '0.75rem', color: '#666' }}>Uploading...</span>}
                </div>
            )}

            {obligation.attachments && (
                <div style={{ marginTop: '1rem', padding: '0.5rem', background: '#f8fafc', borderRadius: '4px' }}>
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

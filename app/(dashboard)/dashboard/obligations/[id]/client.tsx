'use client'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'

export default function ObligationDetailClient({ obligation, userRole }: { obligation: any, userRole: string }) {
    const [uploading, setUploading] = useState(false)
    const [pendingFiles, setPendingFiles] = useState<File[]>([])
    const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
    const [showFeedback, setShowFeedback] = useState(false)
    const [feedbackMessage, setFeedbackMessage] = useState('')
    const router = useRouter()

    // Listen for suspension auto-save event
    useEffect(() => {
        const handleSuspendSave = () => {
            console.log('Suspension detected, auto-saving obligation progress...')
            // Only auto-save if employee interaction is active
            if (userRole === 'EMPLOYEE' && obligation.status !== 'COMPLETED') {
                handleUpload(true)
            }
        }
        window.addEventListener('app:suspend-detected', handleSuspendSave)
        return () => window.removeEventListener('app:suspend-detected', handleSuspendSave)
    }, [obligation.status, userRole, pendingFiles])

    // Helper to parse existing attachments
    const existingAttachments = obligation.attachments ? (() => {
        try {
            const parsed = JSON.parse(obligation.attachments)
            if (Array.isArray(parsed)) return parsed
            if (parsed.url) return [parsed] // Legacy
            return []
        } catch {
            return []
        }
    })() : []

    const [inputKey, setInputKey] = useState(0)

    const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files.length > 0) {
            setPendingFiles(prev => [...prev, ...Array.from(e.target.files || [])])
            setInputKey(prev => prev + 1)
        }
    }

    const removePendingFile = (index: number) => {
        setPendingFiles(prev => prev.filter((_, i) => i !== index))
    }

    const handleUpload = async (isDraft: boolean) => {
        setUploading(true)
        const uploadedAttachments: any[] = []

        try {
            // Upload all pending files
            for (const file of pendingFiles) {
                const formData = new FormData()
                formData.append('file', file)

                try {
                    const res = await fetch('/api/upload', { method: 'POST', body: formData })
                    const data = await res.json()
                    if (data.success) {
                        uploadedAttachments.push({
                            name: file.name,
                            url: data.url,
                            type: file.type,
                            uploadedAt: new Date().toISOString()
                        })
                    }
                } catch (err) {
                    console.error("Upload error", err)
                }
            }

            await fetch(`/api/obligations/${obligation.id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    status: isDraft ? 'IN_PROGRESS' : 'COMPLETED',
                    newAttachments: uploadedAttachments // Send only new ones
                })
            })

            setPendingFiles([])
            router.refresh()
        } catch (error) {
            console.error("Update failed", error)
        } finally {
            setUploading(false)
        }
    }

    const handleDelete = async () => {
        try {
            const res = await fetch(`/api/obligations/${obligation.id}`, {
                method: 'DELETE'
            })
            if (res.ok) {
                router.push('/dashboard/obligations')
                router.refresh()
            } else {
                setFeedbackMessage('Failed to delete obligation')
                setShowFeedback(true)
            }
        } catch (error) {
            console.error('Delete error:', error)
            setFeedbackMessage('Failed to delete obligation')
            setShowFeedback(true)
        }
        setShowDeleteConfirm(false)
    }

    return (
        <div className="card">
            {/* ... (Header and Description) */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                    <h1>{obligation.title}</h1>
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
                        {obligation.status}
                    </span>
                </div>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                    <button
                        onClick={() => router.push('/dashboard/obligations')}
                        style={{ background: 'none', border: '1px solid #cbd5e1', borderRadius: '0.25rem', padding: '0.5rem 1rem', cursor: 'pointer', color: '#64748b' }}
                    >
                        Close
                    </button>
                    {['ADMIN', 'SUPER_ADMIN'].includes(userRole) && (
                        <button
                            onClick={() => setShowDeleteConfirm(true)}
                            style={{ background: '#fee2e2', color: '#991b1b', border: 'none', borderRadius: '0.25rem', padding: '0.5rem 1rem', cursor: 'pointer' }}
                        >
                            Delete Obligation
                        </button>
                    )}
                </div>
            </div>
            <p style={{ fontSize: '1.1rem', margin: '1rem 0' }}>{obligation.description}</p>

            <div style={{ marginTop: '1rem', color: '#64748b' }}>
                Deadline: {new Date(obligation.deadline).toLocaleDateString()}
            </div>

            {/* Existing Attachments */}
            <div style={{ marginTop: '2rem', borderTop: '1px solid #e2e8f0', paddingTop: '1rem' }}>
                <h3>Evidence</h3>
                {existingAttachments.length > 0 ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                        {existingAttachments.map((att: any, index: number) => (
                            <div key={index} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                <span style={{ fontSize: '1.2rem' }}>📎</span>
                                <a href={att.url} target="_blank" style={{ color: 'blue', textDecoration: 'underline' }}>
                                    {att.name || 'View Attachment'}
                                </a>
                                <span style={{ fontSize: '0.8rem', color: '#64748b' }}>
                                    ({new Date(att.uploadedAt || Date.now()).toLocaleTimeString(undefined, { timeStyle: 'short' }) + ' ' + new Date(att.uploadedAt || Date.now()).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })})
                                </span>
                            </div>
                        ))}
                    </div>
                ) : (
                    <span style={{ color: '#64748b', fontStyle: 'italic' }}>No attachments</span>
                )}
            </div>

            {userRole === 'EMPLOYEE' && obligation.status !== 'COMPLETED' && (
                <div style={{ marginTop: '2rem', borderTop: '1px solid #e2e8f0', paddingTop: '1rem' }}>
                    <h3>Upload Evidence</h3>
                    <input
                        key={inputKey}
                        type="file"
                        multiple
                        onChange={handleFileSelect}
                        disabled={uploading}
                        style={{ marginTop: '0.5rem', display: 'block' }}
                    />

                    {/* Pending Files List */}
                    {pendingFiles.length > 0 && (
                        <div style={{ marginTop: '0.5rem', border: '1px solid #e2e8f0', borderRadius: '0.25rem', padding: '0.5rem' }}>
                            <p style={{ margin: '0 0 0.5rem 0', fontWeight: 'bold', fontSize: '0.875rem' }}>Pending Uploads:</p>
                            {pendingFiles.map((file, i) => (
                                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.875rem', marginBottom: '0.25rem' }}>
                                    <span>{file.name}</span>
                                    <button
                                        onClick={() => removePendingFile(i)}
                                        style={{ color: '#ef4444', background: 'none', border: 'none', cursor: 'pointer' }}
                                        disabled={uploading}
                                    >
                                        Remove
                                    </button>
                                </div>
                            ))}
                        </div>
                    )}

                    <div style={{ display: 'flex', gap: '1rem', marginTop: '1rem' }}>
                        <button
                            className="btn"
                            style={{ background: '#e2e8f0', color: '#0f172a' }}
                            onClick={() => handleUpload(true)}
                            disabled={uploading}
                        >
                            {uploading ? 'Saving...' : 'Save Progress'}
                        </button>
                        <button
                            className="btn btn-primary"
                            onClick={() => handleUpload(false)}
                            disabled={uploading}
                        >
                            {uploading ? 'Uploading...' : 'Complete Obligation'}
                        </button>
                    </div>
                </div>
            )}

            {/* Feedback Modal */}
            {showFeedback && (
                <div style={{
                    position: 'fixed',
                    top: '20px',
                    right: '20px',
                    background: 'white',
                    padding: '1rem',
                    borderRadius: '0.5rem',
                    boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
                    zIndex: 2000,
                    borderLeft: '4px solid #22c55e',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '1rem'
                }}>
                    <span>{feedbackMessage}</span>
                    <button onClick={() => setShowFeedback(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.2rem' }}>&times;</button>
                </div>
            )}

            {/* Delete Confirmation Modal */}
            {showDeleteConfirm && (
                <div style={{
                    position: 'fixed',
                    top: 0,
                    left: 0,
                    right: 0,
                    bottom: 0,
                    background: 'rgba(0, 0, 0, 0.5)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    zIndex: 3000
                }}>
                    <div className="card" style={{ maxWidth: '400px', padding: '1.5rem' }}>
                        <h3 style={{ marginTop: 0 }}>Confirm Delete</h3>
                        <p>Are you sure you want to delete this obligation? This action cannot be undone.</p>
                        <div style={{ display: 'flex', gap: '1rem', marginTop: '1.5rem' }}>
                            <button
                                onClick={handleDelete}
                                className="btn"
                                style={{ background: '#991b1b', color: 'white', flex: 1 }}
                            >
                                Delete
                            </button>
                            <button
                                onClick={() => setShowDeleteConfirm(false)}
                                className="btn"
                                style={{ background: '#e2e8f0', color: '#0f172a', flex: 1 }}
                            >
                                Cancel
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}

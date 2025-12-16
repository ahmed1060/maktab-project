'use client'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Modal from '@/components/Modal'

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

    const [isDragging, setIsDragging] = useState(false)

    const handleFiles = (files: File[]) => {
        const validFiles: File[] = []
        let hasError = false

        files.forEach(file => {
            if (file.size > 10 * 1024 * 1024) {
                hasError = true
            } else {
                validFiles.push(file)
            }
        })

        if (hasError) {
            setFeedbackMessage('Some files were rejected because they exceed 10MB.')
            setShowFeedback(true)
        }

        setPendingFiles(prev => [...prev, ...validFiles])
        setInputKey(prev => prev + 1)
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

    const [allUsers, setAllUsers] = useState<any[]>([])
    const [isReassigning, setIsReassigning] = useState(false)
    const [newAssigneeId, setNewAssigneeId] = useState('')

    const loadUsers = async () => {
        if (allUsers.length > 0) return
        const res = await fetch('/api/users')
        if (res.ok) {
            const data = await res.json()
            setAllUsers(data)
        }
    }

    const handleReassign = async () => {
        if (!newAssigneeId) return
        try {
            await fetch(`/api/obligations/${obligation.id}`, {
                method: 'PUT',
                body: JSON.stringify({ assigneeId: newAssigneeId }),
                headers: { 'Content-Type': 'application/json' }
            })
            setIsReassigning(false)
            router.refresh()
            setFeedbackMessage('Obligation reassigned successfully')
            setShowFeedback(true)
            setTimeout(() => setShowFeedback(false), 3000)
        } catch (error) {
            console.error('Reassign error', error)
        }
    }

    const handleForceComplete = async () => {
        try {
            await fetch(`/api/obligations/${obligation.id}`, {
                method: 'PUT',
                body: JSON.stringify({ status: 'COMPLETED' }),
                headers: { 'Content-Type': 'application/json' }
            })
            router.refresh()
        } catch (error) { console.error(error) }
    }

    return (
        <div className="card">

            {/* Deleted Assignee Alert */}
            {obligation.assignee?.status === 'DELETED' && ['ADMIN', 'SUPER_ADMIN', 'TEAM_LEADER'].includes(userRole) && (
                <div style={{ background: '#fee2e2', border: '1px solid #ef4444', color: '#991b1b', padding: '1.5rem', borderRadius: '0.5rem', marginBottom: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                        <span style={{ fontSize: '1.5rem' }}>🚫</span>
                        <div>
                            <strong>Assignee Deleted</strong>
                            <p style={{ margin: 0, fontSize: '0.9rem' }}>
                                The employee assigned to this obligation (<strong>{obligation.assignee.firstName} {obligation.assignee.lastName}</strong>) has been deleted.
                            </p>
                        </div>
                    </div>

                    <div style={{ display: 'flex', gap: '1rem', justifyContent: 'flex-end' }}>
                        <button
                            onClick={handleForceComplete}
                            className="btn"
                            style={{ background: '#166534', color: 'white' }}
                        >
                            Mark as Completed
                        </button>
                        <button
                            onClick={() => { setIsReassigning(true); loadUsers() }}
                            className="btn"
                            style={{ background: '#2563eb', color: 'white' }}
                        >
                            Reassign
                        </button>
                        <button
                            onClick={() => setShowDeleteConfirm(true)}
                            className="btn"
                            style={{ background: '#b91c1c', color: 'white' }}
                        >
                            Delete
                        </button>
                        <button
                            onClick={() => router.push('/dashboard/obligations')}
                            className="btn"
                            style={{ background: 'white', border: '1px solid #b91c1c', color: '#b91c1c' }}
                        >
                            Dismiss (Decide Later)
                        </button>
                    </div>
                </div>
            )}

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
                Deadline: {new Date(obligation.deadline).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} {new Date(obligation.deadline).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' })}
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
                    <div
                        onDragOver={(e) => { e.preventDefault(); setIsDragging(true) }}
                        onDragLeave={(e) => { e.preventDefault(); setIsDragging(false) }}
                        onDrop={(e) => {
                            e.preventDefault()
                            setIsDragging(false)
                            if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                                handleFiles(Array.from(e.dataTransfer.files))
                            }
                        }}
                        style={{
                            marginTop: '0.5rem',
                            border: `2px dashed ${isDragging ? '#3b82f6' : '#cbd5e1'}`,
                            borderRadius: '0.5rem',
                            padding: '2rem',
                            textAlign: 'center',
                            background: isDragging ? '#eff6ff' : '#f8fafc',
                            transition: 'all 0.2s ease',
                            cursor: 'pointer',
                            position: 'relative'
                        }}
                    >
                        <input
                            key={inputKey}
                            type="file"
                            multiple
                            accept=".jpg,.jpeg,.png,.gif,.webp,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx"
                            onChange={(e) => {
                                if (e.target.files) handleFiles(Array.from(e.target.files))
                            }}
                            disabled={uploading}
                            style={{
                                opacity: 0,
                                position: 'absolute',
                                top: 0,
                                left: 0,
                                width: '100%',
                                height: '100%',
                                cursor: 'pointer'
                            }}
                        />
                        <div style={{ pointerEvents: 'none' }}>
                            <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>☁️</div>
                            <p style={{ margin: 0, fontWeight: '600', color: '#475569' }}>
                                Click or drag files here to upload
                            </p>
                            <p style={{ margin: '0.25rem 0 0 0', fontSize: '0.8rem', color: '#94a3b8' }}>
                                Images, PDF, Office (Max 10MB)
                            </p>
                        </div>
                    </div>

                    {/* Pending Files List */}
                    {pendingFiles.length > 0 && (
                        <div style={{ marginTop: '1rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                            {pendingFiles.map((file, i) => (
                                <div key={i} style={{
                                    display: 'flex',
                                    justifyContent: 'space-between',
                                    alignItems: 'center',
                                    padding: '0.75rem',
                                    background: 'white',
                                    border: '1px solid #e2e8f0',
                                    borderRadius: '0.5rem',
                                    boxShadow: '0 1px 2px 0 rgba(0, 0, 0, 0.05)'
                                }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                                        <span style={{ fontSize: '1.2rem' }}>📄</span>
                                        <div>
                                            <div style={{ fontSize: '0.9rem', fontWeight: '500', color: '#334155' }}>{file.name}</div>
                                            <div style={{ fontSize: '0.75rem', color: '#94a3b8' }}>{(file.size / 1024 / 1024).toFixed(2)} MB</div>
                                        </div>
                                    </div>
                                    <button
                                        onClick={() => removePendingFile(i)}
                                        style={{
                                            color: '#ef4444',
                                            background: '#fef2f2',
                                            border: 'none',
                                            borderRadius: '0.25rem',
                                            padding: '0.25rem 0.5rem',
                                            cursor: 'pointer',
                                            fontSize: '0.875rem',
                                            fontWeight: '500',
                                            transition: 'background 0.2s'
                                        }}
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
            {/* Reassign Modal */}
            <Modal isOpen={isReassigning} onClose={() => setIsReassigning(false)} title="Reassign Obligation" hideFooter={true}>
                <div style={{ padding: '0.5rem' }}>
                    <p style={{ marginBottom: '1rem' }}>Select the employee you want to reassign this obligation to.</p>
                    <select
                        className="input"
                        value={newAssigneeId}
                        onChange={(e) => setNewAssigneeId(e.target.value)}
                        style={{ width: '100%', marginBottom: '1rem' }}
                    >
                        <option value="">Select Employee...</option>
                        {allUsers.filter(u => u.id !== obligation.assigneeId).map(u => (
                            <option key={u.id} value={u.id}>{u.firstName} {u.lastName} ({u.role})</option>
                        ))}
                    </select>

                    <div style={{ display: 'flex', gap: '1rem', justifyContent: 'flex-end' }}>
                        <button className="btn" onClick={() => setIsReassigning(false)}>Cancel</button>
                        <button className="btn btn-primary" onClick={handleReassign} disabled={!newAssigneeId}>
                            Confirm Reassign
                        </button>
                    </div>
                </div>
            </Modal>
        </div>
    )
}

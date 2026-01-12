'use client'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Modal from '@/components/Modal'
import { useLanguage } from '@/context/LanguageContext'

export default function ObligationDetailClient({ obligation, userRole }: { obligation: any, userRole: string }) {
    const { t, locale } = useLanguage()
    const [uploading, setUploading] = useState(false)
    const [loadingType, setLoadingType] = useState<'DRAFT' | 'SUBMIT' | null>(null)
    const [pendingFiles, setPendingFiles] = useState<File[]>([])
    const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
    const [showFeedback, setShowFeedback] = useState(false)
    const [feedbackMessage, setFeedbackMessage] = useState('')
    const [userId, setUserId] = useState<string | null>(null) // We need this to check if user is the assignee
    const [isReverting, setIsReverting] = useState(false)
    const [showRevertConfirm, setShowRevertConfirm] = useState(false)
    const router = useRouter()

    useEffect(() => {
        // Fetch current user ID if needed for permission checks
        fetch('/api/auth/session').then(r => r.json()).then(data => {
            if (data?.user?.id) setUserId(data.user.id)
        })
    }, [])

    // Listen for suspension auto-save event
    useEffect(() => {
        const handleSuspendSave = () => {
            console.log('Suspension detected, auto-saving obligation progress...')
            // Only auto-save if employee interaction is active and not already submitted or finalized
            if (userRole === 'EMPLOYEE' && !['PENDING_CONFIRMATION', 'APPROVED', 'COMPLETED', 'REJECTED'].includes(obligation.status)) {
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
        const allowedExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx']
        const validFiles: File[] = []
        let hasError = false
        let errorMsg = ''

        files.forEach(file => {
            // 1. Check Size
            if (file.size > 4 * 1024 * 1024) {
                hasError = true
                errorMsg = t('failed_upload_files') || `File ${file.name} is too large (max 4MB)`
            }
            // 2. Check Extension
            else {
                const ext = file.name.substring(file.name.lastIndexOf('.')).toLowerCase()
                if (!allowedExtensions.includes(ext)) {
                    hasError = true
                    errorMsg = `${t('error_generic') || 'Invalid file type'}: ${file.name}`
                } else {
                    validFiles.push(file)
                }
            }
        })

        if (hasError) {
            setFeedbackMessage(errorMsg)
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
        setLoadingType(isDraft ? 'DRAFT' : 'SUBMIT')
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

            const res = await fetch(`/api/obligations/${obligation.id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    status: isDraft ? 'IN_PROGRESS' : 'PENDING_CONFIRMATION',
                    newAttachments: uploadedAttachments // Send only new ones
                })
            })

            if (!res.ok) {
                const data = await res.json().catch(() => ({}))
                throw new Error(data.message || 'Update failed')
            }

            setPendingFiles([])
            router.refresh()
            setFeedbackMessage(isDraft ? t('draft_saved_success') : t('obligation_submitted_success' as any))
            setShowFeedback(true)
            setTimeout(() => setShowFeedback(false), 3000)
        } catch (error: any) {
            console.error("Update failed", error)
            setFeedbackMessage(error.message || t('failed_save_generic'))
            setShowFeedback(true)
        } finally {
            setUploading(false)
            setLoadingType(null)
        }
    }

    const handleApprove = async () => {
        try {
            const res = await fetch(`/api/obligations/${obligation.id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ status: 'APPROVED' })
            })
            if (res.ok) {
                router.refresh()
                setFeedbackMessage(t('obligation_approved_success' as any))
                setShowFeedback(true)
            }
        } catch (error) { console.error(error) }
    }

    const handleReject = async () => {
        try {
            const res = await fetch(`/api/obligations/${obligation.id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ status: 'REJECTED' })
            })
            if (res.ok) {
                router.refresh()
                setFeedbackMessage(t('obligation_rejected_success' as any))
                setShowFeedback(true)
            }
        } catch (error) { console.error(error) }
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
                const data = await res.json().catch(() => ({}))
                setFeedbackMessage(data.message || t('failed_save_generic'))
                setShowFeedback(true)
            }
        } catch (error: any) {
            console.error('Delete error:', error)
            setFeedbackMessage(error.message || t('failed_save_generic'))
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
            const filtered = userRole === 'TEAM_LEADER' ? data.filter((u: any) => !['ADMIN', 'SUPER_ADMIN'].includes(u.role)) : data
            setAllUsers(filtered)
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
            setFeedbackMessage(t('task_transfer_success'))
            setShowFeedback(true)
            setTimeout(() => setShowFeedback(false), 3000)
        } catch (error) {
            console.error('Reassign error', error)
        }
    }

    const handleForceComplete = async () => {
        // ... (existing code)
    }

    const handleRevert = async () => {
        setIsReverting(true)
        setShowRevertConfirm(false)
        try {
            const res = await fetch(`/api/obligations/${obligation.id}/revert`, { method: 'POST' })
            if (!res.ok) {
                const data = await res.json().catch(() => ({}))
                throw new Error(data.message || 'Revert failed')
            }
            setFeedbackMessage(t('obligation_reverted_success'))
            setShowFeedback(true)
            router.refresh()
        } catch (e: any) {
            console.error(e)
            setFeedbackMessage(e.message || t('failed_revert_obligation'))
            setShowFeedback(true)
        } finally {
            setIsReverting(false)
        }
    }

    const containerStyle: React.CSSProperties = {
        direction: locale === 'ar' ? 'rtl' : 'ltr',
        textAlign: locale === 'ar' ? 'right' : 'left'
    }

    return (
        <div className="card" style={containerStyle}>

            {/* Deleted Assignee Alert */}
            {obligation.assignee?.status === 'DELETED' && ['ADMIN', 'SUPER_ADMIN', 'TEAM_LEADER'].includes(userRole) && (
                <div style={{ background: '#fee2e2', border: '1px solid #ef4444', color: '#991b1b', padding: '1.5rem', borderRadius: '0.5rem', marginBottom: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexDirection: 'row' }}>
                        <span style={{ fontSize: '1.5rem' }}>🚫</span>
                        <div style={{ textAlign: locale === 'ar' ? 'right' : 'left' }}>
                            <strong>{t('assignee_deleted_alert')}</strong>
                            <p style={{ margin: 0, fontSize: '0.9rem' }}>
                                {t('assignee_deleted_msg').replace('{name}', `${obligation.assignee.firstName} ${obligation.assignee.lastName}`)}
                            </p>
                        </div>
                    </div>

                    <div style={{ display: 'flex', gap: '1rem', justifyContent: 'flex-end', flexDirection: 'row' }}>
                        <button
                            onClick={handleForceComplete}
                            className="btn"
                            style={{ background: '#166534', color: 'white' }}
                        >
                            {t('mark_as_completed')}
                        </button>
                        <button
                            onClick={() => { setIsReassigning(true); loadUsers() }}
                            className="btn"
                            style={{ background: '#2563eb', color: 'white' }}
                        >
                            {t('reassign_button')}
                        </button>
                        <button
                            onClick={() => setShowDeleteConfirm(true)}
                            className="btn"
                            style={{ background: '#b91c1c', color: 'white' }}
                        >
                            {t('delete')}
                        </button>
                        <button
                            onClick={() => router.push('/dashboard/obligations')}
                            className="btn"
                            style={{ background: 'white', border: '1px solid #b91c1c', color: '#b91c1c' }}
                        >
                            {t('dismiss_decide_later')}
                        </button>
                    </div>
                </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexDirection: 'row' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexDirection: 'row' }}>
                    <h1 style={{ margin: 0 }}>{obligation.title}</h1>
                    <span style={{
                        fontSize: '0.75rem',
                        fontWeight: '600',
                        padding: '0.25rem 0.75rem',
                        borderRadius: '9999px',
                        background: obligation.status === 'COMPLETED' ? '#dcfce7' : obligation.status === 'REJECTED' || obligation.status === 'APPROVED' ? (obligation.status === 'APPROVED' ? '#dcfce7' : '#fee2e2') : '#f1f5f9',
                        color: obligation.status === 'COMPLETED' ? '#166534' : obligation.status === 'REJECTED' || obligation.status === 'APPROVED' ? (obligation.status === 'APPROVED' ? '#166534' : '#991b1b') : '#475569',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '0.35rem'
                    }}>
                        {t(`status_${obligation.status.toLowerCase()}` as any)}
                        {obligation.lastStatusUpdateBy && (['APPROVED', 'REJECTED', 'COMPLETED'].includes(obligation.status)) && (
                            <span style={{ fontWeight: 'normal', opacity: 0.8, fontSize: '0.7rem' }}>
                                • {obligation.lastStatusUpdateBy}
                            </span>
                        )}
                    </span>
                    <span style={{
                        padding: '0.25rem 0.75rem',
                        borderRadius: '9999px',
                        background: '#3b82f6',
                        color: 'white',
                        fontWeight: 'bold',
                        fontSize: '0.9rem',
                        display: 'inline-flex',
                        alignItems: 'center'
                    }}>
                        {obligation.difficulty} {t('points_label_plural')}
                    </span>
                </div>
                <div style={{ display: 'flex', gap: '0.5rem', flexDirection: 'row' }}>
                    <button
                        onClick={() => router.push('/dashboard/obligations')}
                        style={{ background: 'none', border: '1px solid #cbd5e1', borderRadius: '0.25rem', padding: '0.5rem 1rem', cursor: 'pointer', color: '#64748b' }}
                    >
                        {t('close_button')}
                    </button>
                    {userRole === 'SUPER_ADMIN' && ['APPROVED', 'COMPLETED', 'REJECTED', 'PENDING_CONFIRMATION'].includes(obligation.status) && (
                        <button
                            onClick={() => setShowRevertConfirm(true)}
                            style={{
                                background: '#f8fafc',
                                color: '#475569',
                                border: '1px solid #cbd5e1',
                                borderRadius: '0.25rem',
                                padding: '0.5rem 1rem',
                                cursor: 'pointer',
                                fontWeight: '600'
                            }}
                        >
                            {isReverting ? t('reverting') : t('return_to_in_progress')}
                        </button>
                    )}
                    {['ADMIN', 'SUPER_ADMIN', 'TEAM_LEADER'].includes(userRole) && (userRole === 'TEAM_LEADER' || userId !== obligation.assigneeId) && (
                        <button
                            onClick={() => setShowDeleteConfirm(true)}
                            style={{ background: '#fee2e2', color: '#991b1b', border: 'none', borderRadius: '0.25rem', padding: '0.5rem 1rem', cursor: 'pointer' }}
                        >
                            {t('delete_task_button').replace(t('tasks'), t('obligations'))}
                        </button>
                    )}
                </div>
            </div>
            <p style={{ fontSize: '1.1rem', margin: '1rem 0' }}>{obligation.description}</p>

            <div style={{ marginTop: '1rem', color: '#64748b' }}>
                {t('deadline_label')}: {new Date(obligation.deadline).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })} {new Date(obligation.deadline).toLocaleDateString(locale === 'ar' ? 'ar-EG' : 'en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' })}
            </div>

            {/* Existing Attachments */}
            <div style={{ marginTop: '2rem', borderTop: '1px solid #e2e8f0', paddingTop: '1rem' }}>
                <h3>{t('attachments_label' as any)}</h3>
                {existingAttachments.length > 0 ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                        {existingAttachments.map((att: any, index: number) => (
                            <div key={index} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexDirection: 'row' }}>
                                <span style={{ fontSize: '1.2rem' }}>📎</span>
                                <a href={att.url} target="_blank" style={{ color: 'blue', textDecoration: 'underline' }}>
                                    {att.name || t('view_photo')}
                                </a>
                                <span style={{ fontSize: '0.8rem', color: '#64748b' }}>
                                    ({new Date(att.uploadedAt || Date.now()).toLocaleTimeString(locale, { timeStyle: 'short' }) + ' ' + new Date(att.uploadedAt || Date.now()).toLocaleDateString(locale === 'ar' ? 'ar-EG' : 'en-GB', { day: 'numeric', month: 'short', year: 'numeric' })})
                                </span>
                            </div>
                        ))}
                    </div>
                ) : (
                    <span style={{ color: '#64748b', fontStyle: 'italic' }}>{t('no_attachments_msg')}</span>
                )}
            </div>

            {userRole === 'EMPLOYEE' && !['PENDING_CONFIRMATION', 'APPROVED', 'COMPLETED', 'REJECTED'].includes(obligation.status) && (
                <div style={{ marginTop: '2rem', borderTop: '1px solid #e2e8f0', paddingTop: '1rem' }}>
                    <h3>{t('attachments_optional_label').split(' ')[0]}</h3>
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
                                if (e.target.files) {
                                    handleFiles(Array.from(e.target.files))
                                    e.target.value = ''
                                }
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
                                {t('upload_drag_files_msg')}
                            </p>
                            <p style={{ margin: '0.25rem 0 0 0', fontSize: '0.8rem', color: '#94a3b8' }}>
                                {t('upload_allowed_types_msg')}
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
                                    boxShadow: '0 1px 2px 0 rgba(0, 0, 0, 0.05)',
                                    flexDirection: 'row'
                                }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexDirection: 'row' }}>
                                        <span style={{ fontSize: '1.2rem' }}>📄</span>
                                        <div style={{ textAlign: locale === 'ar' ? 'right' : 'left' }}>
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
                                        {t('delete')}
                                    </button>
                                </div>
                            ))}
                        </div>
                    )}

                    <div style={{ display: 'flex', gap: '1rem', marginTop: '1rem', flexDirection: 'row' }}>
                        <button
                            className="btn"
                            style={{ background: '#e2e8f0', color: '#0f172a' }}
                            onClick={() => handleUpload(true)}
                            disabled={uploading}
                        >
                            {loadingType === 'DRAFT' ? t('saving') : t('save_draft_button').replace(t('tasks'), t('obligations'))}
                        </button>
                        <button
                            className="btn btn-primary"
                            onClick={() => handleUpload(false)}
                            disabled={uploading}
                        >
                            {loadingType === 'SUBMIT' ? t('submitting_obligation' as any) : t('submit_obligation' as any)}
                        </button>
                    </div>
                </div>
            )}

            {/* Finalized/Pending Message for Employees */}
            {userRole === 'EMPLOYEE' && ['PENDING_CONFIRMATION', 'APPROVED', 'COMPLETED'].includes(obligation.status) && (
                <div style={{ marginTop: '2rem', padding: '1.5rem', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '0.5rem', textAlign: 'center' }}>
                    <p style={{ margin: 0, color: '#475569', fontWeight: '500' }}>
                        {obligation.status === 'PENDING_CONFIRMATION'
                            ? t('pending_confirmation_msg' as any) || "Submitted and awaiting review"
                            : t('obligation_finalized_msg' as any) || "This obligation has been finalized and cannot be modified."}
                    </p>
                </div>
            )}

            {/* Approve/Reject Buttons (Admins only) */}
            {['ADMIN', 'SUPER_ADMIN', 'TEAM_LEADER'].includes(userRole) && obligation.status === 'PENDING_CONFIRMATION' && (userRole === 'TEAM_LEADER' || userId !== obligation.assigneeId) && (
                <div style={{ marginTop: '2.5rem', display: 'flex', gap: '1.25rem', borderTop: '2px solid #e2e8f0', paddingTop: '2rem', flexDirection: 'row' }}>
                    <button onClick={handleApprove} className="btn btn-primary" style={{ flex: 1, padding: '1rem', fontSize: '1.1rem', fontWeight: '700' }}>{t('approve_button')}</button>
                    <button onClick={handleReject} className="btn" style={{ flex: 1, padding: '1rem', fontSize: '1.1rem', fontWeight: '700', background: '#ef4444', color: 'white' }}>{t('reject_button')}</button>
                </div>
            )}

            {/* Feedback Modal */}
            {showFeedback && (
                <div style={{
                    position: 'fixed',
                    top: '20px',
                    [locale === 'ar' ? 'left' : 'right']: '20px',
                    background: 'white',
                    padding: '1rem',
                    borderRadius: '0.5rem',
                    boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
                    zIndex: 2000,
                    [locale === 'ar' ? 'borderRight' : 'borderLeft']: '4px solid #22c55e',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '1rem',
                    direction: locale === 'ar' ? 'rtl' : 'ltr'
                }}>
                    <span>{feedbackMessage}</span>
                    <button onClick={() => setShowFeedback(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.2rem' }}>&times;</button>
                </div>
            )}

            {/* Delete Confirmation Modal */}
            <Modal isOpen={showDeleteConfirm} onClose={() => setShowDeleteConfirm(false)} title={t('delete_task_title').replace(t('tasks'), t('obligations'))} hideFooter>
                <div style={{ textAlign: locale === 'ar' ? 'right' : 'left' }}>
                    <p>{t('delete_task_warning').replace(t('tasks'), t('obligations'))}</p>
                    <div style={{ display: 'flex', gap: '1rem', marginTop: '1.5rem', justifyContent: 'flex-end', flexDirection: 'row' }}>
                        <button onClick={() => setShowDeleteConfirm(false)} className="btn" style={{ background: '#e2e8f0' }}>{t('cancel')}</button>
                        <button onClick={handleDelete} className="btn" style={{ background: '#dc2626', color: 'white' }}>{t('delete')}</button>
                    </div>
                </div>
            </Modal>
            {/* Reassign Modal */}
            <Modal isOpen={isReassigning} onClose={() => setIsReassigning(false)} title={t('reassign_button')} hideFooter={true}>
                <div style={{ padding: '0.5rem', textAlign: locale === 'ar' ? 'right' : 'left' }}>
                    <p style={{ marginBottom: '1rem' }}>{t('transfer_task_msg')}</p>
                    <select
                        className="input"
                        value={newAssigneeId}
                        onChange={(e) => setNewAssigneeId(e.target.value)}
                        style={{ width: '100%', marginBottom: '1rem', textAlign: locale === 'ar' ? 'right' : 'left' }}
                    >
                        <option value="">{t('select_employee_placeholder')}...</option>
                        {allUsers.filter(u => u.id !== obligation.assigneeId).map(u => (
                            <option key={u.id} value={u.id}>{u.firstName} {u.lastName} ({u.role})</option>
                        ))}
                    </select>

                    <div style={{ display: 'flex', gap: '1rem', justifyContent: 'flex-end', flexDirection: 'row' }}>
                        <button className="btn" onClick={() => setIsReassigning(false)}>{t('cancel')}</button>
                        <button className="btn btn-primary" onClick={handleReassign} disabled={!newAssigneeId}>
                            {t('confirm_transfer_button')}
                        </button>
                    </div>
                </div>
            </Modal>
            {/* Revert Confirmation Modal */}
            <Modal isOpen={showRevertConfirm} onClose={() => setShowRevertConfirm(false)} title={t('return_to_in_progress')} hideFooter>
                <div style={{ textAlign: locale === 'ar' ? 'right' : 'left' }}>
                    <p>{t('confirm_action_button') + '?'}</p>
                    <div style={{ display: 'flex', gap: '1rem', marginTop: '1.5rem', justifyContent: 'flex-end', flexDirection: 'row' }}>
                        <button onClick={() => setShowRevertConfirm(false)} className="btn" style={{ background: '#e2e8f0' }}>{t('cancel')}</button>
                        <button onClick={handleRevert} className="btn" style={{ background: '#2563eb', color: 'white' }}>
                            {isReverting ? '...' : t('confirm_action_button')}
                        </button>
                    </div>
                </div>
            </Modal>
        </div>
    )
}

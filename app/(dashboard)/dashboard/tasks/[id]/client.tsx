/* eslint-disable @typescript-eslint/no-explicit-any */
'use client'
import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import Modal from '@/components/Modal'
import DiffViewer from '@/components/DiffViewer'
import { useToast } from '@/context/ToastContext'
import DateTimePicker from '@/components/DateTimePicker'
import { useLanguage } from '@/context/LanguageContext'

export default function TaskDetailClient({ task: initialTask, userRole, userId, creatorName, currentUserName }: { task: any, userRole: string, userId: string, creatorName: string, currentUserName: string }) {
    const { t, locale } = useLanguage()
    const [task, setTask] = useState(initialTask)
    const [existingAttachments, setExistingAttachments] = useState<any[]>(() => {
        try {
            return initialTask.attachments ? JSON.parse(initialTask.attachments) : []
        } catch { return [] }
    })
    const [note, setNote] = useState('')
    const [cost, setCost] = useState('')
    const [costDescription, setCostDescription] = useState('')
    const [location, setLocation] = useState('')
    const [locationStatus, setLocationStatus] = useState('')
    const [uploading, setUploading] = useState(false)
    const [capturingLocation, setCapturingLocation] = useState(false)
    const [pendingFiles, setPendingFiles] = useState<File[]>([])
    const [inputKey, setInputKey] = useState(Date.now())
    const [isDragging, setIsDragging] = useState(false)
    const [costEntries, setCostEntries] = useState<any[]>([])
    const [isTransferModalOpen, setIsTransferModalOpen] = useState(false)
    const [transferAssigneeId, setTransferAssigneeId] = useState('')
    const [allUsers, setAllUsers] = useState<any[]>([])
    const [transferring, setTransferring] = useState(false)
    const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
    const [isEditing, setIsEditing] = useState(false)
    const [editForm, setEditForm] = useState({
        title: initialTask.title,
        description: initialTask.description,
        assigneeId: initialTask.assigneeId,
        deadline: initialTask.deadline,
        difficulty: initialTask.difficulty
    })
    const [editFieldErrors, setEditFieldErrors] = useState({ title: '', description: '' })
    const [isReviewModalOpen, setIsReviewModalOpen] = useState(false)
    const [reviewAction, setReviewAction] = useState<'APPROVED' | 'REJECTED' | null>(null)
    const [reviewDifficulty, setReviewDifficulty] = useState(initialTask.difficulty)
    const [submittingReview, setSubmittingReview] = useState(false)
    const [viewedTitleChange, setViewedTitleChange] = useState(false)
    const [viewedDescriptionChange, setViewedDescriptionChange] = useState(false)
    const [diffField, setDiffField] = useState<'title' | 'description' | null>(null)
    const [isEditedPersistent, setIsEditedPersistent] = useState(initialTask.isEdited)
    const [latestChanges, setLatestChanges] = useState<{ title?: any, description?: any } | null>(null)
    const [showSubmitConfirm, setShowSubmitConfirm] = useState(false)
    const [locationToDelete, setLocationToDelete] = useState<{ index?: number, date?: string } | null>(null)

    const router = useRouter()
    const { showToast } = useToast()

    useEffect(() => {
        if (task.comments) {
            try {
                const logs = JSON.parse(task.comments)
                if (Array.isArray(logs)) {
                    const lastEdit = [...logs].reverse().find((l: any) => l.type === 'TASK_EDITED')
                    if (lastEdit && lastEdit.changes) {
                        setLatestChanges(lastEdit.changes)
                    }
                }
            } catch (e) { console.error('Error parsing changes:', e) }
        }
    }, [task.comments])

    useEffect(() => {
        if (userId === task.assigneeId && (task.isEdited || isEditedPersistent)) {
            // Logic to track if they've seen it could be here
        }
    }, [userId, task.assigneeId, task.isEdited, isEditedPersistent])

    const handleDismiss = async () => {
        try {
            await fetch(`/api/tasks/${task.id}/dismiss-edit`, { method: 'POST' })
            setIsEditedPersistent(false)
            setTask({ ...task, isEdited: false })
            router.refresh()
        } catch (e) { console.error(e) }
    }

    const handleFiles = (newFiles: File[]) => {
        const allowedExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx']

        const validFiles = newFiles.filter(file => {
            // 1. Check Size
            if (file.size > 10 * 1024 * 1024) {
                showToast(t('failed_upload_files') || `File ${file.name} is too large (max 10MB)`, 'error')
                return false
            }

            // 2. Check Extension
            const ext = file.name.substring(file.name.lastIndexOf('.')).toLowerCase()
            if (!allowedExtensions.includes(ext)) {
                showToast(`${t('error_generic') || 'Invalid file type'}: ${file.name}`, 'error')
                return false
            }

            return true
        })
        setPendingFiles(prev => [...prev, ...validFiles])
    }

    const removePendingFile = (index: number) => {
        setPendingFiles(prev => prev.filter((_, i) => i !== index))
    }

    const handleAddCost = () => {
        if (!cost) return
        if (parseFloat(cost) < 0) {
            showToast(t('cost_negative_error'), 'error')
            return
        }
        setCostEntries(prev => [...prev, { amount: parseFloat(cost), description: costDescription || '' }])
        setCost('')
        setCostDescription('')
    }

    const removeCostEntry = (index: number) => {
        setCostEntries(prev => prev.filter((_, i) => i !== index))
    }

    const handleUploadRequest = () => {
        if (pendingFiles.length === 0 && costEntries.length === 0 && !note.trim()) {
            setShowSubmitConfirm(true)
        } else {
            handleUpload(false)
        }
    }

    const handleUpload = async (isDraft: boolean) => {
        if (uploading) return
        setUploading(true)
        console.log('handleUpload started, isDraft:', isDraft)

        try {
            let uploadedUrls: string[] = []
            if (pendingFiles.length > 0) {
                const formData = new FormData()
                pendingFiles.forEach(file => formData.append('files', file))
                formData.append('taskId', task.id)

                const uploadRes = await fetch('/api/upload', {
                    method: 'POST',
                    body: formData
                })

                if (!uploadRes.ok) throw new Error('Upload failed')
                const data = await uploadRes.json()
                uploadedUrls = data.urls
            }

            const res = await fetch(`/api/tasks/${task.id}/submit`, {
                method: 'PUT',
                body: JSON.stringify({
                    newAttachments: uploadedUrls,
                    note,
                    costEntries,
                    location,
                    isDraft
                }),
                headers: { 'Content-Type': 'application/json' }
            })

            if (!res.ok) throw new Error('Submission failed')

            showToast(isDraft ? t('draft_saved_success') : t('task_submitted_success'), 'success')
            if (!isDraft) {
                setNote('')
                setCost('')
                setCostDescription('')
                setLocation('')
                setLocationStatus('')
                setPendingFiles([])
                setCostEntries([])
            }
            router.refresh()
        } catch (error) {
            console.error('handleUpload error:', error)
            showToast(t('failed_save_generic') as any, 'error')
        } finally {
            setUploading(false)
        }
    }

    const handleCaptureLocation = async () => {
        if (!navigator.geolocation) {
            setLocationStatus('Geolocation not supported')
            return
        }

        try {
            const comments = JSON.parse(task.comments || '[]')
            const locationCount = Array.isArray(comments) ? comments.filter((c: any) => c.type === 'LOCATION_ADDED').length : 0
            if (locationCount >= 2) {
                showToast(t('max_locations_error'), 'error')
                return
            }
        } catch (e) { console.error(e) }

        setCapturingLocation(true)
        setLocationStatus(t('capturing_location_button'))

        navigator.geolocation.getCurrentPosition(
            async (pos) => {
                const { latitude, longitude } = pos.coords
                const locationString = `{"latitude": ${latitude}, "longitude": ${longitude}}`
                setLocation(locationString)
                setLocationStatus(t('location_captured_saving'))

                try {
                    const res = await fetch(`/api/tasks/${task.id}/submit`, {
                        method: 'PUT',
                        body: JSON.stringify({
                            newAttachments: [],
                            note: '',
                            costEntries: [],
                            location: locationString,
                            isDraft: true
                        }),
                        headers: { 'Content-Type': 'application/json' }
                    })

                    if (res.ok) {
                        setLocationStatus(t('location_saved_success'))
                        setLocation('')
                        router.refresh()
                        setTimeout(() => setLocationStatus(''), 3000)
                    } else {
                        throw new Error('Auto-save failed')
                    }
                } catch (error) {
                    console.error('Location save failed:', error)
                    setLocationStatus(t('failed_save_generic'))
                }
                setCapturingLocation(false)
            },
            (err) => {
                console.error('Geolocation error:', err)
                setLocationStatus('Failed to get location')
                setCapturingLocation(false)
            },
            { enableHighAccuracy: true, timeout: 10000 }
        )
    }

    const handleApprove = () => {
        setReviewAction('APPROVED')
        setReviewDifficulty(task.difficulty)
        setIsReviewModalOpen(true)
    }

    const handleReject = () => {
        setReviewAction('REJECTED')
        setIsReviewModalOpen(true)
    }

    const submitReview = async (forcedStatus?: string, forcedDifficulty?: number) => {
        if (submittingReview) return
        setSubmittingReview(true)

        const action = forcedStatus || reviewAction
        const diff = forcedDifficulty !== undefined ? forcedDifficulty : reviewDifficulty

        try {
            const res = await fetch(`/api/tasks/${task.id}/review`, {
                method: 'POST',
                body: JSON.stringify({ action, difficulty: diff }),
                headers: { 'Content-Type': 'application/json' }
            })

            if (!res.ok) throw new Error('Review failed')

            showToast(action === 'APPROVED' ? t('task_approved_success') : t('task_rejected_success'), 'success')
            setIsReviewModalOpen(false)
            router.refresh()
        } catch (e) {
            console.error(e)
            showToast(t('failed_process_review'), 'error')
        } finally {
            setSubmittingReview(false)
        }
    }

    const handleDelete = async () => {
        try {
            const res = await fetch(`/api/tasks/${task.id}`, { method: 'DELETE' })
            if (!res.ok) throw new Error('Delete failed')
            showToast(t('task_deleted_success'), 'success')
            router.push('/dashboard/tasks')
            router.refresh()
        } catch (e) {
            console.error(e)
            showToast(t('error_generic'), 'error')
        }
    }

    const handleTransfer = async () => {
        if (!transferAssigneeId || transferring) return
        setTransferring(true)
        try {
            const res = await fetch(`/api/tasks/${task.id}/transfer`, {
                method: 'POST',
                body: JSON.stringify({ newAssigneeId: transferAssigneeId }),
                headers: { 'Content-Type': 'application/json' }
            })
            if (!res.ok) throw new Error('Transfer failed')
            showToast(t('task_transfer_success'), 'success')
            setIsTransferModalOpen(false)
            router.refresh()
        } catch (e) {
            console.error(e)
            showToast(t('failed_transfer_task'), 'error')
        } finally {
            setTransferring(false)
        }
    }

    const isTransferredTask = () => {
        try {
            const logs = JSON.parse(task.comments || '[]')
            return Array.isArray(logs) && logs.some((l: any) => l.type === 'TASK_TRANSFERRED')
        } catch { return false }
    }

    const handleEditClick = () => {
        if (['APPROVED', 'COMPLETED', 'REJECTED'].includes(task.status)) {
            showToast(t('cannot_edit_submitted_task'), 'error')
            return
        }
        setEditForm({
            title: task.title,
            description: task.description,
            assigneeId: task.assigneeId,
            deadline: task.deadline,
            difficulty: task.difficulty
        })
        setIsEditing(true)
    }

    const handleSaveDetails = async (e: React.FormEvent) => {
        e.preventDefault()
        let hasError = false
        const errors = { title: '', description: '' }

        if (!editForm.title.trim()) {
            errors.title = t('title_required')
            hasError = true
        }
        if (!editForm.description.trim()) {
            errors.description = t('description_required')
            hasError = true
        }

        if (hasError) {
            setEditFieldErrors(errors)
            return
        }

        try {
            const res = await fetch(`/api/tasks/${task.id}/details`, {
                method: 'PUT',
                body: JSON.stringify(editForm),
                headers: { 'Content-Type': 'application/json' }
            })
            if (!res.ok) throw new Error('Update failed')
            showToast(t('task_details_updated_success'), 'success')
            setIsEditing(false)
            router.refresh()
        } catch (e) {
            console.error(e)
            showToast(t('failed_update_task'), 'error')
        }
    }

    const handlePaymentStatusChange = async (newStatus: string) => {
        try {
            const res = await fetch(`/api/tasks/${task.id}/payment-status`, {
                method: 'PUT',
                body: JSON.stringify({ paymentStatus: newStatus }),
                headers: { 'Content-Type': 'application/json' }
            })
            if (!res.ok) throw new Error('Update failed')
            showToast(t('payment_status_updated_prefix') + newStatus, 'success')
            router.refresh()
        } catch (e) {
            console.error(e)
            showToast(t('failed_update_payment_status'), 'error')
        }
    }

    const confirmDeleteLocation = async () => {
        if (!locationToDelete) return
        try {
            const res = await fetch(`/api/tasks/${task.id}/locations`, {
                method: 'DELETE',
                body: JSON.stringify(locationToDelete),
                headers: { 'Content-Type': 'application/json' }
            })
            if (!res.ok) throw new Error('Delete location failed')
            showToast(t('location_deleted_success'), 'success')
            setLocationToDelete(null)
            router.refresh()
        } catch (e) {
            console.error(e)
            showToast(t('failed_delete_location'), 'error')
        }
    }

    const containerStyle: React.CSSProperties = {
        direction: locale === 'ar' ? 'rtl' : 'ltr',
        textAlign: locale === 'ar' ? 'right' : 'left'
    }

    const headerRowStyle: React.CSSProperties = {
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        flexDirection: 'row',
        gap: '1rem',
        flexWrap: 'wrap'
    }

    const badgeGroupStyle: React.CSSProperties = {
        display: 'flex',
        alignItems: 'center',
        gap: '0.75rem',
        flexDirection: 'row'
    }

    const alertStyle: React.CSSProperties = {
        padding: '1rem',
        borderRadius: '0.5rem',
        marginBottom: '1.5rem',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        flexDirection: 'row'
    }

    return (
        <div className="card" style={containerStyle}>
            {/* Deleted Assignee Alert */}
            {task.assignee?.status === 'DELETED' && ['ADMIN', 'SUPER_ADMIN', 'TEAM_LEADER'].includes(userRole) && !['COMPLETED', 'APPROVED', 'REJECTED'].includes(task.status) && (
                <div style={{ ...alertStyle, background: '#fee2e2', border: '1px solid #ef4444', color: '#991b1b', flexDirection: 'column', gap: '1rem', alignItems: 'stretch' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexDirection: 'row' }}>
                        <span style={{ fontSize: '1.5rem' }}>🚫</span>
                        <div style={{ textAlign: locale === 'ar' ? 'right' : 'left' }}>
                            <strong>{t('assignee_deleted_alert')}</strong>
                            <p style={{ margin: 0, fontSize: '0.9rem' }}>
                                {t('assignee_deleted_msg').replace('{name}', `${task.assignee.firstName} ${task.assignee.lastName}`)}
                            </p>
                        </div>
                    </div>
                    <div style={{ display: 'flex', gap: '1rem', justifyContent: 'flex-end', flexDirection: 'row' }}>
                        <button onClick={() => submitReview('COMPLETED', task.difficulty)} className="btn" style={{ background: '#166534', color: 'white' }}>{t('mark_as_completed')}</button>
                        <button onClick={() => { if (allUsers.length === 0) fetch('/api/users').then(r => r.json()).then(setAllUsers); setIsTransferModalOpen(true); }} className="btn" style={{ background: '#2563eb', color: 'white' }}>{t('reassign_button')}</button>
                        <button onClick={() => router.push('/dashboard/tasks')} className="btn" style={{ background: 'white', border: '1px solid #b91c1c', color: '#b91c1c' }}>{t('dismiss_decide_later')}</button>
                    </div>
                </div>
            )}

            {/* Task Edited Alert */}
            {task.isEdited && (userRole === 'EMPLOYEE' || userId === task.assigneeId) && (
                <div style={{ ...alertStyle, background: '#fff7ed', border: '1px solid #fdba74', color: '#9a3412' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexDirection: 'row' }}>
                        <span style={{ fontSize: '1.5rem' }}>⚠️</span>
                        <div style={{ textAlign: locale === 'ar' ? 'right' : 'left' }}>
                            <strong>{t('task_updated_alert')}</strong>
                            <p style={{ margin: 0, fontSize: '0.9rem' }}>
                                {t('task_updated_msg').replace('{author}', (() => {
                                    try {
                                        const logs = JSON.parse(task.comments || '[]')
                                        if (Array.isArray(logs)) {
                                            const lastEdit = [...logs].reverse().find((l: any) => l.type === 'TASK_EDITED')
                                            return lastEdit?.author || t('an_admin')
                                        }
                                        return t('an_admin')
                                    } catch { return locale === 'ar' ? 'مسؤول' : 'an admin' }
                                })())}
                            </p>
                        </div>
                    </div>
                    <button onClick={handleDismiss} className="btn" style={{ background: '#ffedd5', color: '#9a3412', border: '1px solid #fdba74' }}>{t('i_understand_button')}</button>
                </div>
            )}

            {/* Diff Modal */}
            <Modal isOpen={!!diffField} onClose={() => setDiffField(null)} title={diffField === 'title' ? t('title_changes_title') : t('description_changes_title')}>
                {diffField && latestChanges && latestChanges[diffField] && (
                    <div style={{ direction: 'ltr' }}>
                        <DiffViewer oldText={latestChanges[diffField].from} newText={latestChanges[diffField].to} />
                    </div>
                )}
            </Modal>

            <div style={headerRowStyle}>
                <div style={badgeGroupStyle}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexDirection: 'row' }}>
                        <h1 style={{ margin: 0 }}>{task.title}</h1>
                        {(task.isEdited || isEditedPersistent) && userId === task.assigneeId && latestChanges?.title && !viewedTitleChange && (
                            <button onClick={() => { setDiffField('title'); setViewedTitleChange(true); }} style={{ background: '#ffedd5', color: '#9a3412', border: '1px solid #fdba74', borderRadius: '0.25rem', padding: '0.25rem 0.5rem', fontSize: '0.75rem', cursor: 'pointer', fontWeight: 'bold' }}>{t('edit')}</button>
                        )}
                    </div>
                    <span style={{ padding: '0.25rem 0.75rem', borderRadius: '9999px', background: '#3b82f6', color: 'white', fontWeight: 'bold', fontSize: '0.9rem' }}>{task.difficulty} {t('points_label_plural')}</span>
                    <span style={{ padding: '0.5rem', borderRadius: '0.5rem', background: task.status === 'COMPLETED' ? '#e0f2fe' : task.status === 'APPROVED' ? '#dcfce7' : task.status === 'PENDING_CONFIRMATION' ? '#fef9c3' : task.status === 'REJECTED' ? '#fee2e2' : '#e2e8f0', color: task.status === 'COMPLETED' ? '#0369a1' : task.status === 'APPROVED' ? '#166534' : task.status === 'PENDING_CONFIRMATION' ? '#854d0e' : task.status === 'REJECTED' ? '#991b1b' : '#0f172a' }}>
                        {t(`status_${task.status.toLowerCase()}` as any)}
                    </span>
                    {task.totalCost > 0 && (task.status === 'APPROVED' || task.status === 'COMPLETED') && (
                        <span style={{ padding: '0.5rem', borderRadius: '0.5rem', background: task.paymentStatus === 'PAID' ? '#d1fae5' : '#fed7aa', color: task.paymentStatus === 'PAID' ? '#065f46' : '#9a3412', fontSize: '0.875rem', fontWeight: '600' }}>
                            {task.paymentStatus === 'PAID' ? t('paid_status') : t('pending_payment_status')}
                        </span>
                    )}
                </div>
                <div style={{ display: 'flex', gap: '0.5rem', flexDirection: 'row' }}>
                    {task.totalCost > 0 && (task.status === 'APPROVED' || task.status === 'COMPLETED') && ['ADMIN', 'SUPER_ADMIN'].includes(userRole) && (
                        <button onClick={() => handlePaymentStatusChange(task.paymentStatus === 'PAID' ? 'PENDING_PAYMENT' : 'PAID')} style={{ background: task.paymentStatus === 'PAID' ? '#fed7aa' : '#d1fae5', color: task.paymentStatus === 'PAID' ? '#9a3412' : '#065f46', border: 'none', borderRadius: '0.25rem', padding: '0.5rem 1rem', cursor: 'pointer', fontSize: '0.875rem', fontWeight: '600' }}>
                            {task.paymentStatus === 'PAID' ? t('mark_as_pending_button') : t('mark_as_paid')}
                        </button>
                    )}
                    <button onClick={() => router.back()} style={{ background: 'none', border: '1px solid #cbd5e1', borderRadius: '0.25rem', padding: '0.5rem 1rem', cursor: 'pointer', color: '#64748b' }}>{t('close_button')}</button>
                    {['ADMIN', 'SUPER_ADMIN', 'TEAM_LEADER'].includes(userRole) && userId !== task.assigneeId && (<button onClick={handleEditClick} style={{ background: '#e0f2fe', color: '#0369a1', border: 'none', borderRadius: '0.25rem', padding: '0.5rem 1rem', cursor: 'pointer' }}>{t('edit_task_button')}</button>)}
                    {['ADMIN', 'SUPER_ADMIN'].includes(userRole) && (<button onClick={() => setShowDeleteConfirm(true)} style={{ background: '#fee2e2', color: '#991b1b', border: 'none', borderRadius: '0.25rem', padding: '0.5rem 1rem', cursor: 'pointer' }}>{t('delete_task_button')}</button>)}
                </div>
            </div>

            <div style={{ marginTop: '1.5rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem', flexDirection: 'row' }}>
                    {(task.isEdited || isEditedPersistent) && userId === task.assigneeId && latestChanges?.description && !viewedDescriptionChange && (
                        <button onClick={() => { setDiffField('description'); setViewedDescriptionChange(true); }} style={{ background: '#ffedd5', color: '#9a3412', border: '1px solid #fdba74', borderRadius: '0.25rem', padding: '0.1rem 0.5rem', fontSize: '0.7rem', cursor: 'pointer', fontWeight: 'bold' }}>{t('edit')}</button>
                    )}
                </div>
                <p style={{ fontSize: '1.1rem', margin: 0, whiteSpace: 'pre-wrap' }}>{task.description}</p>
            </div>

            <div style={{ marginTop: '1rem', color: '#64748b', fontSize: '0.9rem' }}>
                {t('assigned_by')}: <strong>{creatorName}</strong> | {t('deadline_label')}: <strong>{new Date(task.deadline).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' }) + ' ' + new Date(task.deadline).toLocaleDateString(locale === 'ar' ? 'ar-EG' : 'en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}</strong>
            </div>

            {/* Comments / Logs Section */}
            {(() => {
                if (!task.comments) return null
                try {
                    const logs = JSON.parse(task.comments)
                    if (!Array.isArray(logs)) return null
                    const regularLogs = logs.filter((l: any) => l.type !== 'COST_ADDITION' && l.type !== 'LOCATION_ADDED')
                    if (regularLogs.length > 0) {
                        return (
                            <div style={{ marginTop: '2rem', borderTop: '1px solid #e2e8f0', paddingTop: '1.5rem' }}>
                                <h3 style={{ marginBottom: '1rem' }}>{t('comments_notes_title')}</h3>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                                    {[...regularLogs].reverse().map((log: any, i: number) => (
                                        <div key={i} style={{ padding: '1rem', background: '#f8fafc', borderRadius: '0.5rem', border: '1px solid #e2e8f0' }}>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem', flexDirection: 'row' }}>
                                                <span style={{ fontWeight: 'bold', color: '#1e293b' }}>{log.author}</span>
                                                <span style={{ fontSize: '0.75rem', color: '#64748b' }}>{new Date(log.date || log.createdAt).toLocaleString(locale)}</span>
                                            </div>
                                            <p style={{ margin: 0, fontSize: '0.95rem', color: '#334155', whiteSpace: 'pre-wrap' }}>{log.text}</p>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )
                    }
                } catch { return null }
            })()}

            {/* Attachments Section */}
            <div style={{ marginTop: '2rem', borderTop: '1px solid #e2e8f0', paddingTop: '1.5rem' }}>
                <h3 style={{ marginBottom: '1rem' }}>{t('attachments_optional_label').split(' ')[0]}</h3>
                {existingAttachments.length > 0 ? (
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '1rem' }}>
                        {existingAttachments.map((att: any, idx: number) => (
                            <a key={idx} href={att.url} target="_blank" rel="noopener noreferrer" style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.75rem', background: 'white', border: '1px solid #e2e8f0', borderRadius: '0.5rem', textDecoration: 'none', color: '#334155', transition: 'all 0.2s', flexDirection: 'row' }}>
                                <span style={{ fontSize: '1.5rem' }}>📄</span>
                                <div style={{ overflow: 'hidden', textAlign: locale === 'ar' ? 'right' : 'left' }}>
                                    <div style={{ fontSize: '0.9rem', fontWeight: '500', textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>{att.name || t('attachment')}</div>
                                    <div style={{ fontSize: '0.7rem', color: '#64748b' }}>{att.uploadedBy} • {new Date(att.uploadedAt).toLocaleDateString(locale)}</div>
                                </div>
                            </a>
                        ))}
                    </div>
                ) : (
                    <p style={{ color: '#64748b', fontStyle: 'italic' }}>{t('no_attachments_msg')}</p>
                )}
            </div>

            {/* Costs Section */}
            {(() => {
                if (!task.comments) return null
                try {
                    const logs = JSON.parse(task.comments)
                    if (!Array.isArray(logs)) return null
                    const costs = logs.filter((l: any) => l.type === 'COST_ADDITION')
                    if (costs.length > 0) {
                        return (
                            <div style={{ marginTop: '2rem', borderTop: '1px solid #e2e8f0', paddingTop: '1.5rem' }}>
                                <h3 style={{ marginBottom: '1rem' }}>{t('costs')}</h3>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                                    {costs.map((c: any, i: number) => (
                                        <div key={i} style={{ display: 'flex', flexDirection: 'column', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: '0.5rem', padding: '1rem' }}>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexDirection: 'row' }}>
                                                <div style={{ textAlign: locale === 'ar' ? 'right' : 'left' }}>
                                                    <div style={{ fontSize: '0.75rem', color: '#92400e', textTransform: 'uppercase', fontWeight: '600', marginBottom: '0.25rem' }}>{t('cost_description_placeholder').split(' ')[0]}</div>
                                                    <div style={{ fontSize: '1rem', fontWeight: '600', color: '#78350f' }}>{c.description || t('no_description')}</div>
                                                </div>
                                                <div style={{ textAlign: 'center', background: '#fef3c7', padding: '0.5rem 1rem', borderRadius: '0.375rem', border: '1px solid #fcd34d' }}>
                                                    <div style={{ fontSize: '0.75rem', color: '#92400e', textTransform: 'uppercase', fontWeight: '600' }}>{t('amount_label')}</div>
                                                    <div style={{ fontSize: '1.1rem', fontWeight: 'bold', color: '#92400e' }}>{(c.amount || 0).toFixed(2)} {t('egp')}</div>
                                                </div>
                                            </div>
                                            <div style={{ fontSize: '0.75rem', color: '#b45309', marginTop: '0.5rem', borderTop: '1px dashed #fcd34d', paddingTop: '0.5rem' }}>
                                                {c.author} • {new Date(c.date).toLocaleString(locale)}
                                            </div>
                                        </div>
                                    ))}
                                    <div style={{ background: '#f59e0b', color: 'white', padding: '1rem', borderRadius: '0.5rem', textAlign: 'center', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.1)' }}>
                                        <div style={{ fontSize: '0.875rem', fontWeight: '600', opacity: 0.9 }}>{t('total_cost')}</div>
                                        <div style={{ fontSize: '1.5rem', fontWeight: 'bold' }}>{(task.totalCost || 0).toFixed(2)} {t('egp')}</div>
                                    </div>
                                </div>
                            </div>
                        )
                    }
                } catch { return null }
            })()}

            {/* Location History Section */}
            {(() => {
                if (!task.comments) return null
                try {
                    const logs = JSON.parse(task.comments)
                    if (!Array.isArray(logs)) return null
                    const locations = logs.filter((l: any) => l.type === 'LOCATION_ADDED')
                    if (locations.length > 0) {
                        return (
                            <div style={{ marginTop: '2rem', borderTop: '1px solid #e2e8f0', paddingTop: '1.5rem' }}>
                                <h3 style={{ marginBottom: '1rem' }}>{t('location_history_title')}</h3>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                                    {locations.map((loc: any, i: number) => {
                                        let displayLoc = loc.location
                                        let mapsLink = null
                                        try {
                                            if (loc.location.startsWith('{')) {
                                                const d = JSON.parse(loc.location)
                                                displayLoc = d.address || `${d.latitude}, ${d.longitude}`
                                                if (d.latitude && d.longitude) mapsLink = `https://www.google.com/maps?q=${d.latitude},${d.longitude}`
                                            }
                                        } catch { }

                                        const canVerify = ['ADMIN', 'SUPER_ADMIN', 'TEAM_LEADER'].includes(userRole) && task.status === 'PENDING_CONFIRMATION' && userId !== task.assigneeId
                                        const canDelete = (userRole === 'EMPLOYEE' || userId === task.assigneeId) && ['PENDING', 'IN_PROGRESS', 'REJECTED'].includes(task.status)

                                        const handleVerify = async (status: 'CORRECT' | 'WRONG') => {
                                            await fetch(`/api/tasks/${task.id}/locations`, {
                                                method: 'PUT',
                                                body: JSON.stringify({ timestamp: loc.date, action: 'VERIFY', verificationStatus: status }),
                                                headers: { 'Content-Type': 'application/json' }
                                            })
                                            router.refresh()
                                        }

                                        return (
                                            <div key={i} style={{ border: '1px solid #bae6fd', background: '#f0f9ff', borderRadius: '0.5rem', padding: '1rem' }}>
                                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexDirection: 'row', gap: '1rem' }}>
                                                    <div style={{ display: 'flex', gap: '0.75rem', flexDirection: 'row' }}>
                                                        <span style={{ fontSize: '1.25rem' }}>📍</span>
                                                        <div style={{ textAlign: locale === 'ar' ? 'right' : 'left' }}>
                                                            {mapsLink ? <a href={mapsLink} target="_blank" rel="noreferrer" style={{ fontWeight: '600', color: '#0369a1', textDecoration: 'underline' }}>{displayLoc}</a> : <span style={{ fontWeight: '600', color: '#0c4a6e' }}>{displayLoc}</span>}
                                                            <div style={{ fontSize: '0.75rem', color: '#0369a1', marginTop: '0.25rem' }}>{loc.author} • {new Date(loc.date).toLocaleString(locale)}</div>
                                                        </div>
                                                    </div>
                                                    <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexDirection: 'row' }}>
                                                        {loc.verificationStatus && (
                                                            <span style={{ fontSize: '0.75rem', fontWeight: '700', color: loc.verificationStatus === 'CORRECT' ? '#16a34a' : '#dc2626', background: loc.verificationStatus === 'CORRECT' ? '#dcfce7' : '#fee2e2', padding: '0.25rem 0.5rem', borderRadius: '0.25rem' }}>
                                                                {loc.verificationStatus === 'CORRECT' ? t('verified_correct_title') : t('verified_wrong_title')}
                                                            </span>
                                                        )}
                                                        {canVerify && (
                                                            <div style={{ display: 'flex', gap: '0.25rem' }}>
                                                                <button onClick={() => handleVerify('CORRECT')} style={{ background: '#dcfce7', border: '1px solid #22c55e', color: '#166534', width: '32px', height: '32px', borderRadius: '50%', cursor: 'pointer' }} title={t('mark_correct_title')}>✓</button>
                                                                <button onClick={() => handleVerify('WRONG')} style={{ background: '#fee2e2', border: '1px solid #ef4444', color: '#991b1b', width: '32px', height: '32px', borderRadius: '50%', cursor: 'pointer' }} title={t('mark_wrong_title')}>✕</button>
                                                            </div>
                                                        )}
                                                        {canDelete && (
                                                            <button onClick={() => setLocationToDelete({ date: loc.date })} style={{ background: '#fee2e2', color: '#dc2626', border: 'none', borderRadius: '0.25rem', padding: '0.4rem', cursor: 'pointer' }} title={t('delete_location_title')}>🗑️</button>
                                                        )}
                                                    </div>
                                                </div>
                                            </div>
                                        )
                                    })}
                                </div>
                            </div>
                        )
                    }
                } catch { return null }
            })()}

            {/* Submission Section (Employee only) */}
            {(userRole === 'EMPLOYEE' || userId === task.assigneeId) && !['APPROVED', 'COMPLETED', 'PENDING_CONFIRMATION', 'REJECTED'].includes(task.status) && (
                <div style={{ marginTop: '3rem', borderTop: '2px solid #e2e8f0', paddingTop: '2rem' }}>
                    <h3 style={{ marginBottom: '1.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem', flexDirection: 'row' }}>
                        <span>📤</span> {t('submit_task_title')}
                    </h3>

                    <div style={{ marginBottom: '1.5rem' }}>
                        <label style={{ display: 'block', fontWeight: '600', marginBottom: '0.75rem' }}>{t('attachments_optional_label')}</label>
                        <div
                            onDragOver={e => { e.preventDefault(); setIsDragging(true); }}
                            onDragLeave={() => setIsDragging(false)}
                            onDrop={e => { e.preventDefault(); setIsDragging(false); if (e.dataTransfer.files.length) handleFiles(Array.from(e.dataTransfer.files)); }}
                            style={{ border: `2px dashed ${isDragging ? '#3b82f6' : '#cbd5e1'}`, borderRadius: '0.75rem', padding: '2.5rem', textAlign: 'center', background: isDragging ? '#eff6ff' : '#f8fafc', transition: 'all 0.2s', cursor: 'pointer', position: 'relative' }}
                        >
                            <input
                                type="file"
                                multiple
                                accept=".jpg,.jpeg,.png,.gif,.webp,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx"
                                onChange={e => {
                                    if (e.target.files) {
                                        handleFiles(Array.from(e.target.files))
                                        // Reset input so the same file can be selected again if removed
                                        e.target.value = ''
                                    }
                                }}
                                style={{ opacity: 0, position: 'absolute', inset: 0, cursor: 'pointer' }}
                                disabled={uploading}
                            />
                            <div style={{ pointerEvents: 'none' }}>
                                <div style={{ fontSize: '2.5rem', marginBottom: '0.5rem' }}>☁️</div>
                                <div style={{ fontWeight: '600', color: '#475569' }}>{t('upload_drag_files_msg')}</div>
                                <div style={{ fontSize: '0.8rem', color: '#94a3b8', marginTop: '0.25rem' }}>{t('upload_allowed_types_msg')}</div>
                            </div>
                        </div>

                        {pendingFiles.length > 0 && (
                            <div style={{ marginTop: '1rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                                {pendingFiles.map((f, i) => (
                                    <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.75rem 1rem', background: 'white', border: '1px solid #e2e8f0', borderRadius: '0.5rem', flexDirection: 'row' }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexDirection: 'row' }}>
                                            <span style={{ fontSize: '1.25rem' }}>📄</span>
                                            <div style={{ textAlign: locale === 'ar' ? 'right' : 'left' }}>
                                                <div style={{ fontSize: '0.9rem', fontWeight: '500' }}>{f.name}</div>
                                                <div style={{ fontSize: '0.7rem', color: '#94a3b8' }}>{(f.size / 1024 / 1024).toFixed(2)} MB</div>
                                            </div>
                                        </div>
                                        <button onClick={() => removePendingFile(i)} style={{ color: '#ef4444', background: '#fef2f2', border: 'none', borderRadius: '0.375rem', padding: '0.4rem 0.75rem', cursor: 'pointer', fontSize: '0.8rem', fontWeight: '600' }}>{t('delete')}</button>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>

                    <div style={{ marginBottom: '1.5rem' }}>
                        <label style={{ display: 'block', fontWeight: '600', marginBottom: '0.75rem' }}>{t('add_costs_label')}</label>
                        <div style={{ display: 'flex', gap: '0.5rem', flexDirection: 'row' }}>
                            <input type="text" className="input" placeholder={t('cost_description_placeholder')} value={costDescription} onChange={e => setCostDescription(e.target.value)} style={{ flex: 1 }} />
                            <input type="number" className="input" placeholder={t('cost_amount_placeholder')} value={cost} onChange={e => setCost(e.target.value)} style={{ width: '120px' }} />
                            <button onClick={handleAddCost} disabled={!cost} className="btn" style={{ background: '#e0f2fe', color: '#0369a1', fontWeight: '700', minWidth: '80px' }}>{t('add_label')}</button>
                        </div>
                        {costEntries.length > 0 && (
                            <div style={{ marginTop: '1rem', background: 'white', border: '1px solid #e2e8f0', borderRadius: '0.5rem', overflow: 'hidden' }}>
                                {costEntries.map((e, i) => (
                                    <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.75rem 1rem', borderBottom: i < costEntries.length - 1 ? '1px solid #f1f5f9' : 'none', flexDirection: 'row' }}>
                                        <div style={{ display: 'flex', gap: '0.5rem', fontWeight: '500', flexDirection: 'row' }}>
                                            <span>{e.description || t('no_description')}</span>
                                            <span style={{ color: '#94a3b8' }}>•</span>
                                            <span style={{ color: '#b45309' }}>{e.amount.toFixed(2)} {t('egp')}</span>
                                        </div>
                                        <button onClick={() => removeCostEntry(i)} style={{ color: '#ef4444', padding: '0.25rem', cursor: 'pointer', border: 'none', background: 'none', fontWeight: 'bold', fontSize: '1.2rem' }}>×</button>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>

                    <div style={{ marginBottom: '1.5rem' }}>
                        <label style={{ display: 'block', fontWeight: '600', marginBottom: '0.75rem' }}>{t('note_optional_label')}</label>
                        <textarea className="input" rows={3} placeholder={t('note_placeholder')} value={note} onChange={e => setNote(e.target.value)} style={{ width: '100%', resize: 'none' }} maxLength={500} />
                        <div style={{ textAlign: locale === 'ar' ? 'left' : 'right', fontSize: '0.75rem', color: note.length >= 500 ? '#ef4444' : '#94a3b8', marginTop: '0.25rem' }}>{note.length}/500</div>
                    </div>

                    <div style={{ marginBottom: '2rem' }}>
                        <label style={{ display: 'block', fontWeight: '600', marginBottom: '0.75rem' }}>{t('current_location_label')}</label>
                        <div style={{ display: 'flex', gap: '1rem', alignItems: 'center', flexDirection: 'row' }}>
                            <button onClick={handleCaptureLocation} disabled={capturingLocation || uploading} className="btn" style={{ background: capturingLocation ? '#e2e8f0' : '#3b82f6', color: capturingLocation ? '#64748b' : 'white', fontWeight: '600', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                {capturingLocation ? t('capturing_location_button').replace('📍', '') : t('capture_location_button').replace('📍', '')}
                            </button>
                            <span style={{ fontSize: '0.875rem', fontWeight: '500', color: locationStatus.includes('✓') ? '#16a34a' : locationStatus.includes('Failed') ? '#dc2626' : '#64748b' }}>{locationStatus}</span>
                        </div>
                    </div>

                    <div style={{ display: 'flex', gap: '1rem', flexDirection: 'row' }}>
                        <button onClick={() => handleUpload(true)} disabled={uploading} className="btn" style={{ background: '#e2e8f0', color: '#1e293b', fontWeight: '600', flex: 1 }}>{uploading ? t('saving') : t('save_draft_button')}</button>
                        <button onClick={handleUploadRequest} disabled={uploading} className="btn btn-primary" style={{ fontWeight: '700', flex: 2 }}>{uploading ? t('signing_in').split(' ')[0] + '...' : t('submit_task_button')}</button>
                    </div>
                </div>
            )}

            {/* Transfer Link (Admins only) */}
            {['ADMIN', 'SUPER_ADMIN', 'TEAM_LEADER'].includes(userRole) && ['IN_PROGRESS', 'PENDING'].includes(task.status) && (
                <div style={{ marginTop: '2rem', textAlign: locale === 'ar' ? 'left' : 'right' }}>
                    <button onClick={() => { if (allUsers.length === 0) fetch('/api/users').then(r => r.json()).then(setAllUsers); setIsTransferModalOpen(true); }} style={{ background: 'none', border: 'none', color: '#64748b', textDecoration: 'underline', cursor: 'pointer', fontSize: '0.875rem' }}>{t('transfer_to_another_employee')}</button>
                </div>
            )}

            {/* Approve/Reject Buttons (Admins only) */}
            {['ADMIN', 'SUPER_ADMIN', 'TEAM_LEADER'].includes(userRole) && task.status === 'PENDING_CONFIRMATION' && userId !== task.assigneeId && (
                <div style={{ marginTop: '2.5rem', display: 'flex', gap: '1.25rem', borderTop: '2px solid #e2e8f0', paddingTop: '2rem', flexDirection: 'row' }}>
                    <button onClick={handleApprove} className="btn btn-primary" style={{ flex: 1, padding: '1rem', fontSize: '1.1rem', fontWeight: '700' }}>{t('approve_button')}</button>
                    <button onClick={handleReject} className="btn" style={{ flex: 1, padding: '1rem', fontSize: '1.1rem', fontWeight: '700', background: '#ef4444', color: 'white' }}>{t('reject_button')}</button>
                </div>
            )}

            {/* Modals */}

            {/* Delete Modal */}
            <Modal isOpen={showDeleteConfirm} onClose={() => setShowDeleteConfirm(false)} title={t('delete_task_title')} hideFooter>
                <div style={{ textAlign: locale === 'ar' ? 'right' : 'left' }}>
                    <p>{t('delete_task_warning')}</p>
                    <div style={{ display: 'flex', gap: '1rem', marginTop: '1.5rem', justifyContent: 'flex-end', flexDirection: 'row' }}>
                        <button onClick={() => setShowDeleteConfirm(false)} className="btn" style={{ background: '#e2e8f0' }}>{t('cancel')}</button>
                        <button onClick={handleDelete} className="btn" style={{ background: '#dc2626', color: 'white' }}>{t('delete')}</button>
                    </div>
                </div>
            </Modal>

            {/* Edit Modal */}
            <Modal isOpen={isEditing} onClose={() => setIsEditing(false)} title={t('edit_task_details_title')} hideFooter>
                <form onSubmit={handleSaveDetails} style={{ textAlign: locale === 'ar' ? 'right' : 'left' }}>
                    <div style={{ marginBottom: '1.25rem' }}>
                        <label className="label">{t('name_label')}</label>
                        <input className="input" value={editForm.title} onChange={e => { setEditForm({ ...editForm, title: e.target.value }); setEditFieldErrors({ ...editFieldErrors, title: '' }); }} style={{ borderColor: editFieldErrors.title ? '#ef4444' : undefined }} maxLength={100} required />
                        <div style={{ textAlign: locale === 'ar' ? 'left' : 'right', fontSize: '0.7rem', color: '#94a3b8', marginTop: '0.25rem' }}>{editForm.title.length}/100</div>
                    </div>
                    <div style={{ marginBottom: '1.25rem' }}>
                        <label className="label">{t('description_changes_title').split(' ')[0]}</label>
                        <textarea className="input" rows={4} value={editForm.description} onChange={e => { setEditForm({ ...editForm, description: e.target.value }); setEditFieldErrors({ ...editFieldErrors, description: '' }); }} style={{ borderColor: editFieldErrors.description ? '#ef4444' : undefined }} maxLength={500} required />
                        <div style={{ textAlign: locale === 'ar' ? 'left' : 'right', fontSize: '0.7rem', color: '#94a3b8', marginTop: '0.25rem' }}>{editForm.description.length}/500</div>
                    </div>
                    <div style={{ marginBottom: '1.25rem' }}>
                        <label className="label">{t('assignee_label')}</label>
                        <select className="input" value={editForm.assigneeId} disabled style={{ background: '#f8fafc', width: '100%' }}>
                            <option value={task.assigneeId}>{task.assignee?.firstName} {task.assignee?.lastName}</option>
                        </select>
                    </div>
                    <div style={{ marginBottom: '1.25rem' }}>
                        <DateTimePicker label={t('deadline_label')} value={editForm.deadline} onChange={v => setEditForm({ ...editForm, deadline: v })} min={new Date().toISOString()} />
                    </div>
                    <div style={{ marginBottom: '1.5rem' }}>
                        <label className="label">{t('difficulty')}</label>
                        <input type="number" className="input" value={editForm.difficulty} onChange={e => setEditForm({ ...editForm, difficulty: parseInt(e.target.value) || 0 })} min={0} max={10} required />
                    </div>
                    <div style={{ display: 'flex', gap: '1rem', justifyContent: 'flex-end', flexDirection: 'row' }}>
                        <button type="button" onClick={() => setIsEditing(false)} className="btn" style={{ background: '#e2e8f0' }}>{t('cancel')}</button>
                        <button type="submit" className="btn btn-primary">{t('save_changes_button')}</button>
                    </div>
                </form>
            </Modal>

            {/* Transfer Modal */}
            <Modal isOpen={isTransferModalOpen} onClose={() => setIsTransferModalOpen(false)} title={t('transfer_task_title')} hideFooter>
                <div style={{ textAlign: locale === 'ar' ? 'right' : 'left' }}>
                    <p style={{ marginBottom: '1.25rem', lineHeight: '1.5' }}>{t('transfer_task_msg')}</p>
                    <select className="input" style={{ width: '100%', marginBottom: '1.5rem' }} value={transferAssigneeId} onChange={e => setTransferAssigneeId(e.target.value)}>
                        <option value="">{t('select_employee_placeholder')}...</option>
                        {allUsers.filter(u => u.id !== task.assigneeId && u.id !== userId).map(u => (
                            <option key={u.id} value={u.id}>{u.firstName} {u.lastName} ({u.role})</option>
                        ))}
                    </select>
                    <div style={{ display: 'flex', gap: '1rem', justifyContent: 'flex-end', flexDirection: 'row' }}>
                        <button onClick={() => setIsTransferModalOpen(false)} className="btn" style={{ background: '#e2e8f0' }}>{t('cancel')}</button>
                        <button onClick={handleTransfer} disabled={!transferAssigneeId || transferring} className="btn btn-primary">{transferring ? '...' : t('confirm_transfer_button')}</button>
                    </div>
                </div>
            </Modal>

            {/* Review Modal (Approve/Reject) */}
            <Modal isOpen={isReviewModalOpen} onClose={() => setIsReviewModalOpen(false)} title={reviewAction === 'APPROVED' ? t('confirm_approval_title') : t('confirm_rejection_title')} hideFooter>
                <div style={{ textAlign: locale === 'ar' ? 'right' : 'left' }}>
                    <p style={{ marginBottom: '1.25rem' }}>
                        {t('confirm_task_action_msg').replace('{action}', reviewAction === 'APPROVED' ? (locale === 'ar' ? 'الموافقة على' : 'approve') : (locale === 'ar' ? 'رفض' : 'reject'))}
                        {isTransferredTask() ? t('is_transferred_difficulty_hint') : t('are_you_sure_msg')}
                    </p>
                    {isTransferredTask() && (
                        <div style={{ marginBottom: '1.5rem' }}>
                            <label className="label">{t('points_label')}</label>
                            <input type="number" className="input" value={reviewDifficulty} onChange={e => setReviewDifficulty(parseInt(e.target.value) || 0)} min={0} max={100} style={{ width: '100%' }} />
                        </div>
                    )}
                    <div style={{ display: 'flex', gap: '1rem', justifyContent: 'flex-end', flexDirection: 'row' }}>
                        <button onClick={() => setIsReviewModalOpen(false)} className="btn" style={{ background: '#e2e8f0' }}>{t('cancel')}</button>
                        <button onClick={() => submitReview()} disabled={submittingReview} className="btn" style={{ background: reviewAction === 'APPROVED' ? '#16a34a' : '#dc2626', color: 'white', minWidth: '100px' }}>
                            {submittingReview ? '...' : t('confirm_action_button')}
                        </button>
                    </div>
                </div>
            </Modal>

            {/* Submit Confirmation Modal */}
            <Modal isOpen={showSubmitConfirm} onClose={() => setShowSubmitConfirm(false)} title={t('confirm_submission_title')} hideFooter>
                <div style={{ textAlign: locale === 'ar' ? 'right' : 'left' }}>
                    <p>{t('confirm_submission_msg')}</p>
                    <div style={{ display: 'flex', gap: '1rem', marginTop: '1.5rem', justifyContent: 'flex-end', flexDirection: 'row' }}>
                        <button onClick={() => setShowSubmitConfirm(false)} className="btn" style={{ background: '#e2e8f0' }}>{t('cancel')}</button>
                        <button onClick={() => { setShowSubmitConfirm(false); handleUpload(false); }} className="btn btn-primary">{t('confirm_submit_button')}</button>
                    </div>
                </div>
            </Modal>

            {/* Delete Location Modal */}
            <Modal isOpen={!!locationToDelete} onClose={() => setLocationToDelete(null)} title={t('delete_location_title')} hideFooter>
                <div style={{ textAlign: locale === 'ar' ? 'right' : 'left' }}>
                    <p>{t('delete_location_warning')}</p>
                    <div style={{ display: 'flex', gap: '1rem', marginTop: '1.5rem', justifyContent: 'flex-end', flexDirection: 'row' }}>
                        <button onClick={() => setLocationToDelete(null)} className="btn" style={{ background: '#e2e8f0' }}>{t('cancel')}</button>
                        <button onClick={confirmDeleteLocation} className="btn" style={{ background: '#dc2626', color: 'white' }}>{t('delete')}</button>
                    </div>
                </div>
            </Modal>

        </div>
    )
}

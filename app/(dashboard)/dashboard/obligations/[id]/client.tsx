'use client'
import { useState, useEffect, useCallback } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Modal from '@/components/Modal'
import { useLanguage } from '@/context/LanguageContext'
import SafeDate from '@/components/SafeDate'
import { SESSION_EXPIRED_MESSAGE, redirectAfterSessionExpiry } from '@/lib/session-expired'
import { RECURRENCE_STYLE } from '@/lib/recurrence'


export default function ObligationDetailClient({ obligation, userRole, userId, userName, creatorName, creatorUnknown }: { obligation: any, userRole: string, userId: string, userName: string, creatorName: string | null, creatorUnknown: boolean }) {
    const { t, locale } = useLanguage()
    const [uploading, setUploading] = useState(false)
    const [loadingType, setLoadingType] = useState<'DRAFT' | 'SUBMIT' | null>(null)
    const [pendingFiles, setPendingFiles] = useState<File[]>([])
    const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
    const [showFeedback, setShowFeedback] = useState(false)
    const [feedbackMessage, setFeedbackMessage] = useState('')
    // This banner (rendered below) was previously always green-bordered,
    // even for a failure — visually indistinguishable from a success
    // confirmation. Tracked alongside the message now so it can match the
    // shared Toast component's red/green convention.
    const [feedbackType, setFeedbackType] = useState<'success' | 'error'>('success')
    const notify = (message: string, type: 'success' | 'error' = 'success') => {
        setFeedbackMessage(message)
        setFeedbackType(type)
        setShowFeedback(true)
    }
    const [isReverting, setIsReverting] = useState(false)
    const [showRevertConfirm, setShowRevertConfirm] = useState(false)
    const [showDeadlineModal, setShowDeadlineModal] = useState(false)
    const router = useRouter()
    const searchParams = useSearchParams()
    const highlightId = searchParams.get('highlight')
    const shouldHighlight = highlightId === obligation.id
    const recurrenceStyle = obligation.recurrence ? RECURRENCE_STYLE[obligation.recurrence] : undefined

    const isOverdue = new Date(obligation.deadline) < new Date() && ['PENDING', 'IN_PROGRESS'].includes(obligation.status)



    useEffect(() => {
        const isUserAssignee = obligation.assignees?.some((a: any) => a.id === userId)
        const isRestrictedRole = userRole === 'EMPLOYEE' || (userRole === 'TEAM_LEADER' && isUserAssignee)

        if (!isRestrictedRole || !isOverdue) return

        const handleLocalClick = (e: MouseEvent) => {
            const target = e.target as HTMLElement

            // Ignore clicks inside the deadline modal
            if (target.closest('#deadline-modal-content')) {
                return
            }

            // Target buttons, links, labels, and inputs
            const closestClickable = target.closest('button, a, label, input, [role="button"]')

            if (closestClickable) {
                // Helper to strip common emojis and normalize for robust matching
                const clean = (str: string) => {
                    if (!str) return ''
                    return str.replace(/[\u1F60-\u1F64]|[\u2702-\u27B0]|[\u1F68-\u1F6C]|[\u1F30-\u1F70]|[\u2600-\u26ff]|[\uD83C-\uDBFF\uDC00-\uDFFF]/g, '')
                        .trim()
                        .toLowerCase()
                }

                const targetText = clean(closestClickable.textContent || '')
                const targetTitle = clean(closestClickable.getAttribute('title') || '')

                // Block ONLY these actions if overdue (they modify the submission state)
                const isBlockedAction = [
                    t('save_draft_obligation_button' as any) || 'save draft',
                    t('upload_drag_files_msg' as any) || 'upload',
                    t('delete') || 'delete',
                    t('delete_note_title' as any) || 'delete note',
                    t('delete_cost_title' as any) || 'delete cost',
                    t('delete_attachment_title' as any) || 'delete attachment'
                ].some(keyword => {
                    const cleanKeyword = clean(keyword)
                    if (!cleanKeyword) return false

                    // Exact match for the generic "Delete" to avoid blocking "Delete Obligation"
                    if (cleanKeyword === clean(t('delete') || 'delete')) {
                        return targetText === cleanKeyword || targetTitle === cleanKeyword
                    }

                    return targetText.includes(cleanKeyword) || targetTitle.includes(cleanKeyword)
                })

                const isFileInput = closestClickable.tagName === 'INPUT' && (closestClickable as HTMLInputElement).type === 'file'

                if (isBlockedAction || isFileInput) {
                    e.preventDefault()
                    e.stopPropagation()
                    setShowDeadlineModal(true)
                }
            }
        }


        document.addEventListener('click', handleLocalClick, true)
        return () => document.removeEventListener('click', handleLocalClick, true)
    }, [userRole, isOverdue, t, userId, obligation.assignees])

    const handleUpload = useCallback(async (isDraft: boolean, isEmergency?: boolean) => {
        setUploading(true)
        setLoadingType(isDraft ? 'DRAFT' : 'SUBMIT')
        const uploadedAttachments: any[] = []

        try {
            // Upload all pending files
            for (const file of pendingFiles) {
                const formData = new FormData()
                formData.append('file', file)

                try {
                    // Emergency saves need this on the upload step too, not
                    // just the final PUT below — the server now exempts
                    // POST /api/upload the same way when this header is
                    // present (see lib/api-utils.ts), otherwise a suspended/
                    // banned user's attachment never makes it in even though
                    // their note/status does.
                    const res = await fetch('/api/upload', {
                        method: 'POST',
                        headers: isEmergency ? { 'X-Emergency-Save': 'true' } : undefined,
                        body: formData
                    })
                    const result = await res.json()
                    const data = result.data
                    if (result.success && data.url) {
                        uploadedAttachments.push({
                            name: file.name,
                            url: data.url,
                            type: file.type,
                            uploadedBy: userName,
                            uploadedById: userId,
                            uploadedAt: new Date().toISOString()
                        })
                    }
                } catch (err) {
                    console.error("Upload error", err)
                }
            }

            const headers: any = { 'Content-Type': 'application/json' }
            if (isEmergency) headers['X-Emergency-Save'] = 'true'

            const res = await fetch(`/api/obligations/${obligation.id}`, {
                method: 'PUT',
                headers,
                body: JSON.stringify({
                    status: isDraft ? 'IN_PROGRESS' : 'PENDING_CONFIRMATION',
                    newAttachments: uploadedAttachments // Send only new ones
                })
            })

            if (!res.ok) {
                if (res.status === 401) {
                    notify(SESSION_EXPIRED_MESSAGE, 'error')
                    redirectAfterSessionExpiry(router)
                    return
                }
                const data = await res.json().catch(() => ({}))
                throw new Error(data.error || 'Update failed')
            }

            setPendingFiles([])
            router.refresh()
            notify(isDraft ? t('draft_saved_success') : t('obligation_submitted_success' as any), 'success')
            setTimeout(() => setShowFeedback(false), 3000)
        } catch (error: any) {
            console.error("Update failed", error)
            notify(error.message || t('failed_save_generic'), 'error')
        } finally {
            setUploading(false)
            setLoadingType(null)
        }
    }, [pendingFiles, obligation.id, router, t, userId, userName])

    // Listen for suspension auto-save event
    useEffect(() => {
        const handleSuspendSave = async () => {
            console.log('Suspension detected, auto-saving obligation progress...')
            try {
                // Only auto-save if employee interaction is active and not already submitted or finalized
                if (userRole === 'EMPLOYEE' && !['PENDING_CONFIRMATION', 'APPROVED', 'COMPLETED', 'REJECTED'].includes(obligation.status)) {
                    await handleUpload(true, true)
                }
            } finally {
                // Tells UserHeartbeat it can stop waiting and sign out/redirect
                // now — whether or not there was anything to save. Without
                // this it has no way to know a save on this page even
                // happened, so it just waits out its own flat timeout.
                window.dispatchEvent(new CustomEvent('app:emergency-save-complete'))
            }
        }
        window.addEventListener('app:suspend-detected', handleSuspendSave)
        return () => window.removeEventListener('app:suspend-detected', handleSuspendSave)
    }, [obligation.status, userRole, handleUpload])

    // Helper to parse existing attachments
    const existingAttachments = obligation.attachments ? (() => {
        try {
            const parsed = JSON.parse(obligation.attachments)
            if (Array.isArray(parsed)) return parsed
            if (parsed.url) return [parsed] // Legacy
            return []
        } catch {
            // Backward compatibility for single URL strings
            if (typeof obligation.attachments === 'string' && obligation.attachments.startsWith('http')) {
                return [{ url: obligation.attachments, name: obligation.attachments.split('/').pop() || 'File' }]
            }
            return []
        }
    })() : []

    const handleRemoveExistingAttachment = async (itemToRemove: any) => {
        if (!['ADMIN', 'SUPER_ADMIN', 'TEAM_LEADER'].includes(userRole)) return

        const updatedAttachments = existingAttachments.filter((att: any) =>
            (typeof att === 'string' ? att : att.url) !== (typeof itemToRemove === 'string' ? itemToRemove : itemToRemove.url)
        )

        try {
            const res = await fetch(`/api/obligations/${obligation.id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    attachments: updatedAttachments // API handles stringification
                })
            })

            if (res.ok) {
                router.refresh()
                notify(t('item_deleted_success' as any) || 'Attachment removed', 'success')
            }
        } catch (error) {
            console.error('Failed to remove attachment', error)
        }
    }

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
            notify(errorMsg, 'error')
        }

        setPendingFiles(prev => [...prev, ...validFiles])
        setInputKey(prev => prev + 1)
    }

    const removePendingFile = (index: number) => {
        setPendingFiles(prev => prev.filter((_, i) => i !== index))
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
                notify(t('obligation_approved_success' as any), 'success')
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
                notify(t('obligation_rejected_success' as any), 'success')
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
            } else if (res.status === 401) {
                notify(SESSION_EXPIRED_MESSAGE, 'error')
                redirectAfterSessionExpiry(router)
            } else {
                const data = await res.json().catch(() => ({}))
                notify(data.error || t('failed_save_generic'), 'error')
            }
        } catch (error: any) {
            console.error('Delete error:', error)
            notify(error.message || t('failed_save_generic'), 'error')
        }
        setShowDeleteConfirm(false)
    }

    const [allUsers, setAllUsers] = useState<any[]>([])
    const [isReassigning, setIsReassigning] = useState(false)
    const [newAssigneeIds, setNewAssigneeIds] = useState<string[]>(obligation.assignees?.map((a: any) => a.id) || [])

    const loadUsers = async () => {
        if (allUsers.length > 0) return
        const queryParams = new URLSearchParams()
        queryParams.set('limit', '1000')
        if (obligation.companyId) queryParams.set('companyId', obligation.companyId)

        const res = await fetch(`/api/users?${queryParams.toString()}`)
        if (res.ok) {
            const result = await res.json()
            const data = result.data
            const usersList = data.data || []
            const filtered = userRole === 'TEAM_LEADER' ? usersList.filter((u: any) => !['ADMIN', 'SUPER_ADMIN'].includes(u.role)) : usersList
            setAllUsers(filtered)
        }
    }

    const handleReassign = async () => {
        if (newAssigneeIds.length === 0) return
        try {
            await fetch(`/api/obligations/${obligation.id}`, {
                method: 'PUT',
                body: JSON.stringify({ assigneeIds: newAssigneeIds }),
                headers: { 'Content-Type': 'application/json' }
            })
            setIsReassigning(false)
            router.refresh()
            notify(t('task_transfer_success'), 'success')
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
                if (res.status === 401) {
                    notify(SESSION_EXPIRED_MESSAGE, 'error')
                    redirectAfterSessionExpiry(router)
                    return
                }
                const data = await res.json().catch(() => ({}))
                throw new Error(data.error || 'Revert failed')
            }
            notify(t('obligation_reverted_success'), 'success')
            router.refresh()
        } catch (e: any) {
            console.error(e)
            notify(e.message || t('failed_revert_obligation'), 'error')
        } finally {
            setIsReverting(false)
        }
    }

    const containerStyle: React.CSSProperties = {
        direction: locale === 'ar' ? 'rtl' : 'ltr',
        textAlign: locale === 'ar' ? 'right' : 'left'
    }

    return (
        <div className={`card ${shouldHighlight ? 'highlight-shading' : ''}`} style={{
            ...containerStyle,
            background: isOverdue ? 'var(--danger-bg-tint)' : (shouldHighlight ? undefined : 'var(--surface)'),
            borderColor: isOverdue ? 'var(--danger-border)' : undefined
        }}>

            {/* Deleted Assignee Alert */}
            {obligation.assignees?.some((a: any) => a.status === 'DELETED') && ['ADMIN', 'SUPER_ADMIN', 'TEAM_LEADER'].includes(userRole) && (
                <div style={{ background: 'var(--danger-bg)', border: '1px solid var(--danger-solid)', color: 'var(--danger-fg)', padding: '1.5rem', borderRadius: '0.5rem', marginBottom: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexDirection: 'row' }}>
                        <span style={{ fontSize: '1.5rem' }}>🚫</span>
                        <div style={{ textAlign: locale === 'ar' ? 'right' : 'left' }}>
                            <strong>{t('assignee_deleted_alert')}</strong>
                            <p style={{ margin: 0, fontSize: '0.9rem' }}>
                                {t('assignee_deleted_msg').replace('{name}', obligation.assignees.filter((a: any) => a.status === 'DELETED').map((a: any) => `${a.firstName} ${a.lastName}`).join(', '))}
                            </p>
                        </div>
                    </div>

                    <div style={{ display: 'flex', gap: '1rem', justifyContent: 'flex-end', flexDirection: 'row' }}>
                        <button onClick={handleForceComplete} className="btn" style={{ background: 'var(--ok-fg)', color: 'var(--text-on-accent)' }}>{t('mark_as_completed')}</button>
                        <button onClick={() => { setIsReassigning(true); loadUsers() }} className="btn" style={{ background: 'var(--info-solid-hover)', color: 'var(--text-on-accent)' }}>{t('reassign_button')}</button>
                        <button onClick={() => setShowDeleteConfirm(true)} className="btn" style={{ background: 'var(--danger-fg-strong)', color: 'var(--text-on-accent)' }}>{t('delete')}</button>
                        <button onClick={() => router.push('/dashboard/obligations')} className="btn" style={{ background: 'var(--surface)', border: '1px solid var(--danger-fg-strong)', color: 'var(--danger-fg-strong)' }}>{t('dismiss_decide_later')}</button>
                    </div>
                </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexDirection: 'row' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexDirection: 'row', flexWrap: 'wrap' }}>
                    <h1 style={{ margin: 0 }}>{obligation.title}</h1>
                    <span style={{
                        fontSize: '0.75rem',
                        fontWeight: '600',
                        padding: '0.25rem 0.75rem',
                        borderRadius: '9999px',
                        background: obligation.status === 'COMPLETED' ? 'var(--ok-bg)' : obligation.status === 'REJECTED' || obligation.status === 'APPROVED' ? (obligation.status === 'APPROVED' ? 'var(--ok-bg)' : 'var(--danger-bg)') : 'var(--surface-sunk)',
                        color: obligation.status === 'COMPLETED' ? 'var(--ok-fg)' : obligation.status === 'REJECTED' || obligation.status === 'APPROVED' ? (obligation.status === 'APPROVED' ? 'var(--ok-fg)' : 'var(--danger-fg)') : 'var(--text-muted)',
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
                        background: 'var(--info-solid)',
                        color: 'var(--text-on-accent)',
                        fontWeight: 'bold',
                        fontSize: '0.9rem',
                        display: 'inline-flex',
                        alignItems: 'center'
                    }}>
                        {obligation.difficulty} {t('points_label_plural')}
                    </span>
                    {recurrenceStyle && (
                        <span
                            title={t('recurrence_label')}
                            style={{
                                padding: '0.25rem 0.75rem',
                                borderRadius: '9999px',
                                background: recurrenceStyle.bg,
                                color: recurrenceStyle.color,
                                fontWeight: 'bold',
                                fontSize: '0.75rem',
                                display: 'inline-flex',
                                alignItems: 'center',
                                whiteSpace: 'nowrap'
                            }}
                        >
                            {t(recurrenceStyle.labelKey as any)}
                        </span>
                    )}
                </div>
                <div style={{ display: 'flex', gap: '0.5rem', flexDirection: 'row' }}>
                    <button
                        onClick={() => router.push('/dashboard/obligations')}
                        style={{ background: 'none', border: '1px solid var(--border-firm)', borderRadius: '0.25rem', padding: '0.5rem 1rem', cursor: 'pointer', color: 'var(--text-soft)' }}
                    >
                        {t('close_button')}
                    </button>
                    {userRole === 'SUPER_ADMIN' && ['APPROVED', 'COMPLETED', 'REJECTED', 'PENDING_CONFIRMATION'].includes(obligation.status) && (
                        <button
                            onClick={() => setShowRevertConfirm(true)}
                            style={{
                                background: 'var(--surface-subtle)',
                                color: 'var(--text-muted)',
                                border: '1px solid var(--border-firm)',
                                borderRadius: '0.25rem',
                                padding: '0.5rem 1rem',
                                cursor: 'pointer',
                                fontWeight: '600'
                            }}
                        >
                            {isReverting ? t('reverting') : t('return_to_in_progress')}
                        </button>
                    )}
                    {['ADMIN', 'SUPER_ADMIN', 'TEAM_LEADER'].includes(userRole) && (userRole === 'TEAM_LEADER' || !obligation.assignees?.some((a: any) => a.id === userId)) && (
                        <button
                            onClick={() => setShowDeleteConfirm(true)}
                            style={{ background: 'var(--danger-bg)', color: 'var(--danger-fg)', border: 'none', borderRadius: '0.25rem', padding: '0.5rem 1rem', cursor: 'pointer' }}
                        >
                            {t('delete_obligation_button' as any)}
                        </button>
                    )}
                </div>
            </div>
            <p style={{ fontSize: '1.1rem', margin: '1rem 0' }}>{obligation.description}</p>

            <div style={{ marginTop: '1rem', color: 'var(--text-soft)' }}>
                {t('assigned_by')}: <strong>{creatorName || (creatorUnknown ? t('assigned_by_unknown') : t('role_super_admin'))}</strong> | {t('deadline_label')}: <SafeDate date={obligation.deadline} locale={locale} showTime />
            </div>

            {/* Existing Attachments */}
            <div style={{ marginTop: '2rem', borderTop: '1px solid var(--border)', paddingTop: '1rem' }}>
                <h3>{t('attachments_label' as any)}</h3>
                {existingAttachments.length > 0 ? (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem', marginTop: '0.75rem' }}>
                        {existingAttachments.map((att: any, index: number) => {
                            const url = typeof att === 'string' ? att : att.url
                            const name = typeof att === 'string' ? url.split('/').pop() : att.name
                            return (
                                <div key={index} style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '0.5rem',
                                    background: 'var(--surface)',
                                    border: '1px solid var(--border)',
                                    padding: '0.5rem 0.75rem',
                                    borderRadius: '0.5rem',
                                    boxShadow: '0 1px 2px rgba(0,0,0,0.05)'
                                }}>
                                    <span style={{ fontSize: '1.2rem' }}>📎</span>
                                    <div style={{ display: 'flex', flexDirection: 'column' }}>
                                        <a href={url} target="_blank" rel="noopener noreferrer" style={{
                                            color: 'var(--info-solid-hover)',
                                            textDecoration: 'none',
                                            fontSize: '0.9rem',
                                            fontWeight: '500',
                                            maxWidth: '150px',
                                            overflow: 'hidden',
                                            textOverflow: 'ellipsis',
                                            whiteSpace: 'nowrap'
                                        }}>
                                            {name || t('view_photo')}
                                        </a>
                                        {att.uploadedAt && (
                                            <span style={{ fontSize: '0.7rem', color: 'var(--text-soft)' }}>
                                                <SafeDate date={att.uploadedAt} locale={locale} showTime />
                                            </span>
                                        )}
                                    </div>
                                    {['ADMIN', 'SUPER_ADMIN', 'TEAM_LEADER'].includes(userRole) && (att.uploadedById === userId || ['ADMIN', 'SUPER_ADMIN'].includes(userRole)) && (
                                        <button
                                            onClick={() => handleRemoveExistingAttachment(att)}
                                            style={{
                                                marginLeft: locale === 'ar' ? '0' : '0.5rem',
                                                marginRight: locale === 'ar' ? '0.5rem' : '0',
                                                color: 'var(--danger-solid)',
                                                background: 'none',
                                                border: 'none',
                                                cursor: 'pointer',
                                                fontSize: '1.1rem',
                                                padding: '0.2rem',
                                                display: 'flex',
                                                alignItems: 'center',
                                                justifyContent: 'center'
                                            }}
                                            title={t('delete')}
                                        >
                                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                                <path d="M18 6L6 18M6 6l12 12"></path>
                                            </svg>
                                        </button>
                                    )}
                                </div>
                            )
                        })}
                    </div>
                ) : (
                    <span style={{ color: 'var(--text-soft)', fontStyle: 'italic' }}>{t('no_attachments_msg')}</span>
                )}
            </div>

            {userRole === 'EMPLOYEE' && !['PENDING_CONFIRMATION', 'APPROVED', 'COMPLETED', 'REJECTED'].includes(obligation.status) && (
                <div style={{ marginTop: '2rem', borderTop: '1px solid var(--border)', paddingTop: '1rem' }}>
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
                            border: `2px dashed ${isDragging ? 'var(--info-solid)' : 'var(--border-firm)'}`,
                            borderRadius: '0.5rem',
                            padding: '2rem',
                            textAlign: 'center',
                            background: isDragging ? 'var(--info-bg-subtle)' : 'var(--surface-subtle)',
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
                            <p style={{ margin: 0, fontWeight: '600', color: 'var(--text-muted)' }}>
                                {t('upload_drag_files_msg')}
                            </p>
                            <p style={{ margin: '0.25rem 0 0 0', fontSize: '0.8rem', color: 'var(--text-faint)' }}>
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
                                    background: 'var(--surface)',
                                    border: '1px solid var(--border)',
                                    borderRadius: '0.5rem',
                                    boxShadow: '0 1px 2px 0 rgba(0, 0, 0, 0.05)',
                                    flexDirection: 'row'
                                }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexDirection: 'row' }}>
                                        <span style={{ fontSize: '1.2rem' }}>📄</span>
                                        <div style={{ textAlign: locale === 'ar' ? 'right' : 'left' }}>
                                            <div style={{ fontSize: '0.9rem', fontWeight: '500', color: 'var(--text-body)' }}>{file.name}</div>
                                            <div style={{ fontSize: '0.75rem', color: 'var(--text-faint)' }}>{(file.size / 1024 / 1024).toFixed(2)} MB</div>
                                        </div>
                                    </div>
                                    <button
                                        onClick={() => removePendingFile(i)}
                                        style={{
                                            color: 'var(--danger-solid)',
                                            background: 'var(--danger-bg-subtle)',
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
                            style={{ background: 'var(--border)', color: 'var(--text-strong)' }}
                            onClick={() => handleUpload(true)}
                            disabled={uploading}
                        >
                            {loadingType === 'DRAFT' ? t('saving') : t('save_draft_obligation_button' as any)}
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
                <div style={{ marginTop: '2rem', padding: '1.5rem', background: 'var(--surface-subtle)', border: '1px solid var(--border)', borderRadius: '0.5rem', textAlign: 'center' }}>
                    <p style={{ margin: 0, color: 'var(--text-muted)', fontWeight: '500' }}>
                        {obligation.status === 'PENDING_CONFIRMATION'
                            ? t('pending_confirmation_msg' as any) || "Submitted and awaiting review"
                            : t('obligation_finalized_msg' as any) || "This obligation has been finalized and cannot be modified."}
                    </p>
                </div>
            )}

            {/* Approve/Reject Buttons (Admins only) */}
            {['ADMIN', 'SUPER_ADMIN', 'TEAM_LEADER'].includes(userRole) && obligation.status === 'PENDING_CONFIRMATION' && (userRole === 'TEAM_LEADER' || !obligation.assignees?.some((a: any) => a.id === userId)) && (
                <div style={{ marginTop: '2.5rem', display: 'flex', gap: '1.25rem', borderTop: '2px solid var(--border)', paddingTop: '2rem', flexDirection: 'row' }}>
                    <button onClick={handleApprove} className="btn btn-primary" style={{ flex: 1, padding: '1rem', fontSize: '1.1rem', fontWeight: '700' }}>{t('approve_button')}</button>
                    <button onClick={handleReject} className="btn" style={{ flex: 1, padding: '1rem', fontSize: '1.1rem', fontWeight: '700', background: 'var(--danger-solid)', color: 'var(--text-on-accent)' }}>{t('reject_button')}</button>
                </div>
            )}

            {/* Feedback Modal */}
            {showFeedback && (
                <div style={{
                    position: 'fixed',
                    top: '20px',
                    [locale === 'ar' ? 'left' : 'right']: '20px',
                    background: 'var(--surface)',
                    padding: '1rem',
                    borderRadius: '0.5rem',
                    boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
                    zIndex: 2000,
                    [locale === 'ar' ? 'borderRight' : 'borderLeft']: `4px solid ${feedbackType === 'error' ? 'var(--danger-solid)' : 'var(--ok-solid-alt)'}`,
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
            <Modal isOpen={showDeleteConfirm} onClose={() => setShowDeleteConfirm(false)} title={t('delete_obligation_title' as any)} hideFooter>
                <div style={{ textAlign: locale === 'ar' ? 'right' : 'left' }}>
                    <p>{t('delete_obligation_warning' as any)}</p>
                    <div style={{ display: 'flex', gap: '1rem', marginTop: '1.5rem', justifyContent: 'flex-end', flexDirection: 'row' }}>
                        <button onClick={() => setShowDeleteConfirm(false)} className="btn" style={{ background: 'var(--border)' }}>{t('cancel')}</button>
                        <button onClick={handleDelete} className="btn" style={{ background: 'var(--danger-solid-hover)', color: 'var(--text-on-accent)' }}>{t('delete')}</button>
                    </div>
                </div>
            </Modal>
            {/* Reassign Modal */}
            <Modal isOpen={isReassigning} onClose={() => setIsReassigning(false)} title={t('reassign_button')} hideFooter={true}>
                <div style={{ padding: '0.5rem', textAlign: locale === 'ar' ? 'right' : 'left' }}>
                    <p style={{ marginBottom: '1.25rem' }}>{t('transfer_task_msg')}</p>

                    <div style={{
                        maxHeight: '200px',
                        overflowY: 'auto',
                        border: '1px solid var(--border)',
                        borderRadius: '0.5rem',
                        padding: '0.75rem',
                        background: 'var(--surface-subtle)',
                        marginBottom: '1.5rem'
                    }}>
                        {allUsers.length > 0 ? (
                            allUsers.map(u => (
                                <label key={u.id} style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '0.5rem',
                                    marginBottom: '0.5rem',
                                    cursor: 'pointer',
                                    padding: '0.25rem'
                                }}>
                                    <input
                                        type="checkbox"
                                        checked={newAssigneeIds.includes(u.id)}
                                        onChange={e => {
                                            if (e.target.checked) {
                                                setNewAssigneeIds([...newAssigneeIds, u.id])
                                            } else {
                                                setNewAssigneeIds(newAssigneeIds.filter(id => id !== u.id))
                                            }
                                        }}
                                    />
                                    <span style={{ fontSize: '0.9rem' }}>
                                        {u.firstName} {u.lastName} <small style={{ color: 'var(--text-soft)' }}>({u.role})</small>
                                    </span>
                                </label>
                            ))
                        ) : (
                            <div style={{ fontSize: '0.9rem', color: 'var(--text-soft)', textAlign: 'center' }}>{locale === 'ar' ? 'جاري التحميل...' : 'Loading...'}</div>
                        )}
                    </div>

                    <div style={{ display: 'flex', gap: '1rem', justifyContent: 'flex-end', flexDirection: 'row' }}>
                        <button className="btn" style={{ background: 'var(--border)' }} onClick={() => setIsReassigning(false)}>{t('cancel')}</button>
                        <button className="btn btn-primary" onClick={handleReassign} disabled={newAssigneeIds.length === 0}>
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
                        <button onClick={() => setShowRevertConfirm(false)} className="btn" style={{ background: 'var(--border)' }}>{t('cancel')}</button>
                        <button onClick={handleRevert} className="btn" style={{ background: 'var(--info-solid-hover)', color: 'var(--text-on-accent)' }}>
                            {isReverting ? '...' : t('confirm_action_button')}
                        </button>
                    </div>
                </div>
            </Modal>

            {/* Deadline Passed Modal */}
            <Modal isOpen={showDeadlineModal} onClose={() => setShowDeadlineModal(false)} title={t('deadline_passed_title' as any) || (locale === 'ar' ? 'انتهى الموعد النهائي' : 'Deadline Passed')} hideFooter hideCloseButton={true}>
                <div id="deadline-modal-content" style={{ textAlign: locale === 'ar' ? 'right' : 'left' }}>
                    <p style={{ fontSize: '1.1rem', lineHeight: '1.6', marginBottom: '1.5rem' }}>
                        {t('overdue_obligation_alert_msg' as any) || t('overdue_task_alert_msg' as any)}
                    </p>
                    <div style={{ display: 'flex', gap: '1rem', marginTop: '1.5rem', justifyContent: 'flex-end', flexDirection: 'row' }}>
                        <button onClick={() => setShowDeadlineModal(false)} className="btn btn-primary" style={{ minWidth: '100px' }}>
                            {t('confirm_action_button')}
                        </button>
                    </div>
                </div>
            </Modal>
        </div>
    )
}

/* eslint-disable @typescript-eslint/no-explicit-any */
'use client'
import { useState, useEffect, useCallback } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Modal from '@/components/Modal'
import DiffViewer from '@/components/DiffViewer'
import { useToast } from '@/context/ToastContext'
import DateTimePicker from '@/components/DateTimePicker'
import { useLanguage } from '@/context/LanguageContext'
import LocationSearchInput from '@/components/LocationSearchInput'
import { useCompany } from '@/context/CompanyContext' // Added this import

const TrashIcon = ({ size = 18, color = "#ef4444" }: { size?: number, color?: string }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M5 8H19L18.1 20.2C18.05 20.65 17.65 21 17.2 21H6.8C6.35 21 5.95 20.65 5.9 20.2L5 8Z" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M10 11V18" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" strokeDasharray="1 2" />
        <path d="M14 11V18" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" strokeDasharray="1 2" />
        <path d="M8 5V3H16V5" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M4 8H20" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
)

export default function TaskDetailClient({ task: initialTask, userRole, userId, creatorName, currentUserName }: { task: any, userRole: string, userId: string, creatorName: string, currentUserName: string }) {
    const { t, locale } = useLanguage()

    // Parse member costs and payment status
    const getMemberCosts = (taskObj: any) => {
        if (!taskObj.memberCosts) return {}
        try {
            return typeof taskObj.memberCosts === 'string' ? JSON.parse(taskObj.memberCosts) : taskObj.memberCosts
        } catch { return {} }
    }
    const getMemberPaymentStatus = (taskObj: any) => {
        if (!taskObj.memberPaymentStatus) return {}
        try {
            return typeof taskObj.memberPaymentStatus === 'string' ? JSON.parse(taskObj.memberPaymentStatus) : taskObj.memberPaymentStatus
        } catch { return {} }
    }
    const parseLocation = (locStr: string) => {
        if (!locStr) return { name: '', link: '' }
        try {
            if (locStr.startsWith('{')) {
                const parsed = JSON.parse(locStr)
                return { name: parsed.name || '', link: parsed.link || '' }
            }
        } catch { }
        return { name: locStr, link: '' }
    }
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
    const [loadingType, setLoadingType] = useState<'DRAFT' | 'SUBMIT' | null>(null)
    const [capturingLocation, setCapturingLocation] = useState(false)
    const [pendingFiles, setPendingFiles] = useState<File[]>([])
    const [inputKey, setInputKey] = useState(Date.now())
    const [isDragging, setIsDragging] = useState(false)
    const [costEntries, setCostEntries] = useState<any[]>([])
    const [transferAssigneeIds, setTransferAssigneeIds] = useState<string[]>([])
    const [isTransferModalOpen, setIsTransferModalOpen] = useState(false)
    const [allUsers, setAllUsers] = useState<any[]>([])
    const [userFetchError, setUserFetchError] = useState(false)
    const [searchTermTransfer, setSearchTermTransfer] = useState('')
    const [transferring, setTransferring] = useState(false)
    const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
    const [showRevertConfirm, setShowRevertConfirm] = useState(false)
    const [isEditing, setIsEditing] = useState(false)
    const [editForm, setEditForm] = useState({
        title: initialTask.title,
        description: initialTask.description,
        assigneeIds: initialTask.assignees?.map((a: any) => a.id) || [initialTask.assigneeId],
        deadline: initialTask.deadline,
        difficulty: initialTask.difficulty,
        location: parseLocation(initialTask.location || '').name,
        locationLink: parseLocation(initialTask.location || '').link
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
    const [itemToDelete, setItemToDelete] = useState<{ type: 'ATTACHMENT' | 'COST_ADDITION' | 'SUBMISSION_NOTE', itemId: string } | null>(null)
    const [locationToDelete, setLocationToDelete] = useState<{ index?: number, date?: string } | null>(null)
    const [isReverting, setIsReverting] = useState(false)
    const [verifyingLocation, setVerifyingLocation] = useState<string | null>(null)

    const router = useRouter()
    const searchParams = useSearchParams()
    const highlightId = searchParams.get('highlight')
    const shouldHighlight = highlightId === task.id
    const { showToast } = useToast() // Added this line

    const { selectedCompanyId } = useCompany()
    // The userRole prop is already passed to the component, so no need to derive it from session here.
    // const userRole = (session?.user as any)?.role // Removed this line as userRole is a prop

    // Sync state when props change (after router.refresh)
    useEffect(() => {
        setTask(initialTask)
        try {
            setExistingAttachments(initialTask.attachments ? JSON.parse(initialTask.attachments) : [])
        } catch { setExistingAttachments([]) }
        setEditForm({
            title: initialTask.title,
            description: initialTask.description,
            assigneeIds: initialTask.assignees?.map((a: any) => a.id) || [initialTask.assigneeId],
            deadline: initialTask.deadline,
            difficulty: initialTask.difficulty,
            location: parseLocation(initialTask.location || '').name,
            locationLink: parseLocation(initialTask.location || '').link
        })
        setReviewDifficulty(initialTask.difficulty)
    }, [initialTask])

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
        const isUserAssignee = task.assigneeId === userId || task.assignees?.some((a: any) => a.id === userId)
        if (isUserAssignee && (task.isEdited || isEditedPersistent)) {
            // Logic to track if they've seen it could be here
        }
    }, [userId, task.assigneeId, task.assignees, task.isEdited, isEditedPersistent])

    // Load users once for search/filter efficiency
    useEffect(() => {
        if (['ADMIN', 'SUPER_ADMIN', 'TEAM_LEADER'].includes(userRole)) {
            fetch('/api/users')
                .then(r => {
                    if (!r.ok) throw new Error()
                    return r.json()
                })
                .then(data => {
                    // TEAM_LEADER Restriction: Hide ADMIN and SUPER_ADMIN from assignee list
                    const filteredData = userRole === 'TEAM_LEADER'
                        ? data.filter((u: any) => !['ADMIN', 'SUPER_ADMIN'].includes(u.role))
                        : data
                    setAllUsers(filteredData)
                })
                .catch(() => setUserFetchError(true))
        }
    }, [userRole])

    const handleDismiss = async () => {
        try {
            await fetch(`/api/tasks/${task.id}/dismiss-edit`, { method: 'POST' })
            setIsEditedPersistent(false)
            setTask({ ...task, isEdited: false })
            router.refresh()
        } catch (e) { console.error(e) }
    }

    // Listen for suspension auto-save event
    useEffect(() => {
        const handleSuspendSave = () => {
            console.log('Suspension detected, auto-saving task progress...')
            // Only auto-save if employee interaction is active and not already submitted or finalized
            const isUserAssignee = task.assigneeId === userId || task.assignees?.some((a: any) => a.id === userId)
            if ((userRole === 'EMPLOYEE' || isUserAssignee) && !['PENDING_CONFIRMATION', 'APPROVED', 'COMPLETED', 'REJECTED'].includes(task.status)) {
                handleUpload(true)
            }
        }
        window.addEventListener('app:suspend-detected', handleSuspendSave)
        return () => window.removeEventListener('app:suspend-detected', handleSuspendSave)
    }, [task.status, userRole, userId, task.assigneeId, pendingFiles, note, costEntries, location])

    const handleFiles = (newFiles: File[]) => {
        const allowedExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx']

        const validFiles = newFiles.filter(file => {
            // 1. Check Size
            if (file.size > 4 * 1024 * 1024) {
                showToast(t('failed_upload_files') || `File ${file.name} is too large (max 4MB)`, 'error')
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
        setLoadingType(isDraft ? 'DRAFT' : 'SUBMIT')
        console.log('handleUpload started, isDraft:', isDraft)

        try {
            const uploadedUrls: string[] = []
            if (pendingFiles.length > 0) {
                for (const file of pendingFiles) {
                    const formData = new FormData()
                    formData.append('file', file)
                    formData.append('taskId', task.id)

                    try {
                        const uploadRes = await fetch('/api/upload', {
                            method: 'POST',
                            body: formData
                        })

                        if (uploadRes.ok) {
                            const data = await uploadRes.json()
                            if (data.success && data.url) {
                                uploadedUrls.push(data.url)
                            }
                        } else {
                            console.error(`Upload failed for ${file.name}`)
                        }
                    } catch (err) {
                        console.error(`Upload error for ${file.name}:`, err)
                    }
                }

                if (uploadedUrls.length === 0 && pendingFiles.length > 0) {
                    throw new Error('All uploads failed')
                }
            }

            const res = await fetch(`/api/tasks/${task.id}/submit`, {
                method: 'PUT',
                body: JSON.stringify({
                    newAttachments: uploadedUrls,
                    note,
                    costs: costEntries,
                    location,
                    isDraft
                }),
                headers: { 'Content-Type': 'application/json' }
            })

            if (!res.ok) {
                const data = await res.json().catch(() => ({}))
                throw new Error(data.message || 'Submission failed')
            }

            // Clear form fields even for drafts to avoid duplication on next save
            setNote('')
            setCost('')
            setCostDescription('')
            setLocation('')
            setLocationStatus('')
            setPendingFiles([])
            setCostEntries([])

            showToast(isDraft ? t('draft_saved_success') : t('task_submitted_success'), 'success')
            router.refresh()
        } catch (error: any) {
            console.error('handleUpload error:', error)
            showToast(error.message || t('failed_save_generic') as any, 'error')
        } finally {
            setUploading(false)
            setLoadingType(null)
        }
    }

    const handleCaptureLocation = async () => {
        if (['PENDING_CONFIRMATION', 'APPROVED', 'COMPLETED', 'REJECTED'].includes(task.status)) {
            showToast(t('cannot_edit_submitted_task'), 'error')
            return
        }

        if (!navigator.geolocation) {
            setLocationStatus('Geolocation not supported')
            return
        }

        try {
            const comments = JSON.parse(task.comments || '[]')
            const userLocationCount = Array.isArray(comments) ? comments.filter((c: any) => c.type === 'LOCATION_ADDED' && c.authorId === userId).length : 0
            if (userLocationCount >= 10) {
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
            const res = await fetch(`/api/tasks/${task.id}/delete`, { method: 'DELETE' })
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
        if (transferAssigneeIds.length === 0 || transferring) return
        setTransferring(true)
        try {
            const res = await fetch(`/api/tasks/${task.id}/transfer`, {
                method: 'POST',
                body: JSON.stringify({ newAssigneeIds: transferAssigneeIds }),
                headers: { 'Content-Type': 'application/json' }
            })
            if (!res.ok) {
                const data = await res.json().catch(() => ({}))
                throw new Error(data.message || 'Transfer failed')
            }
            showToast(t('task_transfer_success'), 'success')
            setIsTransferModalOpen(false)
            router.refresh()
        } catch (e: any) {
            console.error(e)
            showToast(e.message || t('failed_transfer_task'), 'error')
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
            assigneeIds: task.assignees?.map((a: any) => a.id) || [task.assigneeId],
            deadline: task.deadline,
            difficulty: task.difficulty,
            location: parseLocation(task.location || '').name,
            locationLink: parseLocation(task.location || '').link
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
                body: JSON.stringify({
                    ...editForm,
                    location: editForm.location || editForm.locationLink ? JSON.stringify({ name: editForm.location, link: editForm.locationLink }) : ''
                }),
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

    const handlePaymentStatusChange = async (newStatus: string, targetUserId?: string) => {
        try {
            const res = await fetch(`/api/tasks/${task.id}/payment`, {
                method: 'PUT',
                body: JSON.stringify({ paymentStatus: newStatus, targetUserId }),
                headers: { 'Content-Type': 'application/json' }
            })
            if (!res.ok) throw new Error('Update failed')
            const statusLabel = newStatus === 'PAID' ? t('payment_status_paid' as any) : t('payment_status_pending' as any)
            showToast(t('payment_status_updated_prefix' as any) + statusLabel, 'success')
            router.refresh()
        } catch (e) {
            console.error(e)
            showToast(t('failed_update_payment_status'), 'error')
        }
    }

    const handleRevert = async () => {
        setIsReverting(true)
        setShowRevertConfirm(false)
        try {
            const res = await fetch(`/api/tasks/${task.id}/revert`, { method: 'POST' })
            if (!res.ok) {
                const data = await res.json().catch(() => ({}))
                throw new Error(data.message || 'Revert failed')
            }
            showToast(t('task_reverted_success'), 'success')
            router.refresh()
        } catch (e: any) {
            console.error(e)
            showToast(e.message || t('failed_revert_task'), 'error')
        } finally {
            setIsReverting(false)
        }
    }

    const handleDeleteItem = (type: 'ATTACHMENT' | 'COST_ADDITION' | 'SUBMISSION_NOTE', itemId: string) => {
        setItemToDelete({ type, itemId })
    }

    const confirmDeleteItem = async () => {
        if (!itemToDelete) return
        const { type, itemId } = itemToDelete
        try {
            const res = await fetch(`/api/tasks/${task.id}/items`, {
                method: 'DELETE',
                body: JSON.stringify({ type, itemId }),
                headers: { 'Content-Type': 'application/json' }
            })

            if (!res.ok) throw new Error('Delete failed')
            showToast(t('item_deleted_success') || 'Deleted successfully', 'success')
            setItemToDelete(null)
            router.refresh()
        } catch (e) {
            console.error(e)
            showToast(t('error_generic'), 'error')
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
        <div className={`card ${shouldHighlight ? 'highlight-shading' : ''}`} style={containerStyle}>
            {/* Deleted Assignee Alert - Check if primary is deleted */}
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
                    <span style={{
                        padding: '0.5rem',
                        borderRadius: '0.5rem',
                        background: task.status === 'COMPLETED' ? '#e0f2fe' : task.status === 'APPROVED' ? '#dcfce7' : task.status === 'PENDING_CONFIRMATION' ? '#fef9c3' : task.status === 'REJECTED' ? '#fee2e2' : '#e2e8f0',
                        color: task.status === 'COMPLETED' ? '#0369a1' : task.status === 'APPROVED' ? '#166534' : task.status === 'PENDING_CONFIRMATION' ? '#854d0e' : task.status === 'REJECTED' ? '#991b1b' : '#0f172a',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '0.35rem',
                        fontSize: (task as any).lastStatusUpdateBy && ['APPROVED', 'REJECTED', 'COMPLETED'].includes(task.status) ? '0.75rem' : 'inherit'
                    }}>
                        {t(`status_${task.status.toLowerCase()}` as any)}
                        {(task as any).lastStatusUpdateBy && ['APPROVED', 'REJECTED', 'COMPLETED'].includes(task.status) && (
                            <span style={{ fontWeight: 'normal', opacity: 0.8, fontSize: '0.7rem' }}>
                                • {(task as any).lastStatusUpdateBy}
                            </span>
                        )}
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
                    {userRole === 'SUPER_ADMIN' && ['APPROVED', 'COMPLETED', 'REJECTED', 'PENDING_CONFIRMATION'].includes(task.status) && task.paymentStatus === 'PENDING_PAYMENT' && (
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
                    <button onClick={() => router.back()} style={{ background: 'none', border: '1px solid #cbd5e1', borderRadius: '0.25rem', padding: '0.5rem 1rem', cursor: 'pointer', color: '#64748b' }}>{t('close_button')}</button>
                    {(['ADMIN', 'SUPER_ADMIN', 'TEAM_LEADER'].includes(userRole) && (userRole === 'TEAM_LEADER' || userId !== task.assigneeId)) && (<button onClick={handleEditClick} style={{ background: '#e0f2fe', color: '#0369a1', border: 'none', borderRadius: '0.25rem', padding: '0.5rem 1rem', cursor: 'pointer' }}>{t('edit_task_button')}</button>)}
                    {(['ADMIN', 'SUPER_ADMIN', 'TEAM_LEADER'].includes(userRole) && (userRole === 'TEAM_LEADER' || userId !== task.assigneeId)) && (<button onClick={() => setShowDeleteConfirm(true)} style={{ background: '#fee2e2', color: '#991b1b', border: 'none', borderRadius: '0.25rem', padding: '0.5rem 1rem', cursor: 'pointer' }}>{t('delete_task_button')}</button>)}
                </div>
            </div>

            <div style={{ marginTop: '1.5rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem', flexDirection: 'row' }}>
                    {(task.isEdited || isEditedPersistent) && userId === task.assigneeId && latestChanges?.description && !viewedDescriptionChange && (
                        <button onClick={() => { setDiffField('description'); setViewedDescriptionChange(true); }} style={{ background: '#ffedd5', color: '#9a3412', border: '1px solid #fdba74', borderRadius: '0.25rem', padding: '0.1rem 0.5rem', fontSize: '0.7rem', cursor: 'pointer', fontWeight: 'bold' }}>{t('edit')}</button>
                    )}
                </div>
                <p style={{ fontSize: '1.1rem', margin: 0, whiteSpace: 'pre-wrap' }}>{task.description}</p>
                {task.location && (() => {
                    const { name, link } = parseLocation(task.location)
                    return (
                        <div style={{ marginTop: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#0369a1', fontSize: '0.95rem', fontWeight: '500' }}>
                            <span>📍</span>
                            {link ? (
                                <a href={link} target="_blank" rel="noopener noreferrer" style={{ color: '#0369a1', textDecoration: 'underline' }}>
                                    {name || link}
                                </a>
                            ) : (
                                <span>{name}</span>
                            )}
                        </div>
                    )
                })()}
            </div>

            <div style={{ marginTop: '1rem', color: '#64748b', fontSize: '0.9rem' }}>
                {t('assigned_by')}: <strong>{creatorName}</strong> | {t('deadline_label')}: <strong>{new Date(task.deadline).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' }) + ' ' + new Date(task.deadline).toLocaleDateString(locale === 'ar' ? 'ar-EG' : 'en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}</strong>
            </div>
            <div style={{ marginTop: '0.5rem', color: '#64748b', fontSize: '0.9rem' }}>
                {t('assignee_label')}: {task.assignees?.length > 0 ? (
                    task.assignees.map((a: any, idx: number) => (
                        <span key={a.id}>
                            <strong>{a.firstName} {a.lastName}</strong>
                            {idx < task.assignees.length - 1 ? ', ' : ''}
                        </span>
                    ))
                ) : (
                    <strong>{task.assignee?.firstName} {task.assignee?.lastName}</strong>
                )}
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
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                                    {(task.assignees?.length > 1) && (
                                                        <span style={{ background: '#f1f5f9', border: '1px solid #cbd5e1', color: '#475569', padding: '0.1rem 0.4rem', borderRadius: '1rem', fontSize: '0.65rem', fontWeight: 'bold' }}>
                                                            {locale === 'ar' ? 'بواسطة:' : 'By:'} {log.author}
                                                        </span>
                                                    )}
                                                    {!((task.assignees?.length > 1)) && <span style={{ fontWeight: 'bold', color: '#1e293b' }}>{log.author}</span>}
                                                    {log.type === 'SUBMISSION_NOTE' && task.status === 'IN_PROGRESS' && (
                                                        <button onClick={() => handleDeleteItem('SUBMISSION_NOTE', log.date)} className="btn-icon" style={{ padding: '2px', border: 'none', background: 'none', cursor: 'pointer', display: 'flex' }} title={t('delete_note_title')}>
                                                            <TrashIcon size={14} />
                                                        </button>
                                                    )}
                                                </div>
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
                            <div key={idx} style={{ position: 'relative' }}>
                                <a href={att.url} target="_blank" rel="noopener noreferrer" style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.75rem', background: 'white', border: '1px solid #e2e8f0', borderRadius: '0.5rem', textDecoration: 'none', color: '#334155', transition: 'all 0.2s', flexDirection: 'row' }}>
                                    <span style={{ fontSize: '1.5rem' }}>📄</span>
                                    <div style={{ overflow: 'hidden', textAlign: locale === 'ar' ? 'right' : 'left' }}>
                                        <div style={{ fontSize: '0.9rem', fontWeight: '500', textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>{att.name || t('attachment')}</div>
                                        <div style={{ fontSize: '0.7rem', color: '#64748b' }}>
                                            {(task.assignees?.length > 1) && (
                                                <span style={{ background: '#f1f5f9', border: '1px solid #cbd5e1', color: '#475569', padding: '0.05rem 0.3rem', borderRadius: '1rem', fontSize: '0.6rem', fontWeight: 'bold', marginRight: locale === 'ar' ? '0' : '0.25rem', marginLeft: locale === 'ar' ? '0.25rem' : '0' }}>
                                                    {locale === 'ar' ? 'بواسطة:' : 'By:'} {att.uploadedBy}
                                                </span>
                                            )}
                                            {!((task.assignees?.length > 1)) && <span>{att.uploadedBy}</span>}
                                            <span> • {new Date(att.uploadedAt).toLocaleDateString(locale)}</span>
                                        </div>
                                    </div>
                                </a>
                                {task.status === 'IN_PROGRESS' && (
                                    <button
                                        onClick={(e) => { e.preventDefault(); handleDeleteItem('ATTACHMENT', att.url); }}
                                        style={{ position: 'absolute', top: '5px', right: locale === 'ar' ? 'auto' : '5px', left: locale === 'ar' ? '5px' : 'auto', background: 'white', border: '1px solid #fee2e2', borderRadius: '50%', padding: '4px', cursor: 'pointer', display: 'flex' }}
                                        title={t('delete_attachment_title')}
                                    >
                                        <TrashIcon size={14} />
                                    </button>
                                )}
                            </div>
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
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                                        <div style={{ fontSize: '0.75rem', color: '#92400e', textTransform: 'uppercase', fontWeight: '600', marginBottom: '0.25rem' }}>{t('cost_description_placeholder').split(' ')[0]}</div>
                                                        {task.status === 'IN_PROGRESS' && (
                                                            <button onClick={() => handleDeleteItem('COST_ADDITION', c.date)} style={{ background: 'none', border: 'none', padding: '2px', cursor: 'pointer', display: 'flex' }} title={t('delete_cost_title')}>
                                                                <TrashIcon size={14} />
                                                            </button>
                                                        )}
                                                    </div>
                                                    <div style={{ fontSize: '1rem', fontWeight: '600', color: '#78350f' }}>{c.description || t('no_description')}</div>
                                                </div>
                                                <div style={{ textAlign: 'center', background: '#fef3c7', padding: '0.5rem 1rem', borderRadius: '0.375rem', border: '1px solid #fcd34d' }}>
                                                    <div style={{ fontSize: '0.75rem', color: '#92400e', textTransform: 'uppercase', fontWeight: '600' }}>{t('amount_label')}</div>
                                                    <div style={{ fontSize: '1.1rem', fontWeight: 'bold', color: '#92400e' }}>{(c.amount || 0).toFixed(2)} {t('egp')}</div>
                                                </div>
                                            </div>
                                            <div style={{ fontSize: '0.75rem', color: '#b45309', marginTop: '0.5rem', borderTop: '1px dashed #fcd34d', paddingTop: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                                {(task.assignees?.length > 1) && (
                                                    <span style={{ background: '#fef3c7', border: '1px solid #f59e0b', color: '#b45309', padding: '0.1rem 0.4rem', borderRadius: '1rem', fontSize: '0.65rem', fontWeight: 'bold' }}>
                                                        {locale === 'ar' ? 'بواسطة:' : 'By:'} {c.author}
                                                    </span>
                                                )}
                                                {!((task.assignees?.length > 1)) && <span>{c.author}</span>}
                                                <span>• {new Date(c.date).toLocaleString(locale)}</span>
                                            </div>
                                        </div>
                                    ))}
                                    {(() => {
                                        const isAssignee = task.assigneeId === userId || task.assignees?.some((a: any) => a.id === userId)
                                        const isMulti = (task.assignees?.length || 0) > 1
                                        const mPaymentStatus = getMemberPaymentStatus(task)

                                        if (isMulti && isAssignee) {
                                            const myStatus = mPaymentStatus[userId] || 'PENDING_PAYMENT'
                                            return (
                                                <div style={{ display: 'flex', gap: '1rem', marginBottom: '0.5rem', flexDirection: 'row', flexWrap: 'wrap' }}>
                                                    <div style={{ flex: 1, minWidth: '150px', background: '#3b82f6', color: 'white', padding: '1.25rem', borderRadius: '1rem', textAlign: 'center', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.1)', position: 'relative' }}>
                                                        <div style={{ fontSize: '0.875rem', fontWeight: '600', opacity: 0.9 }}>{t('my_total_cost' as any)}</div>
                                                        <div style={{ fontSize: '1.5rem', fontWeight: 'bold' }}>{(getMemberCosts(task)[userId] || 0).toFixed(2)} {t('egp')}</div>
                                                        <div style={{
                                                            marginTop: '0.5rem',
                                                            padding: '0.2rem 0.6rem',
                                                            borderRadius: '1rem',
                                                            background: 'rgba(255, 255, 255, 0.2)',
                                                            fontSize: '0.65rem',
                                                            fontWeight: '800',
                                                            width: 'fit-content',
                                                            margin: '0.5rem auto 0',
                                                            textTransform: 'uppercase'
                                                        }}>
                                                            {myStatus === 'PAID' ? t('payment_status_paid' as any) || 'PAID' : t('payment_status_pending' as any) || 'PENDING'}
                                                        </div>
                                                    </div>
                                                    <div style={{ flex: 1, minWidth: '150px', background: '#f59e0b', color: 'white', padding: '1.25rem', borderRadius: '1rem', textAlign: 'center', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.1)' }}>
                                                        <div style={{ fontSize: '0.875rem', fontWeight: '600', opacity: 0.9 }}>{t('grand_total_cost' as any)}</div>
                                                        <div style={{ fontSize: '1.5rem', fontWeight: 'bold' }}>{(task.totalCost || 0).toFixed(2)} {t('egp')}</div>
                                                        <div style={{
                                                            marginTop: '0.5rem',
                                                            padding: '0.2rem 0.6rem',
                                                            borderRadius: '1rem',
                                                            background: 'rgba(255, 255, 255, 0.2)',
                                                            fontSize: '0.65rem',
                                                            fontWeight: '800',
                                                            width: 'fit-content',
                                                            margin: '0.5rem auto 0',
                                                            textTransform: 'uppercase'
                                                        }}>
                                                            {task.paymentStatus === 'PAID' ? t('payment_status_paid' as any) || 'PAID' : t('payment_status_pending' as any) || 'PENDING'}
                                                        </div>
                                                    </div>
                                                </div>
                                            )
                                        }

                                        return (
                                            <div style={{ background: '#f59e0b', color: 'white', padding: '1.25rem', borderRadius: '1rem', textAlign: 'center', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.1)' }}>
                                                <div style={{ fontSize: '0.875rem', fontWeight: '600', opacity: 0.9 }}>{t('total_cost')}</div>
                                                <div style={{ fontSize: '1.5rem', fontWeight: 'bold' }}>{(task.totalCost || 0).toFixed(2)} {t('egp')}</div>
                                                <div style={{
                                                    marginTop: '0.5rem',
                                                    padding: '0.2rem 0.6rem',
                                                    borderRadius: '1rem',
                                                    background: 'rgba(255, 255, 255, 0.2)',
                                                    fontSize: '0.65rem',
                                                    fontWeight: '800',
                                                    width: 'fit-content',
                                                    margin: '0.5rem auto 0',
                                                    textTransform: 'uppercase'
                                                }}>
                                                    {task.paymentStatus === 'PAID' ? t('payment_status_paid' as any) || 'PAID' : t('payment_status_pending' as any) || 'PENDING'}
                                                </div>
                                            </div>
                                        )
                                    })()}

                                    {/* Individual Settlements for Admins */}
                                    {['ADMIN', 'SUPER_ADMIN', 'TEAM_LEADER'].includes(userRole) && (task.assignees?.length || 0) > 1 && Object.keys(getMemberCosts(task)).length > 0 && (
                                        <div style={{ marginTop: '1rem', padding: '1.25rem', background: '#f8fafc', borderRadius: '1rem', border: '1px solid #e2e8f0' }}>
                                            <h4 style={{ fontSize: '0.9rem', fontWeight: '700', marginBottom: '1rem', color: '#1e293b' }}>
                                                {t('individual_settlements' as any) || 'Individual Settlements'}
                                            </h4>
                                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                                                {Object.entries(getMemberCosts(task)).map(([uid, amount]: [string, any]) => {
                                                    const assignee = task.assignees.find((a: any) => a.id === uid)
                                                    if (!assignee) return null
                                                    const isPaid = getMemberPaymentStatus(task)[uid] === 'PAID'

                                                    return (
                                                        <div key={uid} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.75rem 1rem', background: 'white', border: '1px solid #e2e8f0', borderRadius: '0.75rem' }}>
                                                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                                                                <div style={{ width: '32px', height: '32px', borderRadius: '50%', background: '#f1f5f9', display: 'flex', alignItems: 'center', justifySelf: 'center', fontSize: '0.8rem', fontWeight: 'bold', color: '#64748b' }}>
                                                                    {assignee.firstName[0]}{assignee.lastName[0]}
                                                                </div>
                                                                <div>
                                                                    <div style={{ fontWeight: '700', color: '#334155', fontSize: '0.875rem' }}>{assignee.firstName} {assignee.lastName}</div>
                                                                    <div style={{ fontSize: '0.8rem', color: '#64748b', fontWeight: '600' }}>{amount.toFixed(2)} {t('egp')}</div>
                                                                </div>
                                                            </div>
                                                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                                                                <div style={{
                                                                    padding: '0.2rem 0.5rem',
                                                                    borderRadius: '1rem',
                                                                    background: isPaid ? '#dcfce7' : '#fee2e2',
                                                                    color: isPaid ? '#166534' : '#991b1b',
                                                                    fontSize: '0.65rem',
                                                                    fontWeight: '800',
                                                                    textTransform: 'uppercase'
                                                                }}>
                                                                    {isPaid ? t('payment_status_paid' as any) || 'PAID' : t('payment_status_pending' as any) || 'PENDING'}
                                                                </div>
                                                                <button
                                                                    onClick={() => handlePaymentStatusChange(isPaid ? 'PENDING_PAYMENT' : 'PAID', uid)}
                                                                    style={{
                                                                        background: isPaid ? '#f1f5f9' : '#10b981',
                                                                        color: isPaid ? '#64748b' : 'white',
                                                                        padding: '0.4rem 0.8rem',
                                                                        fontSize: '0.75rem',
                                                                        fontWeight: '700',
                                                                        border: 'none',
                                                                        borderRadius: '0.5rem',
                                                                        cursor: 'pointer',
                                                                        transition: 'all 0.2s'
                                                                    }}
                                                                >
                                                                    {isPaid ? t('mark_as_unpaid' as any) || 'Unsettle' : t('mark_as_paid')}
                                                                </button>
                                                            </div>
                                                        </div>
                                                    )
                                                })}
                                            </div>
                                        </div>
                                    )}
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
                                <style>{`
                                    @keyframes spin-local {
                                        to { transform: rotate(360deg); }
                                    }
                                    .animate-spin-local {
                                        animation: spin-local 1s linear infinite;
                                    }
                                `}</style>
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
                                            const timestamp = loc.date
                                            const actionId = `${timestamp}-${status}`
                                            if (verifyingLocation === actionId) return

                                            setVerifyingLocation(actionId)

                                            // UI Logic
                                            const originalComments = task.comments
                                            try {
                                                const currentComments = JSON.parse(task.comments || '[]')
                                                const updatedComments = currentComments.map((c: any) => {
                                                    if (c.type === 'LOCATION_ADDED' && c.date === timestamp) {
                                                        return { ...c, verificationStatus: status, autoVerified: false }
                                                    }
                                                    return c
                                                })

                                                const res = await fetch(`/api/tasks/${task.id}/locations`, {
                                                    method: 'PUT',
                                                    body: JSON.stringify({ timestamp, action: 'VERIFY', verificationStatus: status }),
                                                    headers: { 'Content-Type': 'application/json' }
                                                })

                                                if (!res.ok) throw new Error('Failed to verify')

                                                // Update UI only AFTER successful database save
                                                setTask({ ...task, comments: JSON.stringify(updatedComments) })

                                                router.refresh()
                                            } catch (e) {
                                                console.error(e)
                                                // Rollback on error
                                                setTask({ ...task, comments: originalComments })
                                                showToast(t('failed_verify_location' as any) || 'Failed to update status', 'error')
                                            } finally {
                                                setVerifyingLocation(null)
                                            }
                                        }

                                        return (
                                            <div key={i} style={{ border: '1px solid #bae6fd', background: '#f0f9ff', borderRadius: '0.5rem', padding: '1rem' }}>
                                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexDirection: 'row', gap: '1rem' }}>
                                                    <div style={{ display: 'flex', gap: '0.75rem', flexDirection: 'row' }}>
                                                        <span style={{ fontSize: '1.25rem' }}>📍</span>
                                                        <div style={{ textAlign: locale === 'ar' ? 'right' : 'left' }}>
                                                            {mapsLink ? <a href={mapsLink} target="_blank" rel="noreferrer" style={{ fontWeight: '600', color: '#0369a1', textDecoration: 'underline' }}>{displayLoc}</a> : <span style={{ fontWeight: '600', color: '#0c4a6e' }}>{displayLoc}</span>}
                                                            <div style={{ fontSize: '0.75rem', color: '#0369a1', marginTop: '0.25rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                                                {(task.assignees?.length > 1) && (
                                                                    <span style={{ background: '#e0f2fe', border: '1px solid #38bdf8', color: '#0369a1', padding: '0.1rem 0.4rem', borderRadius: '1rem', fontSize: '0.65rem', fontWeight: 'bold' }}>
                                                                        {locale === 'ar' ? 'بواسطة:' : 'By:'} {loc.author}
                                                                    </span>
                                                                )}
                                                                {!((task.assignees?.length > 1)) && <span>{loc.author}</span>}
                                                                <span>• {new Date(loc.date).toLocaleString(locale)}</span>
                                                            </div>
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
                                                                <button
                                                                    onClick={() => handleVerify('CORRECT')}
                                                                    disabled={!!verifyingLocation}
                                                                    style={{
                                                                        background: '#dcfce7',
                                                                        border: '1px solid #22c55e',
                                                                        color: '#166534',
                                                                        width: '32px',
                                                                        height: '32px',
                                                                        borderRadius: '50%',
                                                                        cursor: verifyingLocation ? 'not-allowed' : 'pointer',
                                                                        display: 'flex',
                                                                        alignItems: 'center',
                                                                        justifyContent: 'center'
                                                                    }}
                                                                    title={t('mark_correct_title')}
                                                                >
                                                                    {verifyingLocation === `${loc.date}-CORRECT` ? <div className="animate-spin-local" style={{ width: '14px', height: '14px', border: '2px solid #166534', borderTopColor: 'transparent', borderRadius: '50%' }} /> : '✓'}
                                                                </button>
                                                                <button
                                                                    onClick={() => handleVerify('WRONG')}
                                                                    disabled={!!verifyingLocation}
                                                                    style={{
                                                                        background: '#fee2e2',
                                                                        border: '1px solid #ef4444',
                                                                        color: '#991b1b',
                                                                        width: '32px',
                                                                        height: '32px',
                                                                        borderRadius: '50%',
                                                                        cursor: verifyingLocation ? 'not-allowed' : 'pointer',
                                                                        display: 'flex',
                                                                        alignItems: 'center',
                                                                        justifyContent: 'center'
                                                                    }}
                                                                    title={t('mark_wrong_title')}
                                                                >
                                                                    {verifyingLocation === `${loc.date}-WRONG` ? <div className="animate-spin-local" style={{ width: '14px', height: '14px', border: '2px solid #991b1b', borderTopColor: 'transparent', borderRadius: '50%' }} /> : '✕'}
                                                                </button>
                                                            </div>
                                                        )}
                                                        {canDelete && task.status === 'IN_PROGRESS' && (
                                                            <button onClick={() => setLocationToDelete({ date: loc.date })} style={{ background: '#fee2e2', color: '#dc2626', border: 'none', borderRadius: '0.25rem', padding: '0.4rem', cursor: 'pointer', display: 'flex' }} title={t('delete_location_title')}>
                                                                <TrashIcon size={16} />
                                                            </button>
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
                        <button onClick={() => handleUpload(true)} disabled={uploading} className="btn" style={{ background: '#e2e8f0', color: '#1e293b', fontWeight: '600', flex: 1 }}>{loadingType === 'DRAFT' ? t('saving') : t('save_draft_button')}</button>
                        <button onClick={handleUploadRequest} disabled={uploading} className="btn btn-primary" style={{ fontWeight: '700', flex: 2 }}>{loadingType === 'SUBMIT' ? t('submitting') : t('submit_task_button')}</button>
                    </div>
                </div>
            )}

            {/* Finalized/Pending Message for Employees */}
            {(userRole === 'EMPLOYEE' || userId === task.assigneeId) && ['PENDING_CONFIRMATION', 'APPROVED', 'COMPLETED', 'REJECTED'].includes(task.status) && (
                <div style={{ marginTop: '2rem', padding: '1.5rem', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '0.5rem', textAlign: 'center' }}>
                    <p style={{ margin: 0, color: '#475569', fontWeight: '500' }}>
                        {task.status === 'PENDING_CONFIRMATION'
                            ? t('pending_confirmation_msg' as any) || "Submitted and awaiting review"
                            : t('task_finalized_msg' as any) || "This task has been finalized and cannot be modified."}
                    </p>
                </div>
            )}

            {/* Transfer Button (Admins only) */}
            {['ADMIN', 'SUPER_ADMIN', 'TEAM_LEADER'].includes(userRole) && ['IN_PROGRESS', 'PENDING'].includes(task.status) && (
                <div style={{ marginTop: '2rem', textAlign: locale === 'ar' ? 'left' : 'right' }}>
                    <button
                        onClick={() => {
                            const currentIds = task.assignees?.map((a: any) => a.id) || (task.assigneeId ? [task.assigneeId] : [])
                            setTransferAssigneeIds(currentIds)
                            setIsTransferModalOpen(true)
                        }}
                        className="btn"
                        style={{
                            background: '#f8fafc',
                            color: '#475569',
                            border: '1px solid #cbd5e1',
                            borderRadius: '0.5rem',
                            padding: '0.6rem 1.25rem',
                            fontSize: '0.875rem',
                            fontWeight: '600',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '0.5rem',
                            boxShadow: '0 1px 2px rgba(0,0,0,0.05)',
                            transition: 'all 0.2s ease',
                            cursor: 'pointer'
                        }}
                    >
                        <span>🔄</span> {t('transfer_to_another_employee')}
                    </button>
                </div>
            )}

            {/* Approve/Reject Buttons (Admins only) */}
            {['ADMIN', 'SUPER_ADMIN', 'TEAM_LEADER'].includes(userRole) && task.status === 'PENDING_CONFIRMATION' && (userRole === 'TEAM_LEADER' || userId !== task.assigneeId) && (
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
                        <button onClick={() => {
                            setShowDeleteConfirm(false)
                            handleDelete()
                        }} className="btn" style={{ background: '#ef4444', color: 'white' }}>{t('delete')}</button>
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
                        <textarea className="input" rows={4} value={editForm.description} onChange={e => { setEditForm({ ...editForm, description: e.target.value }); setEditFieldErrors({ ...editFieldErrors, description: '' }); }} style={{ borderColor: editFieldErrors.description ? '#ef4444' : undefined }} maxLength={1000} required />
                        <div style={{ textAlign: locale === 'ar' ? 'left' : 'right', fontSize: '0.7rem', color: '#94a3b8', marginTop: '0.25rem' }}>{editForm.description.length}/1000</div>
                    </div>
                    <div style={{ marginBottom: '1.25rem' }}>
                        <LocationSearchInput
                            label="Location"
                            value={{ name: editForm.location, link: (editForm as any).locationLink }}
                            onChange={(val) => {
                                setEditForm({ ...editForm, location: val.name, locationLink: val.link } as any)
                            }}
                            placeholder={t('location_name_placeholder')}
                            locale={locale}
                        />
                    </div>
                    <div style={{ marginBottom: '1.25rem' }}>
                        <label className="label">{t('assignee_label')}</label>
                        <div style={{
                            maxHeight: '150px',
                            overflowY: 'auto',
                            border: '1px solid #e2e8f0',
                            borderRadius: '0.5rem',
                            padding: '1rem',
                            background: '#f8fafc',
                            display: 'flex',
                            flexWrap: 'wrap',
                            gap: '0.5rem'
                        }}>
                            {task.assignees && task.assignees.length > 0 ? (
                                task.assignees.map((u: any) => (
                                    <div key={u.id} style={{
                                        background: 'white',
                                        border: '1px solid #e2e8f0',
                                        borderRadius: '2rem',
                                        padding: '0.4rem 1rem',
                                        fontSize: '0.9rem',
                                        color: '#334155',
                                        display: 'flex',
                                        alignItems: 'center',
                                        boxShadow: '0 1px 2px rgba(0,0,0,0.05)'
                                    }}>
                                        {u.firstName} {u.lastName} <small style={{ color: '#64748b', marginLeft: locale === 'ar' ? 0 : '0.4rem', marginRight: locale === 'ar' ? '0.4rem' : 0 }}>({t(`role_${u.role?.toLowerCase()}` as any)})</small>
                                    </div>
                                ))
                            ) : (
                                <div style={{
                                    background: 'white',
                                    border: '1px solid #e2e8f0',
                                    borderRadius: '2rem',
                                    padding: '0.5rem 1rem',
                                    fontSize: '0.9rem',
                                    fontWeight: '600'
                                }}>
                                    {task.assignee?.firstName} {task.assignee?.lastName}
                                </div>
                            )}
                        </div>
                        <p style={{ fontSize: '0.75rem', color: '#64748b', marginTop: '0.5rem' }}>
                            {t('transfer_notice' as any) || (locale === 'ar' ? 'يرجى استخدام زر "التحويل" لتغيير الموظفين.' : 'Please use the "Transfer" button to change employees.')}
                        </p>
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

                    <input
                        type="text"
                        className="input"
                        placeholder={t('search_placeholder')}
                        value={searchTermTransfer}
                        onChange={e => setSearchTermTransfer(e.target.value)}
                        style={{ marginBottom: '0.5rem', fontSize: '0.9rem' }}
                    />

                    <div style={{
                        maxHeight: '200px',
                        overflowY: 'auto',
                        border: '1px solid #e2e8f0',
                        borderRadius: '0.5rem',
                        padding: '0.75rem',
                        background: '#f8fafc',
                        marginBottom: '1.5rem'
                    }}>
                        {allUsers.length > 0 ? (
                            allUsers.filter(u => `${u.firstName} ${u.lastName}`.toLowerCase().includes(searchTermTransfer.toLowerCase())).length > 0 ? (
                                allUsers.filter(u => `${u.firstName} ${u.lastName}`.toLowerCase().includes(searchTermTransfer.toLowerCase())).map(u => (
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
                                            checked={transferAssigneeIds.includes(u.id)}
                                            onChange={e => {
                                                if (e.target.checked) {
                                                    setTransferAssigneeIds([...transferAssigneeIds, u.id])
                                                } else {
                                                    setTransferAssigneeIds(transferAssigneeIds.filter(id => id !== u.id))
                                                }
                                            }}
                                        />
                                        <span style={{ fontSize: '0.9rem' }}>
                                            {u.firstName} {u.lastName} <small style={{ color: '#64748b' }}>({t(`role_${u.role?.toLowerCase()}` as any)})</small>
                                        </span>
                                    </label>
                                ))
                            ) : (
                                <div style={{ fontSize: '0.9rem', color: '#64748b', textAlign: 'center' }}>{t('no_data_available')}</div>
                            )
                        ) : userFetchError ? (
                            <div style={{ fontSize: '0.9rem', color: '#ef4444' }}>{t('failed_fetch_data')}</div>
                        ) : (
                            <div style={{ fontSize: '0.9rem', color: '#64748b' }}>{locale === 'ar' ? 'جاري التحميل...' : 'Loading...'}</div>
                        )}
                    </div>

                    <div style={{ display: 'flex', gap: '1rem', justifyContent: 'flex-end', flexDirection: 'row' }}>
                        <button onClick={() => setIsTransferModalOpen(false)} className="btn" style={{ background: '#e2e8f0' }}>{t('cancel')}</button>
                        <button onClick={handleTransfer} disabled={transferAssigneeIds.length === 0 || transferring} className="btn btn-primary">{transferring ? '...' : t('confirm_transfer_button')}</button>
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

            {/* Delete Item Modal */}
            <Modal isOpen={!!itemToDelete} onClose={() => setItemToDelete(null)} title={
                itemToDelete?.type === 'COST_ADDITION' ? t('delete_cost_title') :
                    itemToDelete?.type === 'ATTACHMENT' ? t('delete_attachment_title') :
                        t('delete_note_title')
            } hideFooter>
                <div style={{ textAlign: locale === 'ar' ? 'right' : 'left' }}>
                    <p>{t('confirm_item_delete')}</p>
                    <div style={{ display: 'flex', gap: '1rem', marginTop: '1.5rem', justifyContent: 'flex-end', flexDirection: 'row' }}>
                        <button onClick={() => setItemToDelete(null)} className="btn" style={{ background: '#e2e8f0' }}>{t('cancel')}</button>
                        <button onClick={confirmDeleteItem} className="btn" style={{ background: '#dc2626', color: 'white' }}>{t('delete')}</button>
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

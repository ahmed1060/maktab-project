/* eslint-disable @typescript-eslint/no-explicit-any */
'use client'
import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Modal from '@/components/Modal'
// Its dates once the browser has the page: drawn on the server, they came out in its time zone.
import SafeDate from '@/components/SafeDate'
import DiffViewer from '@/components/DiffViewer'
import { useToast } from '@/context/ToastContext'
import { useLanguage } from '@/context/LanguageContext'
import TrashIcon from '@/components/TrashIcon'
import TaskCostsSection from '@/components/TaskCostsSection'
import TaskLocationHistorySection from '@/components/TaskLocationHistorySection'
import TaskSubmissionForm from '@/components/TaskSubmissionForm'
import type { PickedName } from '@/components/ui'
import TaskEditDetailsModal from '@/components/TaskEditDetailsModal'
import TaskTransferModal from '@/components/TaskTransferModal'
import TaskConfirmModals from '@/components/TaskConfirmModals'
import { SESSION_EXPIRED_MESSAGE, redirectAfterSessionExpiry } from '@/lib/session-expired'
import SectionBoundary from '@/components/SectionBoundary'
import { useAdjustOnChange } from '@/lib/useAdjustOnChange'
import { useCan } from '@/lib/useCan'
import { useBusyAction } from '@/lib/useBusyAction'
import { startNavigationProgress } from '@/components/NavigationProgress'
import { fetchRetrying } from '@/lib/swr-fetcher'
import { locationLabel } from '@/lib/locations'
import { parseTaskLocation } from '@/lib/task-place'
import { googleMapsLink } from '@/lib/attendance/geo'
import { RECEIPT_ACCEPT, RECEIPTS_FOLDER } from '@/lib/task-costs'

export default function TaskDetailClient({ task: initialTask, userRole, userId, creatorName, isRestricted }: { task: any, userRole: string, userId: string, creatorName: string | null, currentUserName: string, isRestricted: boolean }) {
    const { t, locale } = useLanguage()

    // Parse member costs and payment status
    const getMemberCosts = (taskObj: any) => {
        if (!taskObj.memberCosts) return {}
        try {
            return typeof taskObj.memberCosts === 'string' ? JSON.parse(taskObj.memberCosts) : taskObj.memberCosts
        } catch (e) { console.error('[MEMBER_COSTS_PARSE_FAIL]', e); return {} }
    }
    const getMemberPaymentStatus = (taskObj: any) => {
        if (!taskObj.memberPaymentStatus) return {}
        try {
            return typeof taskObj.memberPaymentStatus === 'string' ? JSON.parse(taskObj.memberPaymentStatus) : taskObj.memberPaymentStatus
        } catch (e) { console.error('[MEMBER_PAYMENT_STATUS_PARSE_FAIL]', e); return {} }
    }
    const attachmentsOf = (src: any): any[] => Array.isArray(src.attachments) ? src.attachments : []
    const editFormFrom = (src: any) => ({
        title: src.title,
        // The name its title was picked as (CLIENTS_PLAN.md §5.5).
        titleEntryId: (src.titleEntryId ?? null) as string | null,
        description: src.description,
        assigneeIds: src.assignees?.map((a: any) => a.id) || [],
        deadline: src.deadline,
        difficulty: src.difficulty,
        clientId: src.clientId ?? '',
        locationId: src.locationId ?? '',
        attachments: attachmentsOf(src),
    })
    // Where it's done: its location as it is now, or, from before locations,
    // the text it was given.
    const placeOf = (src: any): { name: string; link: string; ofClient: boolean } => src.place
        ? {
            name: locationLabel(src.place.name, src.place.client?.name),
            link: src.place.latitude !== null && src.place.longitude !== null ? googleMapsLink(src.place.latitude, src.place.longitude) : '',
            ofClient: !!src.place.client,
        }
        : { ...parseTaskLocation(src.location || ''), ofClient: false }
    const [task, setTask] = useState(initialTask)
    const hasPaidCosts = task.paymentStatus === 'PAID' || Object.values(getMemberPaymentStatus(task) ?? {}).includes('PAID')

    // From the role the page passed down, so the first paint is complete.
    // Someone without tasks.view acts on a task only as one of its assignees.
    const { can, companyWide, scope } = useCan()
    const seesOthersTasks = can('tasks.view')
    const teamReach = scope('tasks.view') === 'TEAM'
    const canTransfer = can('tasks.transfer')
    const isOnTask = task.assignees?.some((a: any) => a.id === userId)
    // Editing, deleting and reviewing a task you are assigned to is refused to
    // a company-wide manager — that would be judging your own work (the
    // self-review and self-deletion rules in TaskService). A Team Leader
    // manages their team's tasks, their own among them.
    const mayManage = (permission: 'tasks.edit' | 'tasks.delete' | 'tasks.review') =>
        can(permission) && (scope(permission) === 'TEAM' || !isOnTask)
    const [existingAttachments, setExistingAttachments] = useState<any[]>(() => attachmentsOf(initialTask))
    const [note, setNote] = useState('')
    const [cost, setCost] = useState('')
    // A cost's name as typed, and the name it was picked as from the list (CLIENTS_PLAN.md §5).
    const [costName, setCostName] = useState<PickedName>({ text: '', entryId: null })
    // The next cost's receipt photo (CLIENTS_PLAN.md §6.2), and those already
    // uploaded, so a save tried again doesn't upload them again.
    const [costReceipt, setCostReceipt] = useState<File | null>(null)
    const uploadedReceipts = useRef(new Map<File, string>())
    const [location, setLocation] = useState('')
    const [locationStatus, setLocationStatus] = useState('')
    const [uploading, setUploading] = useState(false)
    const [loadingType, setLoadingType] = useState<'DRAFT' | 'SUBMIT' | null>(null)
    const [capturingLocation, setCapturingLocation] = useState(false)
    const [pendingFiles, setPendingFiles] = useState<File[]>([])
    const [costEntries, setCostEntries] = useState<any[]>([])
    const [transferAssigneeIds, setTransferAssigneeIds] = useState<string[]>([])
    const [isTransferModalOpen, setIsTransferModalOpen] = useState(false)
    const [allUsers, setAllUsers] = useState<any[]>([])
    const [userFetchError, setUserFetchError] = useState(false)
    const [transferring, setTransferring] = useState(false)
    const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
    const [showRevertConfirm, setShowRevertConfirm] = useState(false)
    const [isEditing, setIsEditing] = useState(false)
    const [editForm, setEditForm] = useState(() => editFormFrom(initialTask))
    const [editFieldErrors, setEditFieldErrors] = useState({ title: '', description: '', locationId: '' })
    const [isReviewModalOpen, setIsReviewModalOpen] = useState(false)
    const [reviewAction, setReviewAction] = useState<'APPROVED' | 'REJECTED' | null>(null)
    const [reviewDifficulty, setReviewDifficulty] = useState(initialTask.difficulty)
    const [submittingReview, setSubmittingReview] = useState(false)
    const [viewedTitleChange, setViewedTitleChange] = useState(false)
    const [viewedDescriptionChange, setViewedDescriptionChange] = useState(false)
    const [diffField, setDiffField] = useState<'title' | 'description' | null>(null)
    const [isEditedPersistent, setIsEditedPersistent] = useState(initialTask.isEdited)
    const [showSubmitConfirm, setShowSubmitConfirm] = useState(false)
    const [itemToDelete, setItemToDelete] = useState<{ type: 'ATTACHMENT' | 'COST' | 'COST_ADDITION' | 'SUBMISSION_NOTE', itemId: string } | null>(null)
    const [locationToDelete, setLocationToDelete] = useState<{ index?: number, date?: string } | null>(null)
    const [isReverting, setIsReverting] = useState(false)
    const [showDeadlineModal, setShowDeadlineModal] = useState(false)
    const action = useBusyAction()

    const router = useRouter()
    const searchParams = useSearchParams()
    const highlightId = searchParams.get('highlight')
    const shouldHighlight = highlightId === task.id
    const { showToast } = useToast() // Added this line

    // The userRole prop is already passed to the component, so no need to derive it from session here.
    // const userRole = (session?.user as any)?.role // Removed this line as userRole is a prop

    // Re-seed local state when the server sends a fresh task (after
    // router.refresh), in the same render rather than one render late.
    useAdjustOnChange([initialTask], () => {
        setTask(initialTask)
        setExistingAttachments(attachmentsOf(initialTask))
        setEditForm(editFormFrom(initialTask))
        setReviewDifficulty(initialTask.difficulty)
    })

    // What the most recent edit changed, for the "edited" badges and the diff
    // viewer. task.comments arrives already parsed (F-12: Json, not a
    // JSON-in-string column) — no JSON.parse needed anymore.
    const latestChanges: { title?: any, description?: any } | null = useMemo(() => {
        if (!Array.isArray(task.comments)) return null
        const lastEdit = [...task.comments].reverse().find((l: any) => l.type === 'TASK_EDITED')
        return lastEdit?.changes ?? null
    }, [task.comments])

    useEffect(() => {
        const isUserAssignee = task.assignees?.some((a: any) => a.id === userId)
        if (isUserAssignee && (task.isEdited || isEditedPersistent)) {
            // Logic to track if they've seen it could be here
        }
    }, [userId, task.assignees, task.isEdited, isEditedPersistent])

    // Load users once for search/filter efficiency
    const isOverdue = new Date(task.deadline) < new Date() && ['PENDING', 'IN_PROGRESS'].includes(task.status)

    useEffect(() => {
        const isUserAssignee = task.assignees?.some((a: any) => a.id === userId)
        const isRestrictedRole = !seesOthersTasks || (teamReach && isUserAssignee)

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
                    t('add_label') || 'add',
                    t('capture_location_button' as any) || 'capture',
                    t('save_draft_button' as any) || 'save draft',
                    t('upload_drag_files_msg' as any) || 'upload',
                    t('delete') || 'delete',
                    t('delete_location_title' as any) || 'delete location',
                    t('delete_note_title' as any) || 'delete note',
                    t('delete_cost_title' as any) || 'delete cost',
                    t('delete_attachment_title' as any) || 'delete attachment',
                    '×',
                    'x'
                ].some(keyword => {
                    const cleanKeyword = clean(keyword)
                    if (!cleanKeyword) return false

                    // Exact match for icons and the generic "Delete" to avoid blocking "Delete Task"
                    const isExactMatchKey = ['×', 'x', clean(t('delete') || 'delete')].includes(cleanKeyword)
                    if (isExactMatchKey) {
                        return targetText === cleanKeyword || targetTitle === cleanKeyword
                    }

                    // For more specific titles/phrases, use includes
                    return targetText.includes(cleanKeyword) || targetTitle.includes(cleanKeyword)
                })

                // Special robust check for file input and its immediate container
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
    }, [userRole, isOverdue, t, userId, task.assignees, seesOthersTasks, teamReach])

    useEffect(() => {
        if (canTransfer) {
            const queryParams = new URLSearchParams()
            queryParams.set('limit', '1000')
            if (task.companyId) queryParams.set('companyId', task.companyId)

            fetchRetrying(`/api/users?${queryParams.toString()}`)
                .then(r => {
                    if (!r.ok) throw new Error()
                    return r.json()
                })
                .then(result => {
                    const data = result.data
                    const usersList = data.data || []
                    // No filtering here any more — /api/users scopes a Team
                    // Leader to their own team server-side, so this list
                    // already matches what the server will accept on submit.
                    // Filtering in the browser decided what a picker showed,
                    // never what a request could contain; the rows it hid had
                    // already crossed the wire.
                    setAllUsers(usersList)
                })
                .catch(() => setUserFetchError(true))
        }
    }, [userRole, task.companyId, canTransfer])

    const handleDismiss = async () => {
        try {
            await fetch(`/api/tasks/${task.id}/dismiss-edit`, { method: 'POST' })
            setIsEditedPersistent(false)
            setTask({ ...task, isEdited: false })
            router.refresh()
        } catch (e) { console.error(e) }
    }

    const handleUpload = useCallback(async (isDraft: boolean, isEmergency?: boolean) => {
        if (uploading) return
        setUploading(true)
        setLoadingType(isDraft ? 'DRAFT' : 'SUBMIT')
        console.log('handleUpload started, isDraft:', isDraft)

        try {
            // Each cost's receipt, as a file of its own, first: one not
            // uploaded stops the save, rather than the cost saved without it.
            const costs: any[] = []
            for (const { receipt, ...entry } of costEntries) {
                let receiptUrl: string | null = receipt ? uploadedReceipts.current.get(receipt) ?? null : null
                if (receipt && !receiptUrl) {
                    const formData = new FormData()
                    formData.append('file', receipt)
                    formData.append('folder', RECEIPTS_FOLDER)
                    const res = await fetch('/api/upload', { method: 'POST', headers: isEmergency ? { 'X-Emergency-Save': 'true' } : undefined, body: formData }).catch(() => null)
                    const result = res?.ok ? await res.json().catch(() => null) : null
                    if (!result?.success || typeof result.data?.url !== 'string') throw new Error(t('cost_receipt_upload_failed'))
                    receiptUrl = result.data.url as string
                    uploadedReceipts.current.set(receipt, receiptUrl)
                }
                costs.push({ ...entry, receiptUrl })
            }

            const uploadedUrls: string[] = []
            if (pendingFiles.length > 0) {
                for (const file of pendingFiles) {
                    const formData = new FormData()
                    formData.append('file', file)
                    formData.append('taskId', task.id)

                    try {
                        const uploadRes = await fetch('/api/upload', {
                            method: 'POST',
                            // Emergency saves need this on the upload step too,
                            // not just the final submit PUT below — the server
                            // now exempts POST /api/upload the same way when
                            // this header is present (see lib/api-utils.ts),
                            // otherwise a suspended/banned user's attachment
                            // never makes it in even though their note does.
                            headers: isEmergency ? { 'X-Emergency-Save': 'true' } : undefined,
                            body: formData
                        })

                        if (uploadRes.ok) {
                            const result = await uploadRes.json()
                            const data = result.data
                            if (result.success && data.url) {
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

            const headers: any = { 'Content-Type': 'application/json' }
            if (isEmergency) {
                headers['X-Emergency-Save'] = 'true'
            }

            const res = await fetch(`/api/tasks/${task.id}/submit`, {
                method: 'PUT',
                body: JSON.stringify({
                    newAttachments: uploadedUrls,
                    note,
                    costs,
                    location,
                    isDraft
                }),
                headers
            })

            if (!res.ok) {
                if (res.status === 401) {
                    showToast(SESSION_EXPIRED_MESSAGE, 'error')
                    redirectAfterSessionExpiry(router)
                    return
                }
                const data = await res.json().catch(() => ({}))
                throw new Error(data.error || 'Submission failed')
            }

            // Clear form fields even for drafts to avoid duplication on next save
            setNote('')
            setCost('')
            setCostName({ text: '', entryId: null })
            setLocation('')
            setLocationStatus('')
            setPendingFiles([])
            setCostEntries([])
            setCostReceipt(null)
            uploadedReceipts.current.clear()

            showToast(isDraft ? t('draft_saved_success') : t('task_submitted_success'), 'success')
            router.refresh()
        } catch (error: any) {
            console.error('handleUpload error:', error)
            showToast(error.message || t('failed_save_generic') as any, 'error')
        } finally {
            setUploading(false)
            setLoadingType(null)
        }
    }, [uploading, pendingFiles, task.id, note, costEntries, location, showToast, t, router])


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
        setCostEntries(prev => [...prev, { amount: parseFloat(cost), description: costName.text, nameEntryId: costName.entryId, receipt: costReceipt }])
        setCost('')
        setCostName({ text: '', entryId: null })
        setCostReceipt(null)
    }

    // A photo or PDF the upload route takes, up to 4 MB.
    const handleCostReceipt = (files: File[]) => {
        const file = files[0]
        if (!file) return
        if (file.size > 4 * 1024 * 1024) {
            showToast(t('cost_receipt_too_large'), 'error')
            return
        }
        const ext = file.name.substring(file.name.lastIndexOf('.')).toLowerCase()
        if (!RECEIPT_ACCEPT.split(',').includes(ext)) {
            showToast(t('cost_receipt_wrong_type'), 'error')
            return
        }
        setCostReceipt(file)
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

    // Listen for suspension auto-save event
    useEffect(() => {
        const handleSuspendSave = async () => {
            console.log('Suspension detected, auto-saving task progress...')
            try {
                // Only auto-save if employee interaction is active and not already submitted or finalized
                const isUserAssignee = task.assignees?.some((a: any) => a.id === userId)
                if ((!seesOthersTasks || isUserAssignee) && !['PENDING_CONFIRMATION', 'APPROVED', 'COMPLETED', 'REJECTED'].includes(task.status)) {
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
    }, [task.status, userRole, userId, note, costEntries, location, task.assignees, handleUpload, seesOthersTasks])

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
            const comments = (Array.isArray(task.comments) ? task.comments : [])
            const userLocationCount = Array.isArray(comments) ? comments.filter((c: any) => c.type === 'LOCATION_ADDED' && c.authorId === userId).length : 0
            if (userLocationCount >= 10) {
                showToast(t('max_locations_error'), 'error')
                return
            }
        } catch (e) { console.error(e) }

        setCapturingLocation(true)
        setLocationStatus(t('capturing_location_button'))

        // Best-of-window rather than first-fix. Accuracy improves as the
        // receiver locks: getCurrentPosition took one shot, and with a ten
        // second timeout the satellite fix had usually not arrived, so the
        // browser handed back the coarse network position instead. The setting
        // that asked for precision and the setting that denied it time to
        // arrive were on the same line.
        //
        // watchPosition keeps the smallest accuracy seen, stops early once the
        // reading is good enough to be worth stopping for, and gives up at
        // WINDOW_MS with whatever it has — which is still better than the
        // single shot it replaces.
        const WINDOW_MS = 20000
        const GOOD_ENOUGH_METERS = 25

        let best: GeolocationPosition | null = null
        let settled = false
        let watchId: number | null = null
        let timer: ReturnType<typeof setTimeout> | null = null

        const stop = () => {
            if (watchId !== null) navigator.geolocation.clearWatch(watchId)
            if (timer !== null) clearTimeout(timer)
        }

        const finish = async () => {
            if (settled) return
            settled = true
            stop()
            if (!best) {
                setLocationStatus(t('location_failed_unavailable' as any))
                setCapturingLocation(false)
                return
            }
            await saveLocation(best)
        }

        watchId = navigator.geolocation.watchPosition(
            (pos) => {
                if (!best || pos.coords.accuracy < best.coords.accuracy) best = pos
                if (pos.coords.accuracy <= GOOD_ENOUGH_METERS) void finish()
            },
            (err) => {
                // Every failure used to render as "Failed to get location".
                // Someone who blocked the permission needs entirely different
                // advice from someone standing indoors waiting for a lock, and
                // err.code is what distinguishes them.
                if (err.code === err.PERMISSION_DENIED) {
                    settled = true
                    stop()
                    setLocationStatus(t('location_failed_denied' as any))
                    setCapturingLocation(false)
                    return
                }
                // POSITION_UNAVAILABLE and TIMEOUT are not final while the
                // window is open: a later reading may still arrive.
                if (!best && err.code === err.POSITION_UNAVAILABLE) {
                    setLocationStatus(t('location_searching' as any))
                }
            },
            { enableHighAccuracy: true, timeout: WINDOW_MS, maximumAge: 0 },
        )

        timer = setTimeout(() => { void finish() }, WINDOW_MS)
    }

    const saveLocation = async (pos: GeolocationPosition) => {

        const { latitude, longitude, accuracy } = pos.coords
        let locationName = ''

        // Reverse Geocoding via HERE API
        const apiKey = process.env.NEXT_PUBLIC_HERE_API_KEY
        if (apiKey) {
            try {
                const res = await fetch(`https://revgeocode.search.hereapi.com/v1/revgeocode?at=${latitude},${longitude}&apiKey=${apiKey}&lang=${locale === 'ar' ? 'ar' : 'en'}`)
                if (res.ok) {
                    const result = await res.json()
                    const data = result.data
                    if (data.items && data.items.length > 0) {
                        locationName = data.items[0].address.label
                    }
                }
            } catch (e) { console.error('Reverse geocode failed', e) }
        }

        // accuracy travels with the position and is kept permanently: it is
        // what lets a verdict be re-examined later rather than re-argued, and
        // what lets verification decline to guess at all.
        const locationString = JSON.stringify({ latitude, longitude, accuracy, address: locationName })
        setLocation(locationString)
        setLocationStatus(t('location_captured_saving'))

        try {
            const res = await fetch(`/api/tasks/${task.id}/submit`, {
                method: 'PUT',
                body: JSON.stringify({
                    note: '',
                    costEntries: [],
                    location: locationString,
                    locationName: locationName,
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
            if (!res.ok) {
                // Said as the server says it, such as a task whose costs were paid meanwhile.
                const body = await res.json().catch(() => null)
                showToast(body?.error || t('error_generic'), 'error')
                if (res.status === 409) router.refresh()
                return
            }
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
                if (res.status === 401) {
                    showToast(SESSION_EXPIRED_MESSAGE, 'error')
                    redirectAfterSessionExpiry(router)
                    return
                }
                const data = await res.json().catch(() => ({}))
                throw new Error(data.error || 'Transfer failed')
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
            const logs = (Array.isArray(task.comments) ? task.comments : [])
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
            titleEntryId: task.titleEntryId ?? null,
            description: task.description,
            assigneeIds: task.assignees?.map((a: any) => a.id) || [],
            deadline: task.deadline,
            difficulty: task.difficulty,
            clientId: task.clientId ?? '',
            locationId: task.locationId ?? '',
            attachments: existingAttachments
        })
        setIsEditing(true)
    }

    const handleSaveDetails = async (e: React.FormEvent) => {
        e.preventDefault()
        let hasError = false
        const errors = { title: '', description: '', locationId: '' }

        if (!editForm.title.trim()) {
            errors.title = t('title_required')
            hasError = true
        }
        if (!editForm.description.trim()) {
            errors.description = t('description_required')
            hasError = true
        }

        // A new client leaves the task without its old client's location:
        // another is picked (CLIENTS_PLAN.md §2.3). A task from before
        // locations keeps its text until one is.
        const clientChanged = editForm.clientId !== (task.clientId ?? '')
        if (clientChanged && !editForm.locationId && task.locationId) {
            errors.locationId = t('task_location_required')
            hasError = true
        }

        if (hasError) {
            setEditFieldErrors(errors)
            return
        }

        try {
            const { clientId, locationId, titleEntryId, ...details } = editForm
            // The name its title is picked as, sent when the title or it changes.
            const titleChanged = editForm.title !== task.title || titleEntryId !== (task.titleEntryId ?? null)
            const res = await fetch(`/api/tasks/${task.id}/details`, {
                method: 'PUT',
                body: JSON.stringify({
                    ...details,
                    ...(titleChanged ? { titleEntryId } : {}),
                    ...(clientChanged ? { clientId: clientId || null } : {}),
                    ...(locationId && locationId !== task.locationId ? { locationId } : {}),
                }),
                headers: { 'Content-Type': 'application/json' }
            })
            if (!res.ok) {
                if (res.status === 401) {
                    showToast(SESSION_EXPIRED_MESSAGE, 'error')
                    redirectAfterSessionExpiry(router)
                    return
                }
                const data = await res.json().catch(() => ({}))
                throw new Error(data.error || 'Update failed')
            }
            showToast(t('task_details_updated_success'), 'success')
            setIsEditing(false)
            router.refresh()
        } catch (e: any) {
            console.error(e)
            showToast(e.message || t('failed_update_task'), 'error')
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
                if (res.status === 401) {
                    showToast(SESSION_EXPIRED_MESSAGE, 'error')
                    redirectAfterSessionExpiry(router)
                    return
                }
                const data = await res.json().catch(() => ({}))
                throw new Error(data.error || 'Revert failed')
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

    const handleDeleteItem = (type: 'ATTACHMENT' | 'COST' | 'COST_ADDITION' | 'SUBMISSION_NOTE', itemId: string) => {
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

            if (!res.ok) {
                // Why, when the server says: a cost already paid stays.
                const body = await res.json().catch(() => null)
                showToast(body?.error || t('error_generic'), 'error')
                // Refused for good: pressing Delete again can't change it, so
                // the window closes and the page shows the task as it is now.
                if (res.status === 409) { setItemToDelete(null); router.refresh() }
                return
            }
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
        <div className={`card ${shouldHighlight ? 'highlight-shading' : ''}`} style={{
            ...containerStyle,
            background: isOverdue ? 'var(--danger-bg-tint)' : (shouldHighlight ? undefined : 'var(--surface)'),
            borderColor: isOverdue ? 'var(--danger-border)' : undefined
        }}>
            {/* Deleted Assignee Alert - Check            {/* Deleted Assignee Alert */}
            {task.assignees?.some((a: any) => a.status === 'DELETED') && canTransfer && !['COMPLETED', 'APPROVED', 'REJECTED'].includes(task.status) && (
                <div style={{ ...alertStyle, background: 'var(--danger-bg)', border: '1px solid var(--danger-solid)', color: 'var(--danger-fg)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexDirection: 'row' }}>
                        <span aria-hidden="true" style={{ fontSize: '1.5rem' }}>🚫</span>
                        <div style={{ textAlign: locale === 'ar' ? 'right' : 'left' }}>
                            <strong>{t('assignee_deleted_alert')}</strong>
                            <p style={{ margin: 0, fontSize: '0.9rem' }}>
                                {t('assignee_deleted_msg').replace('{name}', task.assignees.filter((a: any) => a.status === 'DELETED').map((a: any) => `${a.firstName} ${a.lastName}`).join(', '))}
                            </p>
                        </div>
                    </div>
                </div>
            )}

            {/* Task Edited Alert */}
            {task.isEdited && (!seesOthersTasks || isOnTask) && (
                <div style={{ ...alertStyle, background: 'var(--warn-bg-warm-subtle)', border: '1px solid var(--warn-border-warm-firm)', color: 'var(--warn-fg-warm)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexDirection: 'row' }}>
                        <span aria-hidden="true" style={{ fontSize: '1.5rem' }}>⚠️</span>
                        <div style={{ textAlign: locale === 'ar' ? 'right' : 'left' }}>
                            <strong>{t('task_updated_alert')}</strong>
                            <p style={{ margin: 0, fontSize: '0.9rem' }}>
                                {t('task_updated_msg').replace('{author}', (() => {
                                    try {
                                        const logs = (Array.isArray(task.comments) ? task.comments : [])
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
                    <button onClick={() => action.run('dismiss', handleDismiss)} disabled={action.running} aria-busy={action.is('dismiss')} className="btn" style={{ background: 'var(--warn-bg-warm)', color: 'var(--warn-fg-warm)', border: '1px solid var(--warn-border-warm-firm)' }}>{t('i_understand_button')}</button>
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
                        {(task.isEdited || isEditedPersistent) && task.assignees?.some((a: any) => a.id === userId) && latestChanges?.title && !viewedTitleChange && (
                            <button onClick={() => { setDiffField('title'); setViewedTitleChange(true); }} style={{ background: 'var(--warn-bg-warm)', color: 'var(--warn-fg-warm)', border: '1px solid var(--warn-border-warm-firm)', borderRadius: '0.25rem', padding: '0.25rem 0.5rem', fontSize: '0.75rem', cursor: 'pointer', fontWeight: 'bold' }}>{t('edit')}</button>
                        )}
                    </div>
                    <span style={{ padding: '0.25rem 0.75rem', borderRadius: '9999px', background: 'var(--info-fill)', color: 'var(--text-on-accent)', fontWeight: 'bold', fontSize: '0.9rem' }}>{task.difficulty} {t('points_label_plural')}</span>
                    <span style={{
                        padding: '0.5rem',
                        borderRadius: '0.5rem',
                        background: task.status === 'COMPLETED' ? 'var(--info-bg)' : task.status === 'APPROVED' ? 'var(--ok-bg)' : task.status === 'PENDING_CONFIRMATION' ? 'var(--warn-bg-yellow)' : task.status === 'REJECTED' ? 'var(--danger-bg)' : 'var(--border)',
                        color: task.status === 'COMPLETED' ? 'var(--info-fg)' : task.status === 'APPROVED' ? 'var(--ok-fg)' : task.status === 'PENDING_CONFIRMATION' ? 'var(--warn-fg-yellow)' : task.status === 'REJECTED' ? 'var(--danger-fg)' : 'var(--text-strong)',
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
                    {task.totalCost !== undefined && task.totalCost > 0 && (task.status === 'APPROVED' || task.status === 'COMPLETED') && (
                        <span style={{ padding: '0.5rem', borderRadius: '0.5rem', background: task.paymentStatus === 'PAID' ? 'var(--ok-bg-faint)' : 'var(--warn-border-warm)', color: task.paymentStatus === 'PAID' ? 'var(--ok-fg-deep)' : 'var(--warn-fg-warm)', fontSize: '0.875rem', fontWeight: '600' }}>
                            {task.paymentStatus === 'PAID' ? t('paid_status') : t('pending_payment_status')}
                        </span>
                    )}
                </div>
                <div style={{ display: 'flex', gap: '0.5rem', flexDirection: 'row' }}>
                    {task.totalCost !== undefined && task.totalCost > 0 && (task.status === 'APPROVED' || task.status === 'COMPLETED') && companyWide('tasks.pay') && (
                        <button onClick={() => handlePaymentStatusChange(task.paymentStatus === 'PAID' ? 'PENDING_PAYMENT' : 'PAID')} style={{ background: task.paymentStatus === 'PAID' ? 'var(--warn-border-warm)' : 'var(--ok-bg-faint)', color: task.paymentStatus === 'PAID' ? 'var(--warn-fg-warm)' : 'var(--ok-fg-deep)', border: 'none', borderRadius: '0.25rem', padding: '0.5rem 1rem', cursor: 'pointer', fontSize: '0.875rem', fontWeight: '600' }}>
                            {task.paymentStatus === 'PAID' ? t('mark_as_pending_button') : t('mark_as_paid')}
                        </button>
                    )}
                    {userRole === 'SUPER_ADMIN' && ['APPROVED', 'COMPLETED', 'REJECTED', 'PENDING_CONFIRMATION'].includes(task.status) && task.paymentStatus === 'PENDING_PAYMENT' && (
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
                    <button onClick={() => { startNavigationProgress(); router.back() }} style={{ background: 'none', border: '1px solid var(--border-firm)', borderRadius: '0.25rem', padding: '0.5rem 1rem', cursor: 'pointer', color: 'var(--text-soft)' }}>{t('close_button')}</button>
                    {!isRestricted && ['PENDING', 'IN_PROGRESS'].includes(task.status) && mayManage('tasks.edit') && (<button onClick={handleEditClick} style={{ background: 'var(--info-bg)', color: 'var(--info-fg)', border: 'none', borderRadius: '0.25rem', padding: '0.5rem 1rem', cursor: 'pointer' }}>{t('edit_task_button')}</button>)}
                    {/* A task whose costs are paid, in full or in part, stays (CLIENTS_PLAN.md §4.2). */}
                    {!isRestricted && mayManage('tasks.delete') && !hasPaidCosts && (<button onClick={() => setShowDeleteConfirm(true)} style={{ background: 'var(--danger-bg)', color: 'var(--danger-fg)', border: 'none', borderRadius: '0.25rem', padding: '0.5rem 1rem', cursor: 'pointer' }}>{t('delete_task_button')}</button>)}
                </div>
            </div>

            <div style={{ fontSize: '1.25rem', lineHeight: '1.6', color: 'var(--text-body)', marginBottom: '2.5rem', whiteSpace: 'pre-wrap' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
                    {task.description}
                    {(task.isEdited || isEditedPersistent) && task.assignees?.some((a: any) => a.id === userId) && latestChanges?.description && !viewedDescriptionChange && (
                        <button onClick={() => { setDiffField('description'); setViewedDescriptionChange(true); }} style={{ background: 'var(--warn-bg-warm)', color: 'var(--warn-fg-warm)', border: '1px solid var(--warn-border-warm-firm)', borderRadius: '0.25rem', padding: '0.1rem 0.5rem', fontSize: '0.7rem', cursor: 'pointer', fontWeight: 'bold' }}>{t('edit')}</button>
                    )}
                </div>
            </div>
            {(task.place || task.location) && (() => {
                const { name, link, ofClient } = placeOf(task)
                return (
                    <div style={{ marginTop: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--info-fg)', fontSize: '0.95rem', fontWeight: '500' }}>
                        <span aria-hidden="true">📍</span>
                        {link ? (
                            <a href={link} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--info-fg)', textDecoration: 'underline' }}>
                                {name || link}
                            </a>
                        ) : (
                            <span>{name}</span>
                        )}
                        {/* A client's location is named with its client already. */}
                        {(task as any).client?.name && !ofClient && (
                            <span style={{ color: 'var(--text-faint)', fontWeight: '400' }}>
                                — {t('client_via_label' as any) || 'via'} {(task as any).client.name}
                            </span>
                        )}
                    </div>
                )
            })()}

            <div style={{ marginTop: '1rem', color: 'var(--text-soft)', fontSize: '0.9rem' }}>
                {t('assigned_by')}: <strong>{creatorName || t('role_super_admin')}</strong> | {t('deadline_label')}: <strong><SafeDate date={task.deadline} locale={locale} /></strong>
            </div>
            <div style={{ marginTop: '0.5rem', color: 'var(--text-soft)', fontSize: '0.9rem' }}>
                {t('assignee_label')}: {task.assignees?.length > 0 ? (
                    task.assignees.map((a: any, idx: number) => (
                        <span key={a.id}>
                            <strong>{a.firstName} {a.lastName}</strong>
                            {idx < task.assignees.length - 1 ? ', ' : ''}
                        </span>
                    ))
                ) : (
                    <strong>{t('no_assignee')}</strong>
                )}
            </div>

            {/* Comments / Logs Section */}
            <SectionBoundary name="TaskCommentsLog">
                <TaskCommentsLog
                    task={task}
                    userId={userId}
                    onDeleteNote={(date: string) => handleDeleteItem('SUBMISSION_NOTE', date)}
                />
            </SectionBoundary>

            {/* Attachments Section */}
            <div style={{ marginTop: '2rem', borderTop: '1px solid var(--border)', paddingTop: '1.5rem' }}>
                <h3 style={{ marginBottom: '1rem' }}>{t('attachments_optional_label').split(' ')[0]}</h3>
                {existingAttachments.length > 0 ? (
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(220px, 100%), 1fr))', gap: '1rem' }}>
                        {existingAttachments.map((att: any, idx: number) => (
                            <div key={idx} style={{ position: 'relative' }}>
                                <a href={att.url} target="_blank" rel="noopener noreferrer" style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.75rem', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '0.5rem', textDecoration: 'none', color: 'var(--text-body)', transition: 'all 0.2s', flexDirection: 'row' }}>
                                    <span aria-hidden="true" style={{ fontSize: '1.5rem' }}>📄</span>
                                    <div style={{ overflow: 'hidden', textAlign: locale === 'ar' ? 'right' : 'left' }}>
                                        <div style={{ fontSize: '0.9rem', fontWeight: '500', textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>{att.name || t('attachment')}</div>
                                        <div style={{ fontSize: '0.7rem', color: 'var(--text-soft)' }}>
                                            {(task.assignees?.length > 1) && (
                                                <span style={{ background: 'var(--surface-sunk)', border: '1px solid var(--border-firm)', color: 'var(--text-muted)', padding: '0.05rem 0.3rem', borderRadius: '1rem', fontSize: '0.6rem', fontWeight: 'bold', marginRight: locale === 'ar' ? '0' : '0.25rem', marginLeft: locale === 'ar' ? '0.25rem' : '0' }}>
                                                    {locale === 'ar' ? 'بواسطة:' : 'By:'} {att.uploadedBy}
                                                </span>
                                            )}
                                            {!((task.assignees?.length > 1)) && <span>{att.uploadedBy}</span>}
                                            <span> • <SafeDate date={att.uploadedAt} locale={locale} format="dateOnly" /></span>
                                        </div>
                                    </div>
                                </a>
                                {task.status === 'IN_PROGRESS' && (att.uploadedById === userId || can('tasks.edit')) && (
                                    <button aria-label={t('delete_attachment_title')}
                                        onClick={(e) => { e.preventDefault(); handleDeleteItem('ATTACHMENT', att.url); }}
                                        style={{ position: 'absolute', top: '5px', right: locale === 'ar' ? 'auto' : '5px', left: locale === 'ar' ? '5px' : 'auto', background: 'var(--surface)', border: '1px solid var(--danger-bg)', borderRadius: '50%', padding: '4px', cursor: 'pointer', display: 'flex' }}
                                        title={t('delete_attachment_title')}
                                    >
                                        <TrashIcon size={14} />
                                    </button>
                                )}
                            </div>
                        ))}
                    </div>
                ) : (
                    <p style={{ color: 'var(--text-soft)', fontStyle: 'italic' }}>{t('no_attachments_msg')}</p>
                )}
            </div>

            {/* Costs Section */}
            <TaskCostsSection
                task={task}
                userId={userId}
                onDeleteItem={handleDeleteItem}
                onPaymentStatusChange={handlePaymentStatusChange}
                getMemberCosts={getMemberCosts}
                getMemberPaymentStatus={getMemberPaymentStatus}
            />

            {
                !isRestricted && (
                    <>
                        {/* Location History Section */}
                        <TaskLocationHistorySection
                            task={task}
                            setTask={setTask}
                            userId={userId}
                            setLocationToDelete={setLocationToDelete}
                        />

                        {/* Submission Section (Employee only) */}
                        {(!seesOthersTasks || isOnTask) && !['APPROVED', 'COMPLETED', 'PENDING_CONFIRMATION', 'REJECTED'].includes(task.status) && (
                            <TaskSubmissionForm
                                pendingFiles={pendingFiles}
                                onAddFiles={handleFiles}
                                onRemoveFile={removePendingFile}
                                uploading={uploading}
                                costName={costName}
                                setCostName={setCostName}
                                companyId={task.companyId}
                                cost={cost}
                                setCost={setCost}
                                onAddCost={handleAddCost}
                                costReceipt={costReceipt}
                                onCostReceipt={handleCostReceipt}
                                onClearCostReceipt={() => setCostReceipt(null)}
                                costEntries={costEntries}
                                onRemoveCostEntry={removeCostEntry}
                                note={note}
                                setNote={setNote}
                                capturingLocation={capturingLocation}
                                locationStatus={locationStatus}
                                onCaptureLocation={handleCaptureLocation}
                                onSaveDraft={() => handleUpload(true)}
                                onSubmitRequest={handleUploadRequest}
                                loadingType={loadingType}
                            />
                        )}

                        {/* Finalized/Pending Message for Employees */}
                        {(!seesOthersTasks || isOnTask) && ['PENDING_CONFIRMATION', 'APPROVED', 'COMPLETED', 'REJECTED'].includes(task.status) && (
                            <div style={{ marginTop: '2rem', padding: '1.5rem', background: 'var(--surface-subtle)', border: '1px solid var(--border)', borderRadius: '0.5rem', textAlign: 'center' }}>
                                <p style={{ margin: 0, color: 'var(--text-muted)', fontWeight: '500' }}>
                                    {task.status === 'PENDING_CONFIRMATION'
                                        ? t('pending_confirmation_msg' as any) || "Submitted and awaiting review"
                                        : t('task_finalized_msg' as any) || "This task has been finalized and cannot be modified."}
                                </p>
                            </div>
                        )}

                        {/* Transfer Button (Admins only) */}
                        {canTransfer && ['IN_PROGRESS', 'PENDING'].includes(task.status) && (
                            <div style={{ marginTop: '2rem', textAlign: locale === 'ar' ? 'left' : 'right' }}>
                                <button
                                    onClick={() => {
                                        const currentIds = task.assignees?.map((a: any) => a.id) || []
                                        setTransferAssigneeIds(currentIds)
                                        setIsTransferModalOpen(true)
                                    }}
                                    className="btn"
                                    style={{
                                        background: 'var(--surface-subtle)',
                                        color: 'var(--text-muted)',
                                        border: '1px solid var(--border-firm)',
                                        borderRadius: '0.5rem',
                                        padding: '0.6rem 1.25rem',
                                        fontSize: '0.875rem',
                                        fontWeight: '600',
                                        display: 'inline-flex',
                                        alignItems: 'center',
                                        gap: '0.5rem',
                                        boxShadow: '0 1px 2px var(--shadow-faint)',
                                        transition: 'all 0.2s ease',
                                        cursor: 'pointer'
                                    }}
                                >
                                    <span aria-hidden="true">🔄</span> {t('transfer_to_another_employee')}
                                </button>
                            </div>
                        )}

                        {/* Approve/Reject Buttons (Admins only) */}
                        {mayManage('tasks.review') && task.status === 'PENDING_CONFIRMATION' && (
                            <div style={{ marginTop: '2.5rem', display: 'flex', gap: '1.25rem', borderTop: '2px solid var(--border)', paddingTop: '2rem', flexDirection: 'row' }}>
                                <button onClick={handleApprove} className="btn btn-primary" style={{ flex: 1, padding: '1rem', fontSize: '1.1rem', fontWeight: '700' }}>{t('approve_button')}</button>
                                <button onClick={handleReject} className="btn" style={{ flex: 1, padding: '1rem', fontSize: '1.1rem', fontWeight: '700', background: 'var(--danger-fill)', color: 'var(--text-on-accent)' }}>{t('reject_button')}</button>
                            </div>
                        )}
                    </>
                )
            }

            {/* Modals */}

            <TaskEditDetailsModal
                isOpen={isEditing}
                onClose={() => setIsEditing(false)}
                onSubmit={handleSaveDetails}
                editForm={editForm}
                setEditForm={setEditForm}
                editFieldErrors={editFieldErrors}
                setEditFieldErrors={setEditFieldErrors}
                task={task}
            />

            <TaskTransferModal
                isOpen={isTransferModalOpen}
                onClose={() => setIsTransferModalOpen(false)}
                allUsers={allUsers}
                userFetchError={userFetchError}
                transferAssigneeIds={transferAssigneeIds}
                setTransferAssigneeIds={setTransferAssigneeIds}
                transferring={transferring}
                onTransfer={handleTransfer}
            />

            <TaskConfirmModals
                showDeleteConfirm={showDeleteConfirm}
                setShowDeleteConfirm={setShowDeleteConfirm}
                onDelete={handleDelete}

                isReviewModalOpen={isReviewModalOpen}
                setIsReviewModalOpen={setIsReviewModalOpen}
                reviewAction={reviewAction}
                isTransferredTask={isTransferredTask}
                reviewDifficulty={reviewDifficulty}
                setReviewDifficulty={setReviewDifficulty}
                submittingReview={submittingReview}
                onSubmitReview={() => submitReview()}

                showSubmitConfirm={showSubmitConfirm}
                setShowSubmitConfirm={setShowSubmitConfirm}
                onConfirmSubmit={() => handleUpload(false)}

                itemToDelete={itemToDelete}
                setItemToDelete={setItemToDelete}
                onConfirmDeleteItem={confirmDeleteItem}

                locationToDelete={locationToDelete}
                setLocationToDelete={setLocationToDelete}
                onConfirmDeleteLocation={confirmDeleteLocation}

                showRevertConfirm={showRevertConfirm}
                setShowRevertConfirm={setShowRevertConfirm}
                onRevert={handleRevert}
                isReverting={isReverting}

                showDeadlineModal={showDeadlineModal}
                setShowDeadlineModal={setShowDeadlineModal}
            />


        </div>
    )
}

/**
 * The comments and notes on a task — everything in its log that is not a cost
 * or a location, which have sections of their own.
 *
 * Extracted from an inline IIFE that wrapped its JSX in try/catch. That caught
 * errors in the expressions here but not in child components, and reported
 * nothing; the SectionBoundary around this does both, and a malformed log
 * still costs only this section rather than the page.
 */
function TaskCommentsLog({ task, userId, onDeleteNote }: {
    task: any
    userId: string
    onDeleteNote: (date: string) => void
}) {
    const { t, locale } = useLanguage()
    const canEditTask = useCan().can('tasks.edit')
    if (!task.comments) return null
    const logs = Array.isArray(task.comments) ? task.comments : []
    const regularLogs = logs.filter((l: any) => l.type !== 'COST_ADDITION' && l.type !== 'LOCATION_ADDED')
    if (regularLogs.length === 0) return null

    return (
                <div style={{ marginTop: '2rem', borderTop: '1px solid var(--border)', paddingTop: '1.5rem' }}>
                    <h3 style={{ marginBottom: '1rem' }}>{t('comments_notes_title')}</h3>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                        {[...regularLogs].reverse().map((log: any, i: number) => (
                            <div key={i} style={{ padding: '1rem', background: 'var(--surface-subtle)', borderRadius: '0.5rem', border: '1px solid var(--border)' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem', flexDirection: 'row' }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                        {(task.assignees?.length > 1) && (
                                            <span style={{ background: 'var(--surface-sunk)', border: '1px solid var(--border-firm)', color: 'var(--text-muted)', padding: '0.1rem 0.4rem', borderRadius: '1rem', fontSize: '0.65rem', fontWeight: 'bold' }}>
                                                {locale === 'ar' ? 'بواسطة:' : 'By:'} {log.author}
                                            </span>
                                        )}
                                        {!((task.assignees?.length > 1)) && <span style={{ fontWeight: 'bold', color: 'var(--text-main)' }}>{log.author}</span>}
                                        {log.type === 'SUBMISSION_NOTE' && task.status === 'IN_PROGRESS' && (log.authorId === userId || canEditTask) && (
                                            <button aria-label={t('delete_note_title')} onClick={() => onDeleteNote(log.date)} className="btn-icon" style={{ padding: '2px', border: 'none', background: 'none', cursor: 'pointer', display: 'flex' }} title={t('delete_note_title')}>
                                                <TrashIcon size={14} />
                                            </button>
                                        )}
                                    </div>
                                    <span style={{ fontSize: '0.75rem', color: 'var(--text-soft)' }}><SafeDate date={log.date || log.createdAt} locale={locale} /></span>
                                </div>
                                <p style={{ margin: 0, fontSize: '0.95rem', color: 'var(--text-body)', whiteSpace: 'pre-wrap' }}>{log.text}</p>
                            </div>
                        ))}
                    </div>
                </div>
    )
}

'use client'
import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowCounterClockwiseIcon, CheckIcon, CheckSquareIcon, CurrencyCircleDollarIcon, PencilSimpleIcon, TrashIcon, UserSwitchIcon, XIcon } from '@phosphor-icons/react/ssr'
// Its dates once the browser has the page: drawn on the server, they came out in its time zone.
import SafeDate from '@/components/SafeDate'
import DiffViewer from '@/components/DiffViewer'
import { useToast } from '@/context/ToastContext'
import { useLanguage } from '@/context/LanguageContext'
import TaskCostsSection from '@/components/TaskCostsSection'
import TaskLocationHistorySection from '@/components/TaskLocationHistorySection'
import TaskSubmissionForm from '@/components/TaskSubmissionForm'
import TaskEditDetailsModal from '@/components/TaskEditDetailsModal'
import TaskTransferModal from '@/components/TaskTransferModal'
import TaskConfirmModals from '@/components/TaskConfirmModals'
import type { Assignable } from '@/components/forms/AssigneeChecklist'
import { Button, Card, Details, Dialog, DueDate, EmptyState, FileChip, FileChips, Page, PageHeader, RowMenu, StatusBadge, taskStatusTone, type MenuItem, type PickedName } from '@/components/ui'
import { SESSION_EXPIRED_MESSAGE, redirectAfterSessionExpiry } from '@/lib/session-expired'
import SectionBoundary from '@/components/SectionBoundary'
import { useAdjustOnChange } from '@/lib/useAdjustOnChange'
import { useCan } from '@/lib/useCan'
import { useModules } from '@/lib/useModules'
import { useBusyAction } from '@/lib/useBusyAction'
import { useDeadlineClock } from '@/lib/useDeadlineClock'
import { fetchRetrying } from '@/lib/swr-fetcher'
import { decidedByName } from '@/lib/decided-by'
import { countOf } from '@/lib/plural'
import { locationLabel } from '@/lib/locations'
import { parseTaskLocation } from '@/lib/task-place'
import { googleMapsLink } from '@/lib/attendance/geo'
import { RECEIPT_ACCEPT, RECEIPTS_FOLDER } from '@/lib/task-costs'
import type { TranslationKey } from '@/lib/translations'

/** Done with: decided, and nothing more is handed in. */
const DECIDED = ['APPROVED', 'COMPLETED', 'REJECTED']

/** An address that isn't a task, or no longer is: said on a page with the way back. */
export function TaskNotFound() {
    const { t } = useLanguage()
    const modules = useModules()
    return (
        <Page>
            <PageHeader title={modules.label('tasks')} back={{ href: '/dashboard/tasks', label: modules.label('tasks') }} />
            <div className="ui-panel">
                <EmptyState icon={CheckSquareIcon} title={t('task_not_found')} />
            </div>
        </Page>
    )
}

/**
 * A task's page (DESIGN.md §5.5): its header, with its status and a manager's
 * decision; what needs saying about it; its details, notes and files; then
 * its costs, location history and what its assignee hands in.
 */
export default function TaskDetailClient({ task: initialTask, now, userRole, userId, creatorName, isRestricted }: {
    task: any
    /** When the server drew it, so its deadline reads the same on the server and here. */
    now: number
    userRole: string
    userId: string
    creatorName: string | null
    currentUserName: string
    isRestricted: boolean
}) {
    const { t, locale } = useLanguage()
    const modules = useModules()

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
    const action = useBusyAction()

    const router = useRouter()
    const { showToast } = useToast()

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

    // Past its deadline and not yet done. Moved on at the deadline, so a page
    // left open across it locks then (lib/useDeadlineClock.ts).
    const deadlineAt = new Date(task.deadline).getTime()
    const clock = useDeadlineClock(deadlineAt, now)
    const isOverdue = deadlineAt < clock && ['PENDING', 'IN_PROGRESS'].includes(task.status)
    // Past it, whoever does it adds nothing more to it and takes nothing off
    // it, and is told to see whoever assigned it. Each block is told so, rather
    // than a click anywhere on the page caught by the words on what was clicked.
    const isUserAssignee = task.assignees?.some((a: any) => a.id === userId)
    const isRestrictedRole = !seesOthersTasks || (teamReach && isUserAssignee)
    const locked = isRestrictedRole && isOverdue

    // Who it can be moved to, asked for when Transfer opens: undefined while
    // they load, null if they couldn't be. /api/users scopes a Team Leader to
    // their own team, so it's already who the server will accept.
    const [transferPeople, setTransferPeople] = useState<Assignable[] | null | undefined>(undefined)
    const [peopleTries, setPeopleTries] = useState(0)
    const [retryingPeople, setRetryingPeople] = useState(false)
    useEffect(() => {
        if (!isTransferModalOpen) return
        const queryParams = new URLSearchParams()
        queryParams.set('limit', '1000')
        if (task.companyId) queryParams.set('companyId', task.companyId)
        fetchRetrying(`/api/users?${queryParams.toString()}`)
            .then(r => {
                if (!r.ok) throw new Error(`Couldn't load the people (${r.status})`)
                return r.json()
            })
            .then(result => setTransferPeople(result?.data?.data || []))
            .catch(() => setTransferPeople(null))
            .finally(() => setRetryingPeople(false))
    }, [isTransferModalOpen, peopleTries, task.companyId])
    const openTransfer = () => {
        setTransferAssigneeIds(task.assignees?.map((a: any) => a.id) || [])
        setIsTransferModalOpen(true)
    }

    // Whoever it's for has seen how it changed: recorded, so the notice
    // stays gone. Not recorded, it stays, and says why.
    const handleDismiss = async () => {
        try {
            const res = await fetch(`/api/tasks/${task.id}/acknowledge`, { method: 'PUT' })
            if (!res.ok) {
                const data = await res.json().catch(() => ({}))
                showToast(data.error || t('error_generic'), 'error')
                return
            }
            setIsEditedPersistent(false)
            setTask({ ...task, isEdited: false })
            router.refresh()
        } catch (e) {
            console.error(e)
            showToast(t('error_generic'), 'error')
        }
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
                setShowDeleteConfirm(false)
                if (res.status === 409) router.refresh()
                return
            }
            showToast(t('task_deleted_success'), 'success')
            router.push('/dashboard/tasks')
            router.refresh()
        } catch (e) {
            console.error(e)
            showToast(t('error_generic'), 'error')
            setShowDeleteConfirm(false)
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
            setShowRevertConfirm(false)
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

    const decidedBy = DECIDED.includes(task.status) && task.lastStatusUpdateBy
        ? t('list_status_by').replace('{name}', decidedByName(task.lastStatusUpdateBy))
        : undefined
    // Its costs, once it's done, are paid or waiting to be.
    const owesCosts = task.totalCost !== undefined && task.totalCost > 0 && (task.status === 'APPROVED' || task.status === 'COMPLETED')
    const deleted = (task.assignees ?? []).filter((a: any) => a.status === 'DELETED')
    const names = (task.assignees ?? []).map((a: any) => `${a.firstName} ${a.lastName}`)
    const reviewing = !isRestricted && mayManage('tasks.review') && task.status === 'PENDING_CONFIRMATION'
    const editable = !isRestricted && ['PENDING', 'IN_PROGRESS'].includes(task.status) && mayManage('tasks.edit')
    const transferable = !isRestricted && canTransfer && ['IN_PROGRESS', 'PENDING'].includes(task.status)
    // What the last edit changed, for whoever it's for to see.
    const seesChanges = (task.isEdited || isEditedPersistent) && isOnTask
    const editedBy = [...(Array.isArray(task.comments) ? task.comments : [])].reverse().find((l: any) => l.type === 'TASK_EDITED')?.author || t('an_admin')
    const place = (task.place || task.location) ? placeOf(task) : null

    const menu: MenuItem[] = [
        ...(transferable ? [{ key: 'transfer', icon: UserSwitchIcon, label: t('transfer_to_another_employee'), onSelect: openTransfer }] : []),
        ...(owesCosts && companyWide('tasks.pay') && (task.paymentStatus === 'PAID' || task.paymentStatus === 'PENDING_PAYMENT')
            ? [{ key: 'pay', icon: CurrencyCircleDollarIcon, label: task.paymentStatus === 'PAID' ? t('mark_as_pending_button') : t('mark_as_paid'), onSelect: () => { void handlePaymentStatusChange(task.paymentStatus === 'PAID' ? 'PENDING_PAYMENT' : 'PAID') } }]
            : []),
        ...(userRole === 'SUPER_ADMIN' && ['APPROVED', 'COMPLETED', 'REJECTED', 'PENDING_CONFIRMATION'].includes(task.status) && task.paymentStatus === 'PENDING_PAYMENT'
            ? [{ key: 'revert', icon: ArrowCounterClockwiseIcon, label: t('return_to_in_progress'), onSelect: () => setShowRevertConfirm(true) }]
            : []),
        // A task whose costs are paid, in full or in part, stays (CLIENTS_PLAN.md §4.2).
        ...(!isRestricted && mayManage('tasks.delete') && !hasPaidCosts
            ? [{ key: 'delete', icon: TrashIcon, label: t('delete_task_button'), danger: true, onSelect: () => setShowDeleteConfirm(true) }]
            : []),
    ]

    return (
        <Page>
            <PageHeader
                title={(
                    <span className="ui-title-with-badge">
                        <bdi>{task.title}</bdi>
                        <StatusBadge tone={taskStatusTone(task.status)}>{t(`status_${task.status.toLowerCase()}` as TranslationKey)}</StatusBadge>
                        {owesCosts && (
                            <StatusBadge tone={task.paymentStatus === 'PAID' ? 'good' : 'waiting'}>{task.paymentStatus === 'PAID' ? t('task_payment_paid') : t('task_payment_pending')}</StatusBadge>
                        )}
                    </span>
                )}
                subtitle={decidedBy}
                back={{ href: '/dashboard/tasks', label: modules.label('tasks') }}
                // Handed in: the manager's decision. Being worked on: Edit task.
                action={reviewing
                    ? (
                        <>
                            <Button icon={XIcon} onClick={handleReject}>{t('reject_button')}</Button>
                            <Button variant="primary" icon={CheckIcon} onClick={handleApprove}>{t('approve_button')}</Button>
                        </>
                    )
                    : editable && <Button icon={PencilSimpleIcon} onClick={handleEditClick}>{t('edit_task_button')}</Button>}
            />

            {/* Someone it's for was deleted: whoever transfers tasks moves it on. */}
            {deleted.length > 0 && canTransfer && !DECIDED.includes(task.status) && (
                <Card title={t('assignee_deleted_alert')}>
                    <p>{t('task_assignee_deleted_msg').replace('{name}', deleted.map((a: any) => `${a.firstName} ${a.lastName}`).join(locale === 'ar' ? '، ' : ', '))}</p>
                    {transferable && (
                        <div className="ui-form-actions">
                            <Button variant="primary" icon={UserSwitchIcon} onClick={openTransfer}>{t('transfer_to_another_employee')}</Button>
                        </div>
                    )}
                </Card>
            )}

            {/* Changed since it was given: whoever it's for sees what changed, and says they've seen it. */}
            {task.isEdited && (!seesOthersTasks || isOnTask) && (
                <Card title={t('task_updated_alert')}>
                    <p>{t('task_updated_msg').replace('{author}', editedBy)}</p>
                    <div className="ui-form-actions">
                        <Button variant="primary" onClick={() => action.run('dismiss', handleDismiss)} disabled={action.running} busy={action.is('dismiss')}>{t('i_understand_button')}</Button>
                        {seesChanges && latestChanges?.title && !viewedTitleChange && (
                            <Button onClick={() => { setDiffField('title'); setViewedTitleChange(true) }}>{t('task_see_title_changes')}</Button>
                        )}
                        {seesChanges && latestChanges?.description && !viewedDescriptionChange && (
                            <Button onClick={() => { setDiffField('description'); setViewedDescriptionChange(true) }}>{t('task_see_description_changes')}</Button>
                        )}
                    </div>
                </Card>
            )}

            <Card
                title={t('task_details')}
                actions={menu.length > 0 && <RowMenu label={t('ui_more_actions_for').replace('{name}', task.title)} tooltip={t('ui_more_actions')} items={menu} />}
            >
                {task.description && <p className="ui-prose" dir="auto">{task.description}</p>}
                <Details items={[
                    ...(place ? [{
                        label: t('task_location'),
                        value: place.link
                            ? <a href={place.link} target="_blank" rel="noopener noreferrer"><bdi>{place.name || place.link}</bdi><span className="ui-visually-hidden"> {t('ui_opens_new_tab')}</span></a>
                            : <bdi>{place.name}</bdi>,
                    }] : []),
                    // A client's location is named with its client already.
                    ...(task.client?.name && !place?.ofClient ? [{ label: t('client_label'), value: <bdi>{task.client.name}</bdi> }] : []),
                    { label: t('assigned_by'), value: creatorName ? <bdi>{creatorName}</bdi> : t('role_super_admin') },
                    { label: t('deadline_label'), value: <DueDate overdue={isOverdue}><SafeDate date={task.deadline} locale={locale} /></DueDate> },
                    { label: t('points_label_plural'), value: countOf(t, locale, task.difficulty ?? 0, 'pts') },
                    { label: t('assignees_label'), value: names.length ? <bdi>{new Intl.ListFormat(locale === 'ar' ? 'ar' : 'en', { type: 'conjunction' }).format(names)}</bdi> : t('no_assignee') },
                ]} />
            </Card>

            <SectionBoundary name="TaskCommentsLog">
                <TaskCommentsLog
                    task={task}
                    userId={userId}
                    locked={locked}
                    onDeleteNote={(date: string) => handleDeleteItem('SUBMISSION_NOTE', date)}
                />
            </SectionBoundary>

            <Card title={t('attachments_label')}>
                {existingAttachments.length > 0
                    ? (
                        <FileChips label={t('attachments_label')}>
                            {existingAttachments.map((att: any) => (
                                <FileChip
                                    key={att.url}
                                    name={att.name || t('attachment')}
                                    href={att.url}
                                    onRemove={task.status === 'IN_PROGRESS' && !locked && (att.uploadedById === userId || can('tasks.edit')) ? () => handleDeleteItem('ATTACHMENT', att.url) : undefined}
                                />
                            ))}
                        </FileChips>
                    )
                    : <p className="ui-hint">{t('no_attachments_msg')}</p>}
            </Card>

            <TaskCostsSection
                task={task}
                userId={userId}
                locked={locked}
                onDeleteItem={handleDeleteItem}
                onPaymentStatusChange={handlePaymentStatusChange}
                getMemberCosts={getMemberCosts}
                getMemberPaymentStatus={getMemberPaymentStatus}
            />

            {!isRestricted && (
                <>
                    <TaskLocationHistorySection
                        task={task}
                        setTask={setTask}
                        userId={userId}
                        locked={locked}
                        setLocationToDelete={setLocationToDelete}
                    />

                    {/* What whoever it's for hands in, while they're working on it. */}
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
                            locked={locked}
                        />
                    )}

                    {/* Handed in or done with: whoever it's for is told where it stands. */}
                    {(!seesOthersTasks || isOnTask) && ['PENDING_CONFIRMATION', 'APPROVED', 'COMPLETED', 'REJECTED'].includes(task.status) && (
                        <Card>
                            <p className="ui-hint">{task.status === 'PENDING_CONFIRMATION' ? t('pending_confirmation_msg') : t('task_finalized_msg')}</p>
                        </Card>
                    )}
                </>
            )}

            <Dialog
                open={!!diffField}
                onClose={() => setDiffField(null)}
                title={diffField === 'title' ? t('title_changes_title') : t('description_changes_title')}
                actions={<Button onClick={() => setDiffField(null)}>{t('close')}</Button>}
            >
                {diffField && latestChanges && latestChanges[diffField] && (
                    <div dir="auto">
                        <DiffViewer oldText={latestChanges[diffField].from} newText={latestChanges[diffField].to} />
                    </div>
                )}
            </Dialog>

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
                people={transferPeople}
                onRetry={() => { setRetryingPeople(true); setPeopleTries(n => n + 1) }}
                retrying={retryingPeople}
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
                onRevert={() => action.run('revert', handleRevert)}
                isReverting={isReverting}
            />
        </Page>
    )
}

/**
 * The notes on a task, newest first: everything in its log that isn't a cost
 * or a location, which have blocks of their own. The SectionBoundary around
 * it means a malformed log costs only this block, not the page.
 */
function TaskCommentsLog({ task, userId, locked, onDeleteNote }: {
    task: any
    userId: string
    /** Past its deadline, for whoever does it: a note stays. */
    locked: boolean
    onDeleteNote: (date: string) => void
}) {
    const { t, locale } = useLanguage()
    const canEditTask = useCan().can('tasks.edit')
    const logs = Array.isArray(task.comments) ? task.comments : []
    const regularLogs = logs.filter((l: any) => l.type !== 'COST_ADDITION' && l.type !== 'LOCATION_ADDED')
    if (regularLogs.length === 0) return null

    return (
        <Card title={t('comments_notes_title')}>
            <ol className="ui-notes">
                {[...regularLogs].reverse().map((log: any, i: number) => (
                    <li key={`${log.date || log.createdAt}-${i}`}>
                        <div className="ui-note-head">
                            <strong><bdi>{log.author}</bdi></strong>
                            <span className="ui-hint"><SafeDate date={log.date || log.createdAt} locale={locale} /></span>
                            {log.type === 'SUBMISSION_NOTE' && task.status === 'IN_PROGRESS' && !locked && (log.authorId === userId || canEditTask) && (
                                <Button size="sm" variant="quiet" icon={TrashIcon} onClick={() => onDeleteNote(log.date)}>{t('delete')}</Button>
                            )}
                        </div>
                        {/* An edit has no words of its own: it's said as one. */}
                        {log.text
                            ? <p className="ui-note-text" dir="auto">{log.text}</p>
                            : log.type === 'TASK_EDITED' && <p className="ui-note-text ui-hint">{t('task_log_edited')}</p>}
                    </li>
                ))}
            </ol>
        </Card>
    )
}

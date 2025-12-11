'use client'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { formatTaskStatus } from '@/lib/formatStatus'
import Modal from '@/components/Modal'
import DiffViewer from '@/components/DiffViewer'

export default function TaskDetailClient({ task: initialTask, userRole, userId, creatorName, currentUserName }: { task: any, userRole: string, userId: string, creatorName: string, currentUserName: string }) {
    const [task, setTask] = useState(initialTask)

    useEffect(() => {
        setTask(initialTask)
    }, [initialTask])

    // Get today's date in local time YYYY-MM-DD
    const today = new Date()
    const todayStr = today.getFullYear() + '-' + String(today.getMonth() + 1).padStart(2, '0') + '-' + String(today.getDate()).padStart(2, '0')

    const [pendingFiles, setPendingFiles] = useState<File[]>([])
    const [note, setNote] = useState('')
    const [cost, setCost] = useState('')
    const [costDescription, setCostDescription] = useState('')
    const [costEntries, setCostEntries] = useState<{ amount: string, description: string }[]>([])
    const [location, setLocation] = useState('')
    const [locationStatus, setLocationStatus] = useState('')
    const [capturingLocation, setCapturingLocation] = useState(false)
    const [uploading, setUploading] = useState(false)
    const [showFeedback, setShowFeedback] = useState(false)
    const [feedbackMessage, setFeedbackMessage] = useState('')
    const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
    const [showSubmitConfirm, setShowSubmitConfirm] = useState(false)
    const [locationToDelete, setLocationToDelete] = useState<{ date: string } | null>(null)
    const [isEditing, setIsEditing] = useState(false)
    const [isTransferModalOpen, setIsTransferModalOpen] = useState(false)
    const [transferAssigneeId, setTransferAssigneeId] = useState('')
    const [transferring, setTransferring] = useState(false)

    // Extract latest changes
    const latestChanges = (() => {
        try {
            const locs = JSON.parse(task.comments || '[]')
            const lastEdit = [...locs].reverse().find((c: any) => c.type === 'TASK_EDITED')
            return lastEdit ? lastEdit.changes : null
        } catch { return null }
    })()

    const [diffField, setDiffField] = useState<'title' | 'description' | null>(null)
    const [viewedTitleChange, setViewedTitleChange] = useState(false)
    const [viewedDescriptionChange, setViewedDescriptionChange] = useState(false)
    // Persist isEdited state so buttons don't disappear when "I Understand" is clicked
    const [isEditedPersistent] = useState(initialTask.isEdited)

    // ... (rest of the code)


    // ... (rest of the code)



    // Add Review Modal State (Existing prompt was simple, now we need a custom modal for Difficulty)
    const [isReviewModalOpen, setIsReviewModalOpen] = useState(false)
    const [reviewAction, setReviewAction] = useState<'APPROVED' | 'REJECTED' | null>(null)
    const [reviewDifficulty, setReviewDifficulty] = useState(task.difficulty)
    const [submittingReview, setSubmittingReview] = useState(false)

    const [editForm, setEditForm] = useState({
        title: task.title,
        description: task.description,
        assigneeId: task.assigneeId,
        deadline: new Date(task.deadline).toISOString().split('T')[0],
        difficulty: task.difficulty
    })
    const [allUsers, setAllUsers] = useState<any[]>([])
    const router = useRouter()

    useEffect(() => {
        if (isEditing && allUsers.length === 0) {
            fetch('/api/users')
                .then(res => res.json())
                .then(data => {
                    const sortedData = data.sort((a: any, b: any) => {
                        const rolePriority: { [key: string]: number } = {
                            'EMPLOYEE': 1, 'TEAM_LEADER': 2, 'ADMIN': 3, 'SUPER_ADMIN': 4
                        }
                        const priorityA = rolePriority[a.role] || 99
                        const priorityB = rolePriority[b.role] || 99
                        if (priorityA !== priorityB) return priorityA - priorityB
                        return a.firstName.localeCompare(b.firstName)
                    })
                    setAllUsers(sortedData)
                })
        }
    }, [isEditing])

    // Listen for suspension auto-save event
    useEffect(() => {
        const handleSuspendSave = () => {
            console.log('Suspension detected, auto-saving task draft...')
            // Only auto-save if employee interaction is expected & possible (or if user is the assignee)
            if ((userRole === 'EMPLOYEE' || userId === task.assigneeId) && task.status !== 'APPROVED' && task.status !== 'COMPLETED' && task.status !== 'PENDING_CONFIRMATION' && task.status !== 'REJECTED') {
                handleUpload(true)
            }
        }
        window.addEventListener('app:suspend-detected', handleSuspendSave)
        return () => window.removeEventListener('app:suspend-detected', handleSuspendSave)
    }, [task.status, userRole, pendingFiles, note, cost, costDescription, location])

    const handleSaveDetails = async (e: React.FormEvent) => {
        e.preventDefault()
        try {
            const res = await fetch(`/api/tasks/${task.id}/details`, {
                method: 'PUT',
                body: JSON.stringify(editForm),
                headers: { 'Content-Type': 'application/json' }
            })
            if (!res.ok) {
                const txt = await res.text()
                setFeedbackMessage(`Failed to update task: ${txt}`)
                setShowFeedback(true)
            } else {
                setFeedbackMessage('Task details updated!')
                setShowFeedback(true)
                setIsEditing(false)
                router.refresh()
                setTimeout(() => setShowFeedback(false), 5000)
            }
        } catch (error) {
            console.error(error)
            setFeedbackMessage('Failed to update task')
            setShowFeedback(true)
        }
    }

    const handleDismiss = async () => {
        await fetch(`/api/tasks/${task.id}/acknowledge`, { method: 'PUT' })
        router.refresh()
    }

    const existingAttachments = task.attachments ? (() => {
        try {
            const parsed = JSON.parse(task.attachments)
            if (Array.isArray(parsed)) return parsed
            if (parsed.url) return [parsed]
            return []
        } catch { return [] }
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

    const handleCaptureLocation = async () => {
        const currentLocations = task.comments ? JSON.parse(task.comments).filter((c: any) => c.type === 'LOCATION_ADDED') : []
        if (currentLocations.length >= 2) {
            setFeedbackMessage('Maximum 2 locations allowed per task.')
            setShowFeedback(true)
            setTimeout(() => setShowFeedback(false), 3000)
            return
        }

        if (!navigator.geolocation) {
            setLocationStatus('Geolocation not supported')
            return
        }

        setCapturingLocation(true)
        setLocationStatus('Capturing location...')

        navigator.geolocation.getCurrentPosition(
            async (position) => {
                const { latitude, longitude } = position.coords
                const coordString = `${latitude.toFixed(6)}, ${longitude.toFixed(6)}`
                let capturedLocation = coordString
                try {
                    const response = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${latitude}&lon=${longitude}`)
                    const data = await response.json()
                    capturedLocation = data.display_name || coordString
                } catch (error) { capturedLocation = coordString }

                const locationData = { address: capturedLocation, coords: coordString, latitude: latitude, longitude: longitude }
                const locationString = JSON.stringify(locationData)

                setLocation(capturedLocation)
                setLocationStatus('Location captured ✓ Saving...')

                try {
                    await fetch(`/api/tasks/${task.id}/submit`, {
                        method: 'PUT',
                        body: JSON.stringify({
                            newAttachments: [], note: '', cost: 0, costDescription: '', location: locationString, isDraft: true
                        }),
                        headers: { 'Content-Type': 'application/json' }
                    })
                    setLocationStatus('Location saved ✓')
                    setLocation('')
                    router.refresh()
                    setTimeout(() => setLocationStatus(''), 3000)
                } catch (error) {
                    console.error('Auto-save failed:', error)
                    setLocationStatus('Location captured but save failed')
                }
                setCapturingLocation(false)
            },
            (error) => {
                let errorMessage = 'Failed to get location. '
                switch (error.code) {
                    case error.PERMISSION_DENIED: errorMessage += 'Permission denied. Please allow location access in your browser settings.'; break
                    case error.POSITION_UNAVAILABLE: errorMessage += 'Location information unavailable. Try again or check your GPS.'; break
                    case error.TIMEOUT: errorMessage += 'Request timed out. Please try again.'; break
                    default: errorMessage += error.message || 'Unknown error occurred.'
                }
                setLocationStatus(errorMessage)
                setCapturingLocation(false)
            }
        )
    }

    const handleAddCost = () => {
        if (!cost) return
        const val = parseFloat(cost)
        if (val < 0) {
            setFeedbackMessage('Cost cannot be negative.')
            setShowFeedback(true)
            setTimeout(() => setShowFeedback(false), 3000)
            return
        }
        setCostEntries(prev => [...prev, { amount: cost, description: costDescription }])
        setCost('')
        setCostDescription('')
    }

    const removeCostEntry = (index: number) => {
        setCostEntries(prev => prev.filter((_, i) => i !== index))
    }

    const handleUploadRequest = () => {
        console.log('handleUploadRequest called')
        // Validation before showing confirmation
        if (cost && !isNaN(parseFloat(cost)) && parseFloat(cost) < 0) {
            setFeedbackMessage('Cost cannot be negative. Please enter a valid amount.')
            setShowFeedback(true)
            setTimeout(() => setShowFeedback(false), 3000)
            return
        }
        console.log('Opening confirmation modal')
        setShowSubmitConfirm(true)
    }

    const handleUpload = async (isDraft: boolean = false) => {
        console.log('handleUpload called', { isDraft, cost, pendingFiles: pendingFiles.length })
        // If it's a draft, skip confirmation modal (or reuse it if desired, but user asked for "submit" confirmation mainly)
        // If it's a submission (isDraft=false) and we haven't confirmed yet (called directly via buttons), we should divert to handleUploadRequest.
        // However, we will make the Submit button call handleUploadRequest instead.

        // Validation (redundant check for safety)
        if (cost && !isNaN(parseFloat(cost)) && parseFloat(cost) < 0) {
            console.log('Cost validation failed in handleUpload')
            return
        }

        setUploading(true)
        const uploadedAttachments: any[] = []
        try {
            for (const file of pendingFiles) {
                const formData = new FormData()
                formData.append('file', file)
                try {
                    const res = await fetch('/api/upload', { method: 'POST', body: formData })
                    const data = await res.json()
                    if (data.success) {
                        uploadedAttachments.push({ name: file.name, url: data.url, type: file.type, uploadedAt: new Date().toISOString(), uploadedBy: currentUserName })
                    } else { throw new Error(`Failed to upload ${file.name}`) }
                } catch (err) {
                    setFeedbackMessage(`Failed to upload one or more files.`)
                    setShowFeedback(true)
                    setUploading(false)
                    return
                }
            }
            await fetch(`/api/tasks/${task.id}/submit`, {
                method: 'PUT',
                body: JSON.stringify({
                    newAttachments: uploadedAttachments, note,
                    // If there is a pending input in the boxes, send it as single 'cost' (legacy/fallback)
                    cost: cost ? parseFloat(cost) : 0,
                    costDescription,
                    // Send the list of added entries
                    costs: costEntries,
                    location, isDraft
                }),
                headers: { 'Content-Type': 'application/json' }
            })
            setFeedbackMessage(isDraft ? 'Draft saved successfully!' : 'Task submitted successfully!')
            setShowFeedback(true)
            setTimeout(() => setShowFeedback(false), 5000)
            if (!isDraft) { setNote(''); setCost(''); setCostDescription(''); setLocation(''); setLocationStatus(''); setPendingFiles([]); setCostEntries([]) }
            else { setNote(''); setCost(''); setCostDescription(''); setLocation(''); setLocationStatus(''); setPendingFiles([]); setCostEntries([]) }
            router.refresh()
        } catch (error) {
            console.error('handleUpload error detected:', error)
            setFeedbackMessage('Failed to save. Check console for details.')
            setShowFeedback(true)
            // alert('Error saving task: ' + String(error)) // Optional: Uncomment if console is hard to reach
        } finally {
            console.log('handleUpload finished, setting uploading=false')
            setUploading(false)
        }
    }

    const validateLocations = (): boolean => {
        if (!task.comments) return true
        try {
            const locations = JSON.parse(task.comments).filter((c: any) => c.type === 'LOCATION_ADDED')
            const unverified = locations.filter((l: any) => !l.verificationStatus)
            if (unverified.length > 0) {
                setFeedbackMessage(`Please verify all ${unverified.length} location(s) before proceeding.`)
                setShowFeedback(true)
                setTimeout(() => setShowFeedback(false), 4000)
                return false
            }
        } catch (e) { console.error('Error parsing locations', e) }
        return true
    }

    const isTransferredTask = () => {
        // Use the new isTransfer database flag (or fallback to comment check for old data)
        if (task.isTransfer) return true
        if (!task.comments) return false
        return task.comments.includes('Task transferred to new employee') || task.comments.includes('Transferred from task')
    }

    const handleApprove = () => {
        if (!validateLocations()) return
        setReviewAction('APPROVED')
        setReviewDifficulty(task.difficulty)
        setIsReviewModalOpen(true)
    }

    const handleReject = () => {
        if (!validateLocations()) return
        setReviewAction('REJECTED')
        setReviewDifficulty(task.difficulty)
        setIsReviewModalOpen(true)
    }

    const submitReview = async (action: 'APPROVED' | 'REJECTED' | null = reviewAction, difficulty: number = reviewDifficulty) => {
        if (!action) return
        setSubmittingReview(true)
        try {
            await fetch(`/api/tasks/${task.id}/review`, {
                method: 'PUT',
                body: JSON.stringify({ status: action, difficulty: difficulty }),
                headers: { 'Content-Type': 'application/json' }
            })
            setIsReviewModalOpen(false)
            router.refresh()
            router.push('/dashboard/tasks')
        } catch (error) {
            console.error('Review failed', error)
        } finally {
            setSubmittingReview(false)
        }
    }

    const handleTransfer = async () => {
        if (!transferAssigneeId) return
        setTransferring(true)
        try {
            const res = await fetch(`/api/tasks/${task.id}/transfer`, {
                method: 'POST',
                body: JSON.stringify({ newAssigneeId: transferAssigneeId }),
                headers: { 'Content-Type': 'application/json' }
            })
            if (res.ok) {
                setFeedbackMessage('Task transferred successfully!')
                setShowFeedback(true)
                setTimeout(() => {
                    router.push('/dashboard/tasks')
                    router.refresh()
                }, 1500)
            } else {
                setFeedbackMessage('Transfer failed.')
                setShowFeedback(true)
            }
        } catch (error) {
            console.error('Transfer error', error)
        } finally {
            setTransferring(false)
            setIsTransferModalOpen(false)
        }
    }

    const handleDelete = async () => {
        try {
            const res = await fetch(`/api/tasks/${task.id}/delete`, { method: 'DELETE' })
            if (res.ok) { router.push('/dashboard/tasks'); router.refresh() }
            else { setFeedbackMessage('Failed to delete task'); setShowFeedback(true) }
        } catch (error) {
            setFeedbackMessage('Failed to delete task')
            setShowFeedback(true)
        }
        setShowDeleteConfirm(false)
    }

    const confirmDeleteLocation = async () => {
        if (!locationToDelete) return
        try {
            await fetch(`/api/tasks/${task.id}/locations`, {
                method: 'PUT',
                body: JSON.stringify({ timestamp: locationToDelete.date, action: 'DELETE' }),
                headers: { 'Content-Type': 'application/json' }
            })
            router.refresh()
            setLocationToDelete(null)
        } catch (error) { console.error('Failed to delete location', error) }
    }

    const handleEditClick = () => {
        if (['PENDING_CONFIRMATION', 'APPROVED', 'COMPLETED', 'REJECTED'].includes(task.status)) {
            setFeedbackMessage('Cannot edit a task that has been submitted, completed or rejected.')
            setShowFeedback(true)
            setTimeout(() => setShowFeedback(false), 3000)
            return
        }
        setIsEditing(true)
    }

    const handlePaymentStatusChange = async (newStatus: string) => {
        try {
            const res = await fetch(`/api/tasks/${task.id}/payment`, {
                method: 'PUT',
                body: JSON.stringify({ paymentStatus: newStatus }),
                headers: { 'Content-Type': 'application/json' }
            })
            if (res.ok) {
                const data = await res.json()
                if (data.success && data.task) {
                    setTask(data.task)
                    setFeedbackMessage(`Payment status updated to ${newStatus === 'PAID' ? 'Paid' : 'Pending Payment'}`)
                    setShowFeedback(true)
                    router.refresh()
                    setTimeout(() => setShowFeedback(false), 3000)
                }
            }
        } catch (error) { console.error('Payment status update failed', error) }
    }

    return (
        <div className="card">
            {/* Task Edited Alert */}
            {task.isEdited && (userRole === 'EMPLOYEE' || userId === task.assigneeId) && (
                <div style={{ background: '#fff7ed', border: '1px solid #fdba74', color: '#9a3412', padding: '1rem', borderRadius: '0.5rem', marginBottom: '1.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                        <span style={{ fontSize: '1.5rem' }}>⚠️</span>
                        <div>
                            <strong>Task Updated</strong>
                            <p style={{ margin: 0, fontSize: '0.9rem' }}>
                                The details of this task have been changed by <strong>{(() => {
                                    try {
                                        const locs = JSON.parse(task.comments || '[]')
                                        const lastEdit = [...locs].reverse().find((c: any) => c.type === 'TASK_EDITED')
                                        if (lastEdit && lastEdit.author) return lastEdit.author
                                        return 'an admin'
                                    } catch { return 'an admin' }
                                })()}</strong>. Please review the new requirements.
                            </p>
                        </div>
                    </div>
                    <button onClick={handleDismiss} className="btn" style={{ background: '#ffedd5', color: '#9a3412', border: '1px solid #fdba74' }}>I Understand</button>
                </div>
            )}

            {/* Diff Modal */}
            <Modal isOpen={!!diffField} onClose={() => setDiffField(null)} title={`${diffField === 'title' ? 'Title' : 'Description'} Changes`}>
                {diffField && latestChanges && latestChanges[diffField] && (
                    <div>
                        <DiffViewer oldText={latestChanges[diffField].from} newText={latestChanges[diffField].to} />
                    </div>
                )}
            </Modal>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <h1>{task.title}</h1>
                        {/* Title Diff Button */}
                        {(task.isEdited || isEditedPersistent) && userId === task.assigneeId && latestChanges?.title && !viewedTitleChange && (
                            <button
                                onClick={() => {
                                    setDiffField('title')
                                    setViewedTitleChange(true)
                                }}
                                style={{
                                    background: '#ffedd5',
                                    color: '#9a3412',
                                    border: '1px solid #fdba74',
                                    borderRadius: '0.25rem',
                                    padding: '0.25rem 0.5rem',
                                    fontSize: '0.75rem',
                                    cursor: 'pointer',
                                    fontWeight: 'bold'
                                }}
                                title="View Title Changes"
                            >
                                Changed
                            </button>
                        )}
                    </div>
                    <span style={{ padding: '0.25rem 0.75rem', borderRadius: '9999px', background: '#3b82f6', color: 'white', fontWeight: 'bold', fontSize: '0.9rem' }}>{task.difficulty} Points</span>
                    <span style={{ padding: '0.5rem', borderRadius: '0.5rem', background: task.status === 'COMPLETED' ? '#e0f2fe' : task.status === 'APPROVED' ? '#dcfce7' : task.status === 'PENDING_CONFIRMATION' ? '#fef9c3' : task.status === 'REJECTED' ? '#fee2e2' : '#e2e8f0', color: task.status === 'COMPLETED' ? '#0369a1' : task.status === 'APPROVED' ? '#166534' : task.status === 'PENDING_CONFIRMATION' ? '#854d0e' : task.status === 'REJECTED' ? '#991b1b' : '#0f172a' }}>{formatTaskStatus(task.status)}</span>
                    {task.totalCost > 0 && (task.status === 'APPROVED' || task.status === 'COMPLETED') && (
                        <span style={{ padding: '0.5rem', borderRadius: '0.5rem', background: task.paymentStatus === 'PAID' ? '#d1fae5' : '#fed7aa', color: task.paymentStatus === 'PAID' ? '#065f46' : '#9a3412', fontSize: '0.875rem', fontWeight: '600' }}>{task.paymentStatus === 'PAID' ? '✓ PAID' : '⏳ PENDING PAYMENT'}</span>
                    )}
                </div>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                    {task.totalCost > 0 && (task.status === 'APPROVED' || task.status === 'COMPLETED') && ['ADMIN', 'SUPER_ADMIN'].includes(userRole) && (
                        <button onClick={() => handlePaymentStatusChange(task.paymentStatus === 'PAID' ? 'PENDING_PAYMENT' : 'PAID')} style={{ background: task.paymentStatus === 'PAID' ? '#fed7aa' : '#d1fae5', color: task.paymentStatus === 'PAID' ? '#9a3412' : '#065f46', border: 'none', borderRadius: '0.25rem', padding: '0.5rem 1rem', cursor: 'pointer', fontSize: '0.875rem', fontWeight: '600' }}>{task.paymentStatus === 'PAID' ? 'Mark as Pending' : 'Mark as Paid'}</button>
                    )}
                    <button onClick={() => router.back()} style={{ background: 'none', border: '1px solid #cbd5e1', borderRadius: '0.25rem', padding: '0.5rem 1rem', cursor: 'pointer', color: '#64748b' }}>Close</button>
                    {['ADMIN', 'SUPER_ADMIN', 'TEAM_LEADER'].includes(userRole) && userId !== task.assigneeId && (<button onClick={handleEditClick} style={{ background: '#e0f2fe', color: '#0369a1', border: 'none', borderRadius: '0.25rem', padding: '0.5rem 1rem', cursor: 'pointer' }}>Edit Task</button>)}
                    {['ADMIN', 'SUPER_ADMIN'].includes(userRole) && (<button onClick={() => setShowDeleteConfirm(true)} style={{ background: '#fee2e2', color: '#991b1b', border: 'none', borderRadius: '0.25rem', padding: '0.5rem 1rem', cursor: 'pointer' }}>Delete Task</button>)}
                </div>
            </div>

            <div style={{ marginTop: '1rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
                    {/* Description Diff Button */}
                    {(task.isEdited || isEditedPersistent) && userId === task.assigneeId && latestChanges?.description && !viewedDescriptionChange && (
                        <button
                            onClick={() => {
                                setDiffField('description')
                                setViewedDescriptionChange(true)
                            }}
                            style={{
                                background: '#ffedd5',
                                color: '#9a3412',
                                border: '1px solid #fdba74',
                                borderRadius: '0.25rem',
                                padding: '0.1rem 0.5rem',
                                fontSize: '0.7rem',
                                cursor: 'pointer',
                                fontWeight: 'bold'
                            }}
                            title="View Description Changes"
                        >
                            Changed
                        </button>
                    )}
                </div>
                <p style={{ fontSize: '1.1rem', margin: 0, whiteSpace: 'pre-wrap' }}>{task.description}</p>
            </div>
            <div style={{ marginTop: '1rem', color: '#64748b' }}>Assigned by: {creatorName} | Deadline: {new Date(task.deadline).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} {new Date(task.deadline).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' })}</div>

            {/* Comments Section */}
            {task.comments && (() => {
                try {
                    const regularComments = JSON.parse(task.comments).filter((c: any) => c.type !== 'COST_ADDITION' && c.type !== 'LOCATION_ADDED')
                    if (regularComments.length > 0) {
                        return (
                            <div style={{ marginTop: '2rem', borderTop: '1px solid #e2e8f0', paddingTop: '1rem' }}>
                                <h3>Comments / Notes</h3>
                                {regularComments.map((comment: any, i: number) => (
                                    <div key={i} style={{ background: '#f8fafc', padding: '0.5rem', borderRadius: '0.25rem', marginTop: '0.5rem' }}>
                                        <p style={{ margin: 0 }}>{comment.text}</p>
                                        <span style={{ fontSize: '0.75rem', color: '#64748b' }}>- {comment.author} ({new Date(comment.date || comment.createdAt).toLocaleTimeString(undefined, { timeStyle: 'short' }) + ' ' + new Date(comment.date || comment.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })})</span>
                                    </div>
                                ))}
                            </div>
                        )
                    }
                } catch (e) { return null }
                return null
            })()}

            {/* Attachments Section */}
            <div style={{ marginTop: '2rem', borderTop: '1px solid #e2e8f0', paddingTop: '1rem' }}>
                <h3>Attachments</h3>
                <div style={{ marginTop: '0.5rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                    {existingAttachments.length > 0 ? (existingAttachments.map((att: any, index: number) => (
                        <div key={index} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                            <span style={{ fontSize: '1.2rem' }}>📎</span>
                            <a href={att.url} target="_blank" style={{ color: 'blue', textDecoration: 'underline' }}>{att.name || 'Attachment'}</a>
                            <span style={{ fontSize: '0.8rem', color: '#64748b' }}>
                                {att.uploadedBy ? `- ${att.uploadedBy} ` : ''}
                                ({new Date(att.uploadedAt || Date.now()).toLocaleTimeString(undefined, { timeStyle: 'short' }) + ' ' + new Date(att.uploadedAt || Date.now()).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })})
                            </span>
                        </div>
                    ))) : (<span style={{ color: '#64748b', fontStyle: 'italic' }}>No attachments</span>)}
                </div>
            </div>

            {/* Costs Section */}
            {task.comments && (() => {
                try {
                    const costEntries = JSON.parse(task.comments).filter((c: any) => c.type === 'COST_ADDITION')
                    if (costEntries.length > 0) {
                        return (
                            <div style={{ marginTop: '2rem', borderTop: '1px solid #e2e8f0', paddingTop: '1rem' }}>
                                <h3>Costs</h3>
                                {costEntries.map((entry: any, i: number) => (
                                    <div key={i} style={{ marginTop: '1rem' }}>
                                        <div style={{ display: 'flex', gap: '1rem', alignItems: 'stretch' }}>
                                            <div style={{ flex: 1, background: '#fef3c7', padding: '1rem', borderRadius: '0.5rem', border: '2px solid #f59e0b', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                                                <div style={{ fontSize: '0.75rem', color: '#92400e', fontWeight: '600', marginBottom: '0.25rem' }}>Description</div>
                                                <p style={{ margin: 0, fontWeight: '600', color: '#92400e', fontSize: '1rem' }}>{entry.description || entry.text}</p>
                                            </div>
                                            <div style={{ minWidth: '150px', background: '#fef3c7', padding: '1rem', borderRadius: '0.5rem', border: '2px solid #f59e0b', display: 'flex', flexDirection: 'column', justifyContent: 'center', textAlign: 'center' }}>
                                                <div style={{ fontSize: '0.75rem', color: '#92400e', fontWeight: '600', marginBottom: '0.25rem' }}>Amount</div>
                                                <div style={{ fontSize: '1.25rem', fontWeight: 'bold', color: '#92400e' }}>{entry.amount || (entry.text?.match(/[\d.]+/) || ['0'])[0]} EGP</div>
                                            </div>
                                        </div>
                                        <span style={{ fontSize: '0.75rem', color: '#78350f', marginTop: '0.5rem', display: 'block' }}>- {entry.author} ({new Date(entry.date).toLocaleTimeString(undefined, { timeStyle: 'short' }) + ' ' + new Date(entry.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })})</span>
                                    </div>
                                ))}
                                {task.totalCost > 0 && (
                                    <div style={{
                                        background: '#fef3c7',
                                        border: '2px solid #f59e0b',
                                        borderRadius: '0.5rem',
                                        padding: '1rem',
                                        marginTop: '2rem',
                                        marginBottom: '1rem',
                                        textAlign: 'center'
                                    }}>
                                        <div style={{ fontSize: '0.875rem', color: '#92400e', fontWeight: '600', marginBottom: '0.25rem' }}>
                                            Total Cost
                                        </div>
                                        <div style={{ fontSize: '1.5rem', fontWeight: 'bold', color: '#92400e' }}>
                                            {task.totalCost.toFixed(2)} EGP
                                        </div>
                                    </div>
                                )}
                            </div>
                        )
                    }
                } catch (e) { return null }
                return null
            })()}

            {/* Location History Section (Enhanced) */}
            {
                task.comments && (() => {
                    try {
                        const locationEntries = JSON.parse(task.comments).filter((c: any) => c.type === 'LOCATION_ADDED')
                        if (locationEntries.length > 0) {
                            return (
                                <div style={{ marginTop: '2rem', borderTop: '1px solid #e2e8f0', paddingTop: '1rem' }}>
                                    <h3>Location History</h3>
                                    {locationEntries.map((entry: any, i: number) => {
                                        // Parse location
                                        let displayLocation = entry.location
                                        let googleMapsLink = null

                                        try {
                                            if (entry.location.startsWith('{')) {
                                                const locData = JSON.parse(entry.location)
                                                displayLocation = locData.address || locData.coords
                                                if (locData.latitude && locData.longitude) {
                                                    googleMapsLink = `https://www.google.com/maps?q=${locData.latitude},${locData.longitude}`
                                                }
                                            }
                                        } catch (e) {
                                            displayLocation = entry.location
                                        }

                                        const handleVerify = async (status: 'CORRECT' | 'WRONG') => {
                                            await fetch(`/api/tasks/${task.id}/locations`, {
                                                method: 'PUT',
                                                body: JSON.stringify({ timestamp: entry.date, action: 'VERIFY', verificationStatus: status }),
                                                headers: { 'Content-Type': 'application/json' }
                                            })
                                            router.refresh()
                                        }

                                        const handleDeleteLocation = () => {
                                            setLocationToDelete({ date: entry.date })
                                        }

                                        // Permission Checks
                                        const canDelete = (userRole === 'EMPLOYEE' || userId === task.assigneeId) && (task.status === 'PENDING' || task.status === 'REJECTED' || task.status === 'IN_PROGRESS')
                                        const canVerify = ['SUPER_ADMIN', 'ADMIN', 'TEAM_LEADER'].includes(userRole) && task.status === 'PENDING_CONFIRMATION' && userId !== task.assigneeId

                                        return (
                                            <div key={i} style={{
                                                marginTop: '0.5rem',
                                                padding: '0.75rem',
                                                background: '#f0f9ff',
                                                borderRadius: '0.5rem',
                                                border: '1px solid #bae6fd',
                                                display: 'flex',
                                                justifyContent: 'space-between',
                                                alignItems: 'center',
                                                gap: '1rem'
                                            }}>
                                                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', flex: 1 }}>
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                                        <span style={{ fontSize: '1.2rem' }}>📍</span>
                                                        {googleMapsLink ? (
                                                            <a
                                                                href={googleMapsLink}
                                                                target="_blank"
                                                                rel="noopener noreferrer"
                                                                style={{ margin: 0, fontWeight: '500', color: '#0369a1', textDecoration: 'underline' }}
                                                            >
                                                                {displayLocation}
                                                            </a>
                                                        ) : (
                                                            <p style={{ margin: 0, fontWeight: '500', color: '#0c4a6e' }}>
                                                                {displayLocation}
                                                            </p>
                                                        )}
                                                    </div>
                                                    <div style={{ paddingLeft: '1.7rem' }}>
                                                        <span style={{ fontSize: '0.75rem', color: '#0369a1' }}>
                                                            - {entry.author} ({new Date(entry.date).toLocaleTimeString(undefined, { timeStyle: 'short' }) + ' ' + new Date(entry.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })})
                                                        </span>
                                                    </div>
                                                </div>

                                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                                    {/* Verification Buttons */}
                                                    {(canVerify || entry.verificationStatus) && (
                                                        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                                                            {(canVerify || entry.verificationStatus === 'CORRECT') && (
                                                                <button
                                                                    onClick={() => canVerify && handleVerify('CORRECT')}
                                                                    disabled={!canVerify}
                                                                    style={{
                                                                        border: entry.verificationStatus === 'CORRECT' ? '2px solid #16a34a' : '1px solid #cbd5e1',
                                                                        background: entry.verificationStatus === 'CORRECT' ? '#dcfce7' : 'white',
                                                                        borderRadius: '50%',
                                                                        width: '32px',
                                                                        height: '32px',
                                                                        cursor: canVerify ? 'pointer' : 'default',
                                                                        display: (entry.verificationStatus === 'WRONG' && !canVerify) ? 'none' : 'flex',
                                                                        alignItems: 'center', justifyContent: 'center',
                                                                        color: '#166534',
                                                                        transition: 'all 0.2s',
                                                                    }}
                                                                    title={canVerify ? "Mark Correct" : "Verified Correct"}
                                                                >
                                                                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                                                        <polyline points="20 6 9 17 4 12" />
                                                                    </svg>
                                                                </button>
                                                            )}

                                                            {(canVerify || entry.verificationStatus === 'WRONG') && (
                                                                <button
                                                                    onClick={() => canVerify && handleVerify('WRONG')}
                                                                    disabled={!canVerify}
                                                                    style={{
                                                                        border: entry.verificationStatus === 'WRONG' ? '2px solid #dc2626' : '1px solid #cbd5e1',
                                                                        background: entry.verificationStatus === 'WRONG' ? '#fee2e2' : 'white',
                                                                        borderRadius: '50%',
                                                                        width: '32px',
                                                                        height: '32px',
                                                                        cursor: canVerify ? 'pointer' : 'default',
                                                                        display: (entry.verificationStatus === 'CORRECT' && !canVerify) ? 'none' : 'flex',
                                                                        alignItems: 'center', justifyContent: 'center',
                                                                        color: '#991b1b',
                                                                        transition: 'all 0.2s',
                                                                    }}
                                                                    title={canVerify ? "Mark Wrong" : "Verified Wrong"}
                                                                >
                                                                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                                                        <line x1="18" y1="6" x2="6" y2="18"></line>
                                                                        <line x1="6" y1="6" x2="18" y2="18"></line>
                                                                    </svg>
                                                                </button>
                                                            )}
                                                        </div>
                                                    )}

                                                    {/* Delete Button */}
                                                    {canDelete && (
                                                        <button
                                                            onClick={handleDeleteLocation}
                                                            style={{
                                                                border: 'none',
                                                                background: 'none',
                                                                cursor: 'pointer',
                                                                padding: '4px',
                                                                borderRadius: '4px',
                                                                color: '#dc2626',
                                                                display: 'flex', alignItems: 'center', justifyContent: 'center'
                                                            }}
                                                            title="Delete Location"
                                                        >
                                                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                                                <polyline points="3 6 5 6 21 6"></polyline>
                                                                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                                                            </svg>
                                                        </button>
                                                    )}
                                                </div>
                                            </div>
                                        )
                                    })}
                                </div>
                            )
                        }
                    } catch (e) {
                        return null
                    }
                    return null
                })()
            }

            {/* Total Cost Box */}


            {/* Submission Form */}
            {
                (userRole === 'EMPLOYEE' || userId === task.assigneeId) && task.status !== 'APPROVED' && task.status !== 'COMPLETED' && task.status !== 'PENDING_CONFIRMATION' && task.status !== 'REJECTED' && (
                    <div style={{ marginTop: '2rem', borderTop: '1px solid #e2e8f0', paddingTop: '1rem' }}>
                        <h3>Submit Task</h3>
                        <div style={{ marginBottom: '1rem' }}>
                            <label style={{ display: 'block', marginBottom: '0.5rem' }}>Attachments (Optional)</label>
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

                            {/* List of pending files */}
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
                        </div>
                        <div style={{ marginBottom: '1rem' }}>
                            <label style={{ display: 'block', marginBottom: '0.5rem' }}>Add Costs</label>
                            <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.5rem' }}>
                                <input
                                    type="text"
                                    className="form-control"
                                    value={costDescription}
                                    onChange={e => setCostDescription(e.target.value)}
                                    placeholder="Description (e.g. Transportation)"
                                    style={{ flex: 1, padding: '0.5rem', borderRadius: '0.25rem', border: '1px solid #cbd5e1' }}
                                />
                                <input
                                    type="number"
                                    className="form-control"
                                    value={cost}
                                    onChange={e => setCost(e.target.value)}
                                    placeholder="Amount"
                                    min="0"
                                    step="0.01"
                                    style={{ width: '120px', padding: '0.5rem', borderRadius: '0.25rem', border: '1px solid #cbd5e1' }}
                                />
                                <button
                                    type="button"
                                    onClick={handleAddCost}
                                    className="btn"
                                    style={{ background: '#e0f2fe', color: '#0369a1', border: '1px solid #0ea5e9', fontWeight: 'bold' }}
                                    disabled={!cost}
                                >
                                    Add
                                </button>
                            </div>
                            {/* List of added costs */}
                            {costEntries.length > 0 && (
                                <div style={{ background: '#f8fafc', padding: '0.5rem', borderRadius: '0.5rem', border: '1px solid #e2e8f0' }}>
                                    {costEntries.map((entry, i) => (
                                        <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.25rem 0', borderBottom: i < costEntries.length - 1 ? '1px solid #e2e8f0' : 'none' }}>
                                            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                                                <span style={{ fontWeight: '500', color: '#334155' }}>{entry.description || 'No description'}</span>
                                                <span style={{ color: '#64748b' }}>-</span>
                                                <span style={{ fontWeight: '600', color: '#9a3412' }}>{entry.amount} EGP</span>
                                            </div>
                                            <button
                                                onClick={() => removeCostEntry(i)}
                                                style={{ color: '#ef4444', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 'bold' }}
                                            >
                                                &times;
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                        <div style={{ marginBottom: '1rem' }}>
                            <label style={{ display: 'block', marginBottom: '0.5rem' }}>Note (Optional)</label>
                            <textarea
                                className="form-control"
                                value={note}
                                onChange={e => setNote(e.target.value)}
                                placeholder="Add a note about your work..."
                                id="submission-note"
                                style={{ width: '100%', padding: '0.5rem', borderRadius: '0.25rem', border: '1px solid #cbd5e1' }}
                                maxLength={500}
                            />
                            <div style={{ fontSize: '0.75rem', color: note.length >= 500 ? '#ef4444' : '#94a3b8', textAlign: 'right', marginTop: '0.25rem' }}>
                                {note.length}/500
                            </div>
                        </div>
                        <div style={{ marginBottom: '1rem' }}>
                            <label style={{ display: 'block', marginBottom: '0.5rem' }}>Current Location</label>
                            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-start' }}>
                                <button
                                    type="button"
                                    onClick={handleCaptureLocation}
                                    disabled={uploading || capturingLocation}
                                    style={{
                                        padding: '0.5rem 1rem',
                                        borderRadius: '0.25rem',
                                        border: '1px solid #cbd5e1',
                                        background: capturingLocation ? '#e2e8f0' : '#3b82f6',
                                        color: capturingLocation ? '#64748b' : 'white',
                                        cursor: capturingLocation || uploading ? 'not-allowed' : 'pointer',
                                        fontSize: '0.875rem',
                                        fontWeight: '600'
                                    }}
                                >
                                    {capturingLocation ? '📍 Capturing...' : '📍 Capture Location'}
                                </button>
                                {locationStatus && (
                                    <span style={{
                                        fontSize: '0.875rem',
                                        color: locationStatus.includes('✓') ? '#16a34a' : locationStatus.includes('Failed') ? '#dc2626' : '#64748b',
                                        alignSelf: 'center'
                                    }}>
                                        {locationStatus}
                                    </span>
                                )}
                            </div>
                            {location && (
                                <div style={{
                                    marginTop: '0.5rem',
                                    padding: '0.5rem',
                                    background: '#f1f5f9',
                                    borderRadius: '0.25rem',
                                    fontSize: '0.875rem',
                                    color: '#475569'
                                }}>
                                    📍 {location}
                                </div>
                            )}
                        </div>
                        <div style={{ display: 'flex', gap: '1rem', marginTop: '1rem' }}>
                            <button
                                className="btn"
                                style={{ background: '#e2e8f0', color: '#0f172a' }}
                                onClick={() => handleUpload(true)}
                                disabled={uploading}
                            >
                                {uploading ? 'Saving...' : 'Save Draft'}
                            </button>
                            <button
                                className="btn btn-primary"
                                onClick={handleUploadRequest}
                                disabled={uploading}
                            >
                                {uploading ? 'Uploading...' : 'Submit Task'}
                            </button>
                        </div>
                    </div>
                )
            }

            {/* Transfer Button (Admins/Team Leaders Only) */}
            {
                ['ADMIN', 'SUPER_ADMIN', 'TEAM_LEADER'].includes(userRole) && (task.status === 'IN_PROGRESS' || task.status === 'PENDING') && (
                    <div style={{ marginTop: '1rem', textAlign: 'right' }}>
                        <button
                            onClick={() => {
                                // Fetch users if not loaded
                                if (allUsers.length === 0) {
                                    fetch('/api/users').then(r => r.json()).then(setAllUsers)
                                }
                                setIsTransferModalOpen(true)
                            }}
                            style={{ background: 'none', border: 'none', color: '#64748b', textDecoration: 'underline', cursor: 'pointer', fontSize: '0.9rem' }}
                        >
                            Transfer to another employee
                        </button>
                    </div>
                )
            }
            {/* Feedback Modal */}
            {
                showFeedback && (
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
                )
            }

            {
                ['ADMIN', 'SUPER_ADMIN', 'TEAM_LEADER'].includes(userRole) && task.status === 'PENDING_CONFIRMATION' && userId !== task.assigneeId && (
                    <div style={{ marginTop: '2rem', display: 'flex', gap: '1rem' }}>
                        <button className="btn btn-primary" onClick={handleApprove}>Approve</button>
                        <button className="btn" style={{ background: 'red', color: 'white' }} onClick={handleReject}>Reject</button>
                    </div>
                )
            }

            {/* Delete Confirmation Modal (Task) */}
            {
                showDeleteConfirm && (
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
                        <div className="card" style={{ maxWidth: '400px', width: '100%', padding: '1.5rem' }}>
                            <h3>Delete Task</h3>
                            <p>Are you sure you want to delete this task? This action cannot be undone.</p>
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
                )
            }

            {/* Edit Modal */}
            {
                isEditing && (
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
                        <div className="card" style={{ width: '100%', maxWidth: '600px', padding: '1.5rem', maxHeight: '90vh', overflowY: 'auto' }}>
                            <h2 style={{ marginTop: 0, marginBottom: '1.5rem' }}>Edit Task Details</h2>
                            <form onSubmit={handleSaveDetails}>
                                <div style={{ marginBottom: '1rem' }}>
                                    <label style={{ display: 'block', marginBottom: '0.5rem' }}>Title</label>
                                    <input
                                        className="input"
                                        value={editForm.title}
                                        onChange={e => setEditForm({ ...editForm, title: e.target.value })}
                                        required
                                        maxLength={100}
                                    />
                                    <div style={{ fontSize: '0.75rem', color: editForm.title.length >= 100 ? '#ef4444' : '#94a3b8', textAlign: 'right', marginTop: '0.25rem' }}>
                                        {editForm.title.length}/100
                                    </div>
                                </div>
                                <div style={{ marginBottom: '1rem' }}>
                                    <label style={{ display: 'block', marginBottom: '0.5rem' }}>Description</label>
                                    <textarea
                                        className="input"
                                        value={editForm.description}
                                        onChange={e => setEditForm({ ...editForm, description: e.target.value })}
                                        rows={4}
                                        required
                                        maxLength={500}
                                    />
                                    <div style={{ fontSize: '0.75rem', color: editForm.description.length >= 500 ? '#ef4444' : '#94a3b8', textAlign: 'right', marginTop: '0.25rem' }}>
                                        {editForm.description.length}/500
                                    </div>
                                </div>
                                <div style={{ marginBottom: '1rem' }}>
                                    <label style={{ display: 'block', marginBottom: '0.5rem' }}>Assignee</label>
                                    <select
                                        className="input"
                                        value={editForm.assigneeId}
                                        onChange={e => setEditForm({ ...editForm, assigneeId: e.target.value })}
                                        style={{ width: '100%' }}
                                        required
                                        disabled
                                    >    <option value="">Select Employee</option>
                                        {allUsers.map(u => <option key={u.id} value={u.id}>{u.firstName} {u.lastName}</option>)}
                                    </select>
                                </div>
                                <div style={{ marginBottom: '1rem' }}>
                                    <label style={{ display: 'block', marginBottom: '0.5rem' }}>Deadline</label>
                                    <input
                                        type="datetime-local"
                                        className="input"
                                        value={editForm.deadline ? new Date(editForm.deadline).toISOString().slice(0, 16) : ''}
                                        onChange={e => setEditForm({ ...editForm, deadline: e.target.value })}
                                        min={new Date().toISOString().slice(0, 16)}
                                        max="9999-12-31T23:59"
                                        required
                                    />
                                </div>
                                <div style={{ marginBottom: '1rem' }}>
                                    <label style={{ display: 'block', marginBottom: '0.5rem' }}>Difficulty</label>
                                    <input
                                        type="number"
                                        className="input"
                                        value={editForm.difficulty}
                                        onChange={e => setEditForm({ ...editForm, difficulty: parseInt(e.target.value) || 0 })}
                                        min="0"
                                        max="10"
                                        required
                                    />
                                </div>
                                <div style={{ display: 'flex', gap: '1rem' }}>
                                    <button type="submit" className="btn btn-primary">Save Changes</button>
                                    <button
                                        type="button"
                                        className="btn"
                                        style={{ background: '#e2e8f0', color: '#0f172a' }}
                                        onClick={() => setIsEditing(false)}
                                    >
                                        Cancel
                                    </button>
                                </div>
                            </form>
                        </div>
                    </div>
                )
            }

            {/* Transfer Modal */}
            <Modal isOpen={isTransferModalOpen} onClose={() => setIsTransferModalOpen(false)} title="Transfer Task" hideFooter={true}>
                <div style={{ padding: '0.5rem' }}>
                    <p style={{ marginBottom: '1rem' }}>Select the employee you want to transfer this task to. The current task will be submitted, and a copy will be created for the new employee.</p>
                    <select
                        className="input"
                        value={transferAssigneeId}
                        onChange={(e) => setTransferAssigneeId(e.target.value)}
                        style={{ width: '100%', marginBottom: '1rem' }}
                    >
                        <option value="">Select Employee...</option>
                        {allUsers.filter(u => u.id !== task.assigneeId && u.id !== userId).map(u => (
                            <option key={u.id} value={u.id}>{u.firstName} {u.lastName} ({u.role})</option>
                        ))}
                    </select>

                    <div style={{ display: 'flex', gap: '1rem', justifyContent: 'flex-end' }}>
                        <button className="btn" onClick={() => setIsTransferModalOpen(false)}>Cancel</button>
                        <button className="btn btn-primary" onClick={handleTransfer} disabled={transferring || !transferAssigneeId}>
                            {transferring ? 'Transferring...' : 'Confirm Transfer'}
                        </button>
                    </div>
                </div>
            </Modal>

            {/* Review Modal (Difficulty Adjustment) */}
            <Modal isOpen={isReviewModalOpen} onClose={() => setIsReviewModalOpen(false)} title={`Confirm ${reviewAction === 'APPROVED' ? 'Approval' : 'Rejection'}`} hideFooter={true}>
                <div style={{ padding: '0.5rem' }}>
                    <p style={{ marginBottom: '1rem' }}>
                        You are about to {reviewAction?.toLowerCase()} this task.
                        {isTransferredTask() ? ' Please confirm the difficulty points.' : ' Are you sure?'}
                    </p>
                    {isTransferredTask() && (
                        <>
                            <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 'bold' }}>Difficulty Points</label>
                            <input
                                type="number"
                                className="input"
                                value={reviewDifficulty}
                                onChange={(e) => setReviewDifficulty(parseInt(e.target.value) || 0)}
                                min="0"
                                max="100"
                                style={{ width: '100%', marginBottom: '1.5rem' }}
                            />
                        </>
                    )}
                    <div style={{ display: 'flex', gap: '1rem', justifyContent: 'flex-end' }}>
                        <button className="btn" onClick={() => setIsReviewModalOpen(false)}>Cancel</button>
                        <button
                            className="btn"
                            style={{ background: reviewAction === 'APPROVED' ? '#16a34a' : '#dc2626', color: 'white' }}
                            onClick={() => submitReview()}
                            disabled={submittingReview}
                        >
                            {submittingReview ? 'Processing...' : `Confirm ${reviewAction}`}
                        </button>
                    </div>
                </div>
            </Modal>

            {/* Submit Confirmation Modal */}
            {showSubmitConfirm && (
                <div style={{
                    position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
                    background: 'rgba(0, 0, 0, 0.5)', display: 'flex',
                    alignItems: 'center', justifyContent: 'center', zIndex: 3000
                }}>
                    <div className="card" style={{ maxWidth: '400px', width: '90%', padding: '1.5rem', background: 'white', borderRadius: '0.5rem' }}>
                        <h3>Confirm Submission</h3>
                        <p>Are you sure you want to submit this task? You won't be able to edit it afterwards.</p>
                        <div style={{ display: 'flex', gap: '1rem', marginTop: '1.5rem', justifyContent: 'flex-end' }}>
                            <button
                                onClick={() => setShowSubmitConfirm(false)}
                                className="btn"
                                style={{ background: '#e2e8f0', color: '#0f172a' }}
                            >
                                Cancel
                            </button>
                            <button
                                onClick={() => { setShowSubmitConfirm(false); handleUpload(false); }}
                                className="btn btn-primary"
                            >
                                Confirm Submit
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Delete Location Modal */}
            {
                locationToDelete && (
                    <div style={{
                        position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
                        background: 'rgba(0, 0, 0, 0.5)', display: 'flex',
                        alignItems: 'center', justifyContent: 'center', zIndex: 3000
                    }}>
                        <div className="card" style={{ maxWidth: '400px', padding: '1.5rem', background: 'white', borderRadius: '0.5rem' }}>
                            <h3 style={{ marginTop: 0 }}>Delete Location</h3>
                            <p>Are you sure you want to delete this location?</p>
                            <div style={{ display: 'flex', gap: '1rem', marginTop: '1.5rem' }}>
                                <button onClick={confirmDeleteLocation} className="btn" style={{ background: '#991b1b', color: 'white', flex: 1 }}>Delete</button>
                                <button onClick={() => setLocationToDelete(null)} className="btn" style={{ background: '#e2e8f0', color: '#0f172a', flex: 1 }}>Cancel</button>
                            </div>
                        </div>
                    </div>
                )
            }

        </div >
    )
}

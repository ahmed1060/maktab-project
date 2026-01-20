'use client'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useSession } from 'next-auth/react'
import DateTimePicker from '@/components/DateTimePicker'
import { useLanguage } from '@/context/LanguageContext'
import { useCompany } from '@/context/CompanyContext'
import { useToast } from '@/context/ToastContext'
import LocationSearchInput from '@/components/LocationSearchInput'
import * as XLSX from 'xlsx'

export default function NewTaskPage() {
    const { t, locale } = useLanguage()
    const [title, setTitle] = useState('')
    const [description, setDescription] = useState('')
    const [assigneeIds, setAssigneeIds] = useState<string[]>([])
    const [deadline, setDeadline] = useState('')
    const [difficulty, setDifficulty] = useState('')
    const [location, setLocation] = useState('')
    const [locationLink, setLocationLink] = useState('')
    const [isBulkModalOpen, setIsBulkModalOpen] = useState(false)
    const [isManageTemplatesOpen, setIsManageTemplatesOpen] = useState(false)
    const [bulkTasks, setBulkTasks] = useState<any[]>([])
    const [users, setUsers] = useState<any[]>([])
    const router = useRouter()

    const { showToast } = useToast()

    const { data: session } = useSession()
    const { selectedCompanyId } = useCompany()
    const userRole = (session?.user as any)?.role

    useEffect(() => {
        const queryParams = new URLSearchParams()
        queryParams.set('limit', '1000')
        if (selectedCompanyId) queryParams.set('companyId', selectedCompanyId)

        fetch(`/api/users?${queryParams.toString()}`)
            .then(res => res.json())
            .then(data => {
                const usersList = data.data || []
                // Sort by role: EMPLOYEE -> TEAM_LEADER -> ADMIN -> SUPER_ADMIN
                const sortedData = usersList.sort((a: any, b: any) => {
                    const rolePriority: { [key: string]: number } = {
                        'EMPLOYEE': 1,
                        'TEAM_LEADER': 2,
                        'ADMIN': 3,
                        'SUPER_ADMIN': 4
                    }
                    const priorityA = rolePriority[a.role] || 99
                    const priorityB = rolePriority[b.role] || 99

                    if (priorityA !== priorityB) {
                        return priorityA - priorityB
                    }
                    // Secondary sort by name if same role
                    return a.firstName.localeCompare(b.firstName)
                })
                // TEAM_LEADER Restriction: Hide ADMIN and SUPER_ADMIN from assignee list
                const filteredData = userRole === 'TEAM_LEADER'
                    ? sortedData.filter((u: any) => !['ADMIN', 'SUPER_ADMIN'].includes(u.role))
                    : sortedData
                setUsers(filteredData)
            })
    }, [session, selectedCompanyId, userRole])

    const [error, setError] = useState('')
    const [fieldErrors, setFieldErrors] = useState<{ [key: string]: string }>({})
    const [isSubmitting, setIsSubmitting] = useState(false)

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        setIsSubmitting(true)
        setError('')
        setFieldErrors({})

        // Client-side Validation (matching server rules)
        const errors: { [key: string]: string } = {}
        if (!title || title.length < 3 || title.length > 100) {
            errors.title = t('task_title_validation' as any)
        }
        if (!description || description.length < 10 || description.length > 1000) {
            errors.description = t('task_description_validation' as any)
        }
        if (!deadline) {
            errors.deadline = t('select_deadline')
        }
        if (assigneeIds.length === 0) {
            errors.assigneeIds = t('select_employee_placeholder')
        }

        if (Object.keys(errors).length > 0) {
            setFieldErrors(errors)
            setIsSubmitting(false)

            // Auto-scroll to first error
            const firstErrorField = Object.keys(errors)[0]
            const element = document.getElementById(`field-${firstErrorField}`)
            if (element) {
                element.scrollIntoView({ behavior: 'smooth', block: 'center' })
            }
            return
        }

        try {
            const res = await fetch('/api/tasks', {
                method: 'POST',
                body: JSON.stringify({
                    title,
                    description,
                    assigneeIds,
                    deadline,
                    difficulty: parseInt(difficulty) || 0,
                    location: location || locationLink ? JSON.stringify({ name: location, link: locationLink }) : ''
                }),
                headers: { 'Content-Type': 'application/json' }
            })

            if (!res.ok) {
                const data = await res.json().catch(() => ({}))
                const errorMessage = data.details || data.message || `${t('error_generic')} (${res.status})`
                throw new Error(errorMessage)
            }

            router.push('/dashboard/tasks')
            router.refresh()
        } catch (err: any) {
            console.error(err)
            setError(err.message || t('error_generic'))
            setIsSubmitting(false)
        }
    }

    const handleBulkUpload = async (file: File) => {
        const reader = new FileReader()
        reader.onload = (e) => {
            const data = new Uint8Array(e.target?.result as ArrayBuffer)
            const workbook = XLSX.read(data, { type: 'array' })
            const sheetName = workbook.SheetNames[0]
            const worksheet = workbook.Sheets[sheetName]
            const jsonData: any[] = XLSX.utils.sheet_to_json(worksheet, { header: 1 })

            // Process data starting from Row 3 (index 2)
            const tasks = jsonData.slice(2).filter(row => row[0]) // row[0] is Title
                .map(row => {
                    const title = row[0]
                    const description = row[1]
                    const usernamesRaw = row[2] ? String(row[2]) : ''
                    const deadlineDateStr = row[3] // Column D
                    const deadlineTimeStr = row[4] // Column E
                    const diffPoints = parseInt(row[5]) || 0 // Column F

                    // Resolve usernames to IDs
                    const usernames = usernamesRaw.split(',').map(u => u.trim()).filter(u => u)
                    const resolvedIds = []
                    const unresolvedUsernames = []

                    for (const uname of usernames) {
                        const user = users.find(u => u.username === uname)
                        if (user) resolvedIds.push(user.id)
                        else unresolvedUsernames.push(uname)
                    }

                    // Process Deadline (Merge Date and Time)
                    let finalDeadline = ''
                    if (deadlineDateStr) {
                        // xlsx often parses dates as numbers (days since 1900)
                        let d = deadlineDateStr
                        if (typeof d === 'number') {
                            const dateObj = XLSX.utils.format_cell({ v: d, t: 'd' })
                            d = dateObj
                        }

                        const datePart = new Date(d)
                        if (!isNaN(datePart.getTime())) {
                            if (deadlineTimeStr) {
                                let tStr = String(deadlineTimeStr)
                                // If excel time (decimal)
                                if (typeof deadlineTimeStr === 'number') {
                                    const totalSeconds = Math.round(deadlineTimeStr * 24 * 3600)
                                    const hours = Math.floor(totalSeconds / 3600)
                                    const minutes = Math.floor((totalSeconds % 3600) / 60)
                                    tStr = `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`
                                }

                                const [h, m] = tStr.split(':').map(Number)
                                if (!isNaN(h) && !isNaN(m)) {
                                    datePart.setHours(h, m, 0, 0)
                                }
                            }
                            finalDeadline = datePart.toISOString()
                        }
                    }

                    return {
                        title,
                        description,
                        usernamesRaw,
                        resolvedIds,
                        unresolvedUsernames,
                        deadline: finalDeadline,
                        difficulty: diffPoints,
                        location: '', // Added later in modal
                        isInvalid: unresolvedUsernames.length > 0 || !title || !description || !finalDeadline
                    }
                })

            if (tasks.length === 0) {
                showToast(t('no_data_available'), 'error')
                return
            }

            setBulkTasks(tasks)
            setIsBulkModalOpen(true)
        }
        reader.readAsArrayBuffer(file)
    }

    const containerStyle: React.CSSProperties = {
        direction: locale === 'ar' ? 'rtl' : 'ltr',
        textAlign: locale === 'ar' ? 'right' : 'left'
    }

    const [searchTerm, setSearchTerm] = useState('')

    const filteredUsers = users.filter(u => {
        const fullName = `${u.firstName} ${u.lastName}`.toLowerCase()
        return fullName.includes(searchTerm.toLowerCase())
    })

    return (
        <div className="card" style={{ maxWidth: '600px', margin: '0 auto', ...containerStyle }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
                <h1 style={{ margin: 0 }}>{t('create_new_task')}</h1>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                    <button
                        type="button"
                        onClick={() => {
                            if (userRole === 'SUPER_ADMIN') setIsManageTemplatesOpen(true)
                            else window.open(`/api/templates/download?locale=${locale}`, '_blank')
                        }}
                        className="button-secondary"
                        style={{ padding: '0.5rem 1rem', fontSize: '0.85rem' }}
                    >
                        {t('download_template')}
                    </button>
                    <label className="button-primary" style={{ padding: '0.5rem 1rem', fontSize: '0.85rem', cursor: 'pointer', display: 'flex', alignItems: 'center' }}>
                        {t('upload_tasks_excel')}
                        <input
                            type="file"
                            accept=".xlsx, .xls"
                            onChange={(e) => {
                                const file = e.target.files?.[0]
                                if (file) handleBulkUpload(file)
                                e.target.value = '' // Reset
                            }}
                            style={{ display: 'none' }}
                        />
                    </label>
                </div>
            </div>
            {error && (
                <div style={{ background: '#fee2e2', color: '#991b1b', padding: '1rem', borderRadius: '0.5rem', marginBottom: '1rem', border: '1px solid #fecaca' }}>
                    {error}
                </div>
            )}
            <form onSubmit={handleSubmit}>
                <div id="field-title" style={{ marginBottom: '1.25rem' }}>
                    <label style={{ display: 'block', marginBottom: '0.5rem' }}>{t('title_label' as any)}</label>
                    <input
                        className="input"
                        value={title}
                        onChange={e => {
                            setTitle(e.target.value)
                            if (fieldErrors.title) setFieldErrors({ ...fieldErrors, title: '' })
                        }}
                        style={fieldErrors.title ? { borderColor: '#ef4444' } : {}}
                        required
                        maxLength={100}
                    />
                    {fieldErrors.title && (
                        <div style={{ color: '#ef4444', fontSize: '0.85rem', marginTop: '0.25rem' }}>
                            {fieldErrors.title}
                        </div>
                    )}
                    <div style={{ fontSize: '0.75rem', color: title.length >= 100 ? '#ef4444' : '#94a3b8', textAlign: locale === 'ar' ? 'left' : 'right', marginTop: '0.25rem' }}>
                        {title.length}/100
                    </div>
                </div>
                <div id="field-description" style={{ marginBottom: '1.25rem' }}>
                    <label style={{ display: 'block', marginBottom: '0.5rem' }}>{t('description_label' as any)}</label>
                    <textarea
                        className="input"
                        value={description}
                        onChange={e => {
                            setDescription(e.target.value)
                            if (fieldErrors.description) setFieldErrors({ ...fieldErrors, description: '' })
                        }}
                        style={fieldErrors.description ? { borderColor: '#ef4444' } : {}}
                        rows={4}
                        required
                        maxLength={1000}
                    />
                    {fieldErrors.description && (
                        <div style={{ color: '#ef4444', fontSize: '0.85rem', marginTop: '0.25rem' }}>
                            {fieldErrors.description}
                        </div>
                    )}
                    <div style={{ fontSize: '0.75rem', color: description.length >= 1000 ? '#ef4444' : '#94a3b8', textAlign: locale === 'ar' ? 'left' : 'right', marginTop: '0.25rem' }}>
                        {description.length}/1000
                    </div>
                </div>
                <div style={{ marginBottom: '1.25rem' }}>
                    <LocationSearchInput
                        label={t('location_name_label')}
                        value={{ name: location, link: locationLink }}
                        onChange={(val) => {
                            setLocation(val.name)
                            setLocationLink(val.link)
                        }}
                        placeholder={t('location_name_placeholder')}
                        locale={locale}
                    />
                </div>
                <div id="field-assigneeIds" style={{ marginBottom: '1.25rem' }}>
                    <label style={{ display: 'block', marginBottom: '0.5rem' }}>{t('assignee_label')}</label>
                    <input
                        type="text"
                        className="input"
                        placeholder={t('search_placeholder')}
                        value={searchTerm}
                        onChange={e => setSearchTerm(e.target.value)}
                        style={{ marginBottom: '0.5rem', fontSize: '0.9rem' }}
                    />
                    <div style={{
                        maxHeight: '200px',
                        overflowY: 'auto',
                        border: '1px solid #e2e8f0',
                        borderRadius: '0.5rem',
                        padding: '0.75rem',
                        background: '#fff'
                    }}>
                        {filteredUsers.length > 0 ? filteredUsers.map(u => (
                            <label key={u.id} style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: '0.5rem',
                                marginBottom: '0.5rem',
                                cursor: 'pointer',
                                padding: '0.25rem',
                                borderRadius: '0.25rem',
                                background: assigneeIds.includes(u.id) ? '#f0f9ff' : 'transparent'
                            }}>
                                <input
                                    type="checkbox"
                                    checked={assigneeIds.includes(u.id)}
                                    onChange={e => {
                                        if (e.target.checked) {
                                            setAssigneeIds([...assigneeIds, u.id])
                                        } else {
                                            setAssigneeIds(assigneeIds.filter(id => id !== u.id))
                                        }
                                        if (fieldErrors.assigneeIds) setFieldErrors({ ...fieldErrors, assigneeIds: '' })
                                    }}
                                />
                                <span style={{ fontSize: '0.9rem' }}>
                                    {u.firstName} {u.lastName} <small style={{ color: '#64748b' }}>({t(`role_${u.role?.toLowerCase().replace('team_leader', 'team_leader').replace('employee', 'employee').replace('admin', 'admin')}` as any)})</small>
                                </span>
                            </label>
                        )) : (
                            <div style={{ color: '#64748b', fontSize: '0.9rem', textAlign: 'center', padding: '1rem' }}>
                                {t('no_data_available')}
                            </div>
                        )}
                    </div>
                    {fieldErrors.assigneeIds && (
                        <div style={{ color: '#ef4444', fontSize: '0.85rem', marginTop: '0.25rem' }}>
                            {fieldErrors.assigneeIds}
                        </div>
                    )}
                </div>
                <div id="field-deadline" style={{ marginBottom: '1.25rem' }}>
                    <DateTimePicker
                        label={t('deadline_label')}
                        value={deadline}
                        onChange={v => { setDeadline(v); if (fieldErrors.deadline) setFieldErrors({ ...fieldErrors, deadline: '' }) }}
                        min={new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString()}
                    />
                    {fieldErrors.deadline && (
                        <div style={{ color: '#ef4444', fontSize: '0.85rem', marginTop: '0.25rem' }}>
                            {fieldErrors.deadline}
                        </div>
                    )}
                </div>
                <div style={{ marginBottom: '1.5rem' }}>
                    <label style={{ display: 'block', marginBottom: '0.5rem' }}>{t('difficulty')}</label>
                    <input
                        type="number"
                        className="input"
                        value={difficulty}
                        onChange={e => {
                            const val = e.target.value
                            if (val === '') {
                                setDifficulty('')
                            } else {
                                const num = parseInt(val)
                                setDifficulty(Math.min(Math.max(num, 0), 10).toString())
                            }
                        }}
                        min="0"
                        max="10"
                        placeholder={locale === 'ar' ? '٠-١٠' : '0-10'}
                        required
                    />
                </div>
                <div style={{ display: 'flex', gap: '1rem' }}>
                    <button type="submit" className="btn btn-primary" disabled={isSubmitting}>
                        {isSubmitting ? t('creating') : t('create_task_button' as any)}
                    </button>
                    <button
                        type="button"
                        className="btn"
                        style={{ background: '#e2e8f0', color: '#0f172a' }}
                        onClick={() => router.push('/dashboard/tasks')}
                    >
                        {t('cancel')}
                    </button>
                </div>
            </form>

            {/* Bulk Review Modal */}
            {isBulkModalOpen && (
                <div style={{
                    position: 'fixed',
                    inset: 0,
                    zIndex: 1000,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    background: 'rgba(0,0,0,0.4)',
                    backdropFilter: 'blur(4px)',
                    padding: '2rem'
                }}>
                    <div className="card" style={{
                        width: '100%',
                        maxWidth: '1200px',
                        maxHeight: '90vh',
                        overflowY: 'auto',
                        padding: '2rem',
                        background: '#f8fafc'
                    }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
                            <h2 style={{ margin: 0 }}>{t('bulk_review_title')}</h2>
                            <button className="button-secondary" onClick={() => setIsBulkModalOpen(false)}>×</button>
                        </div>

                        <div style={{ overflowX: 'auto', marginBottom: '1.5rem' }}>
                            <table style={{ width: '100%', borderCollapse: 'collapse', background: '#fff', borderRadius: '0.5rem', border: '1px solid #e2e8f0' }}>
                                <thead>
                                    <tr style={{ background: '#f1f5f9', borderBottom: '2px solid #e2e8f0' }}>
                                        <th style={{ padding: '0.75rem', textAlign: locale === 'ar' ? 'right' : 'left' }}>#</th>
                                        <th style={{ padding: '0.75rem', textAlign: locale === 'ar' ? 'right' : 'left' }}>{t('title')}</th>
                                        <th style={{ padding: '0.75rem', textAlign: locale === 'ar' ? 'right' : 'left' }}>{t('description_label' as any)}</th>
                                        <th style={{ padding: '0.75rem', textAlign: locale === 'ar' ? 'right' : 'left' }}>{t('assignees_label')}</th>
                                        <th style={{ padding: '0.75rem', textAlign: locale === 'ar' ? 'right' : 'left' }}>{t('deadline_label')}</th>
                                        <th style={{ padding: '0.75rem', textAlign: locale === 'ar' ? 'right' : 'left' }}>{t('location_name_label')}</th>
                                        <th style={{ padding: '0.75rem', textAlign: locale === 'ar' ? 'right' : 'left' }}>{t('actions_label')}</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {bulkTasks.map((bt, idx) => (
                                        <tr key={idx} style={{ borderBottom: '1px solid #e2e8f0', position: 'relative' }}>
                                            <td style={{ padding: '0.75rem' }}>{idx + 1}</td>
                                            <td style={{ padding: '0.75rem' }}>
                                                <div style={{ opacity: bt.isInvalid ? 0.5 : 1 }}>{bt.title}</div>
                                                {bt.isInvalid && !bt.title && <div style={{ color: '#ef4444', fontSize: '0.7rem' }}>Required</div>}
                                            </td>
                                            <td style={{ padding: '0.75rem' }}>
                                                <div style={{ opacity: bt.isInvalid ? 0.5 : 1, fontSize: '0.85rem' }}>{bt.description?.substring(0, 50)}...</div>
                                            </td>
                                            <td style={{ padding: '0.75rem', position: 'relative' }}>
                                                {bt.isInvalid && bt.unresolvedUsernames.length > 0 && (
                                                    <div style={{
                                                        position: 'absolute',
                                                        top: '50%',
                                                        left: '0',
                                                        right: '0',
                                                        height: '1px',
                                                        background: '#ef4444',
                                                        transform: 'rotate(-2deg)',
                                                        zIndex: 2,
                                                        pointerEvents: 'none'
                                                    }} />
                                                )}
                                                <div style={{ opacity: bt.isInvalid ? 0.6 : 1 }}>
                                                    {bt.usernamesRaw}
                                                </div>
                                                {bt.unresolvedUsernames.length > 0 && (
                                                    <div style={{ color: '#ef4444', fontSize: '0.7rem', fontWeight: 'bold' }}>
                                                        {t('invalid_username')}: {bt.unresolvedUsernames.join(', ')}
                                                    </div>
                                                )}
                                            </td>
                                            <td style={{ padding: '0.75rem' }}>
                                                <div style={{ opacity: bt.isInvalid ? 0.5 : 1 }}>
                                                    {bt.deadline ? new Date(bt.deadline).toLocaleString(locale) : 'Invalid'}
                                                </div>
                                            </td>
                                            <td style={{ padding: '0.75rem' }}>
                                                <div style={{ minWidth: '150px' }}>
                                                    <LocationSearchInput
                                                        value={{ name: bt.location, link: bt.locationLink || '' }}
                                                        onChange={(val) => {
                                                            const newTasks = [...bulkTasks]
                                                            newTasks[idx].location = val.name
                                                            newTasks[idx].locationLink = val.link
                                                            setBulkTasks(newTasks)
                                                        }}
                                                        placeholder={t('location_name_placeholder')}
                                                        locale={locale}
                                                    />
                                                </div>
                                            </td>
                                            <td style={{ padding: '0.75rem' }}>
                                                <button
                                                    className="button-secondary"
                                                    style={{ color: '#dc2626', padding: '0.25rem 0.5rem' }}
                                                    onClick={() => {
                                                        const newTasks = bulkTasks.filter((_, i) => i !== idx)
                                                        setBulkTasks(newTasks)
                                                        if (newTasks.length === 0) setIsBulkModalOpen(false)
                                                    }}
                                                >
                                                    {t('delete')}
                                                </button>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>

                        <div style={{ display: 'flex', gap: '1rem', justifyContent: 'flex-end' }}>
                            <button
                                className="button-primary"
                                disabled={isSubmitting || bulkTasks.filter(t => !t.isInvalid).length === 0}
                                onClick={async () => {
                                    setIsSubmitting(true)
                                    const validToSubmit = bulkTasks.filter(t => !t.isInvalid).map(bt => ({
                                        title: bt.title,
                                        description: bt.description,
                                        assigneeIds: bt.resolvedIds,
                                        deadline: bt.deadline,
                                        difficulty: bt.difficulty,
                                        location: bt.location ? JSON.stringify({ name: bt.location, link: bt.locationLink || '' }) : ''
                                    }))

                                    try {
                                        const res = await fetch('/api/tasks/bulk', {
                                            method: 'POST',
                                            body: JSON.stringify({ tasks: validToSubmit }),
                                            headers: { 'Content-Type': 'application/json' }
                                        })

                                        if (!res.ok) throw new Error(t('bulk_create_failed'))

                                        showToast(t('bulk_create_success'), 'success')
                                        setIsBulkModalOpen(false)
                                        router.push('/dashboard/tasks')
                                    } catch (err: any) {
                                        showToast(err.message, 'error')
                                    } finally {
                                        setIsSubmitting(false)
                                    }
                                }}
                            >
                                {isSubmitting ? t('processing') : `${t('create_tasks')} (${bulkTasks.filter(t => !t.isInvalid).length})`}
                            </button>
                            <button className="button-secondary" onClick={() => setIsBulkModalOpen(false)}>{t('cancel')}</button>
                        </div>
                        {bulkTasks.some(t => t.isInvalid) && (
                            <div style={{ marginTop: '1rem', color: '#991b1b', fontSize: '0.85rem' }}>
                                * {t('skipped_status')}: {bulkTasks.filter(t => t.isInvalid).length} rows with errors will be skipped.
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* Manage Templates Modal (Super Admin) */}
            {isManageTemplatesOpen && (
                <div style={{
                    position: 'fixed',
                    inset: 0,
                    zIndex: 1000,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    background: 'rgba(0,0,0,0.4)',
                    backdropFilter: 'blur(4px)',
                    padding: '1rem'
                }}>
                    <div className="card" style={{ width: '100%', maxWidth: '500px', padding: '2rem' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
                            <h2 style={{ margin: 0 }}>{t('manage_templates')}</h2>
                            <button className="button-secondary" onClick={() => setIsManageTemplatesOpen(false)}>×</button>
                        </div>

                        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                            <div>
                                <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 'bold' }}>{t('upload_en_template')}</label>
                                <input type="file" accept=".xlsx" onChange={async (e) => {
                                    const file = e.target.files?.[0]
                                    if (file) {
                                        const fd = new FormData()
                                        fd.append('file', file)
                                        fd.append('locale', 'en')
                                        const res = await fetch('/api/templates/upload', { method: 'POST', body: fd })
                                        if (res.ok) showToast('Template uploaded', 'success')
                                    }
                                }} />
                            </div>
                            <div>
                                <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 'bold' }}>{t('upload_ar_template')}</label>
                                <input type="file" accept=".xlsx" onChange={async (e) => {
                                    const file = e.target.files?.[0]
                                    if (file) {
                                        const fd = new FormData()
                                        fd.append('file', file)
                                        fd.append('locale', 'ar')
                                        const res = await fetch('/api/templates/upload', { method: 'POST', body: fd })
                                        if (res.ok) showToast('Template uploaded', 'success')
                                    }
                                }} />
                            </div>
                            <hr style={{ border: 'none', borderTop: '1px solid #e2e8f0' }} />
                            <button
                                className="button-secondary"
                                onClick={() => window.open(`/api/templates/download?locale=${locale}`, '_blank')}
                            >
                                {t('download_current_template')}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}

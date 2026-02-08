'use client'
import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { useRouter } from 'next/navigation'
import { useSession } from 'next-auth/react'
import DateTimePicker from '@/components/DateTimePicker'
import { useLanguage } from '@/context/LanguageContext'
import { useCompany } from '@/context/CompanyContext'
import { useToast } from '@/context/ToastContext'
import LocationSearchInput from '@/components/LocationSearchInput'
import * as XLSX from 'xlsx'

const UKFlag = () => (
    <svg width="24" height="18" viewBox="0 0 32 24" style={{ borderRadius: '2px', verticalAlign: 'middle', marginRight: '10px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
        <rect width="32" height="24" fill="#012169" />
        <path d="M0 0 L32 24 M32 0 L0 24" stroke="#fff" strokeWidth="3" />
        <path d="M0 0 L32 24 M32 0 L0 24" stroke="#C8102E" strokeWidth="1.5" />
        <path d="M16 0 V24 M0 12 H32" stroke="#fff" strokeWidth="5" />
        <path d="M16 0 V24 M0 12 H32" stroke="#C8102E" strokeWidth="3" />
    </svg>
)

const SAFlag = () => (
    <svg width="24" height="18" viewBox="0 0 32 24" style={{ borderRadius: '2px', verticalAlign: 'middle', marginRight: '10px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
        <rect width="32" height="24" fill="#006C35" />
        {/* Simplified but clearer SA sword */}
        <path d="M8 18 H24 M10 18 L12 20 M10 18 L12 16" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
        {/* Simplified Shahada calligraphic curve */}
        <path d="M10 11 Q16 8 22 11" stroke="#fff" strokeWidth="1.2" fill="none" />
    </svg>
)

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
    const [mounted, setMounted] = useState(false)
    const [enTemplateFile, setEnTemplateFile] = useState<File | null>(null)
    const [arTemplateFile, setArTemplateFile] = useState<File | null>(null)
    const [isEnUploading, setIsEnUploading] = useState(false)
    const [isArUploading, setIsArUploading] = useState(false)
    const [bulkTasks, setBulkTasks] = useState<any[]>([])
    const [users, setUsers] = useState<any[]>([])
    const [activeAssigneeEdit, setActiveAssigneeEdit] = useState<{ index: number, type: 'add' | 'remove' } | null>(null)
    const [assigneeSearch, setAssigneeSearch] = useState('')
    const router = useRouter()

    const { showToast } = useToast()

    const { data: session } = useSession()
    const { selectedCompanyId } = useCompany()
    const userRole = (session?.user as any)?.role

    useEffect(() => {
        setMounted(true)
    }, [])

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
            // Attachments removed from creation as per user request

            const res = await fetch('/api/tasks', {
                method: 'POST',
                body: JSON.stringify({
                    title,
                    description,
                    assigneeIds,
                    deadline,
                    difficulty: parseInt(difficulty) || 0,
                    location: location || locationLink ? JSON.stringify({ name: location, link: locationLink }) : '',
                    attachments: []
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
                    const resolvedIds: string[] = []
                    const resolvedNames: string[] = []
                    const unresolvedUsernames: string[] = []

                    for (const uname of usernames) {
                        const user = users.find(u => u.username === uname)
                        if (user) {
                            resolvedIds.push(user.id)
                            resolvedNames.push(`${user.firstName} ${user.lastName}`)
                        } else {
                            unresolvedUsernames.push(uname)
                        }
                    }

                    // Process Deadline (Merge Date and Time)
                    let finalDeadline = ''
                    if (deadlineDateStr) {
                        let baseDate: Date | null = null

                        // 1. Handle Date Part
                        if (typeof deadlineDateStr === 'number') {
                            // Excel serial date
                            const excelDate = new Date((deadlineDateStr - 25569) * 86400 * 1000)
                            baseDate = excelDate
                        } else {
                            const dStr = String(deadlineDateStr).trim()
                            // Try DD/MM/YYYY
                            const dParts = dStr.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/)
                            if (dParts) {
                                baseDate = new Date(Number(dParts[3]), Number(dParts[2]) - 1, Number(dParts[1]))
                            } else {
                                const fallback = new Date(dStr)
                                if (!isNaN(fallback.getTime())) baseDate = fallback
                            }
                        }

                        if (baseDate && !isNaN(baseDate.getTime())) {
                            let hours = 0
                            let minutes = 0

                            // 2. Handle Time Part
                            if (deadlineTimeStr !== undefined && deadlineTimeStr !== null && deadlineTimeStr !== '') {
                                if (typeof deadlineTimeStr === 'number') {
                                    // Excel time decimal (0.5 = 12:00 PM)
                                    const totalSeconds = Math.round(deadlineTimeStr * 24 * 3600)
                                    hours = Math.floor(totalSeconds / 3600)
                                    minutes = Math.floor((totalSeconds % 3600) / 60)
                                } else {
                                    const tStr = String(deadlineTimeStr).trim().toUpperCase()
                                    // Try HH:MM AM/PM or HH:MM
                                    const tParts = tStr.match(/^(\d{1,2}):(\d{1,2})(?:\s*(AM|PM))?$/)
                                    if (tParts) {
                                        hours = Number(tParts[1])
                                        minutes = Number(tParts[2])
                                        const ampm = tParts[3]
                                        if (ampm === 'PM' && hours < 12) hours += 12
                                        if (ampm === 'AM' && hours === 12) hours = 0
                                    }
                                }
                            }

                            baseDate.setHours(hours, minutes, 0, 0)
                            finalDeadline = baseDate.toISOString()
                        }
                    }

                    return {
                        title,
                        description,
                        usernamesRaw,
                        resolvedIds,
                        resolvedNames,
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
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '2rem' }}>
                <h1 style={{ margin: 0 }}>{t('create_new_task')}</h1>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', minWidth: '180px' }}>
                    <button
                        type="button"
                        onClick={() => {
                            if (userRole === 'SUPER_ADMIN') setIsManageTemplatesOpen(true)
                            else window.open(`/api/templates/download?locale=${locale}`, '_blank')
                        }}
                        className="btn"
                        style={{
                            background: 'rgba(255, 255, 255, 0.4)',
                            color: 'var(--text-main)',
                            border: '1px solid var(--glass-border)',
                            backdropFilter: 'blur(8px)',
                            padding: '0.4rem 0.75rem',
                            fontSize: '0.8rem',
                            width: '100%',
                            justifyContent: 'flex-start'
                        }}
                    >
                        <span style={{ fontSize: '1rem' }}>📥</span>
                        {t('download_template')}
                    </button>
                    <div style={{ display: 'flex', gap: '0.5rem' }}>
                        <label
                            className="btn btn-primary"
                            style={{
                                cursor: 'pointer',
                                padding: '0.4rem 0.75rem',
                                fontSize: '0.8rem',
                                flex: 1,
                                justifyContent: 'flex-start'
                            }}
                        >
                            <span style={{ fontSize: '1rem' }}>📤</span>
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
                        <button
                            type="button"
                            onClick={() => window.open('/dashboard/all-users/usernames', '_blank')}
                            className="btn"
                            title={t('view_usernames')}
                            style={{
                                background: '#3b82f6',
                                color: 'white',
                                border: 'none',
                                padding: '0.4rem 0.75rem',
                                fontSize: '0.9rem',
                                fontWeight: 'bold',
                                borderRadius: '0.5rem',
                                cursor: 'pointer',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                width: '40px'
                            }}
                        >
                            @
                        </button>
                    </div>
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
            {mounted && isBulkModalOpen && createPortal(
                <div className="modal-overlay" style={{ zIndex: 10000 }}>
                    <div className="modal-content glass" style={{
                        width: '95%',
                        maxWidth: '1300px',
                        maxHeight: '90vh',
                        display: 'flex',
                        flexDirection: 'column'
                    }}>
                        <div className="modal-header">
                            <h2 className="modal-title">{t('bulk_review_title')}</h2>
                            <button className="modal-close" onClick={() => setIsBulkModalOpen(false)}>×</button>
                        </div>

                        <div className="modal-body" style={{ overflowY: 'auto', flex: 1, padding: '1.5rem' }}>
                            <div style={{ overflowX: 'auto', borderRadius: '1rem', border: '1px solid var(--glass-border)' }}>
                                <table style={{ width: '100%', borderCollapse: 'collapse', background: 'rgba(255, 255, 255, 0.4)' }}>
                                    <thead>
                                        <tr style={{ background: 'rgba(255, 255, 255, 0.6)', borderBottom: '2px solid var(--glass-border)' }}>
                                            <th style={{ padding: '1rem', textAlign: locale === 'ar' ? 'right' : 'left' }}>#</th>
                                            <th style={{ padding: '1rem', textAlign: locale === 'ar' ? 'right' : 'left' }}>{t('title')}</th>
                                            <th style={{ padding: '1rem', textAlign: locale === 'ar' ? 'right' : 'left' }}>{t('description_label' as any)}</th>
                                            <th style={{ padding: '1rem', textAlign: locale === 'ar' ? 'right' : 'left' }}>{t('assignees_label')}</th>
                                            <th style={{ padding: '1rem', textAlign: locale === 'ar' ? 'right' : 'left' }}>{t('deadline_label')}</th>
                                            <th style={{ padding: '1rem', textAlign: locale === 'ar' ? 'right' : 'left' }}>{t('location_name_label')}</th>
                                            <th style={{ padding: '1rem', textAlign: locale === 'ar' ? 'right' : 'left' }}>{t('actions_label')}</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {bulkTasks.map((bt, idx) => (
                                            <tr key={idx} style={{
                                                borderBottom: '1px solid var(--glass-border)',
                                                background: bt.isInvalid ? 'rgba(239, 68, 68, 0.05)' : 'transparent',
                                                transition: 'background 0.3s'
                                            }}>
                                                <td style={{ padding: '1rem' }}>{idx + 1}</td>
                                                <td style={{ padding: '1rem' }}>
                                                    <div style={{
                                                        opacity: bt.isInvalid ? 0.5 : 1,
                                                        textDecoration: bt.isInvalid && !bt.title ? 'line-through' : 'none'
                                                    }}>
                                                        {bt.title || t('missing_title' as any)}
                                                    </div>
                                                </td>
                                                <td style={{ padding: '1rem' }}>
                                                    <div style={{ opacity: bt.isInvalid ? 0.5 : 1, fontSize: '0.85rem' }}>
                                                        {bt.description?.substring(0, 50)}...
                                                    </div>
                                                </td>
                                                <td style={{ padding: '1rem', position: 'relative' }}>
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', minWidth: '250px' }}>
                                                        <div style={{
                                                            flex: 1,
                                                            opacity: bt.isInvalid ? 0.6 : 1,
                                                            color: bt.unresolvedUsernames.length > 0 ? '#ef4444' : 'inherit',
                                                            fontSize: '0.85rem',
                                                            background: 'rgba(255, 255, 255, 0.2)',
                                                            padding: '0.5rem',
                                                            borderRadius: '0.5rem',
                                                            border: '1px solid var(--glass-border)',
                                                            minHeight: '40px',
                                                            display: 'flex',
                                                            alignItems: 'center'
                                                        }}>
                                                            {bt.resolvedNames && bt.resolvedNames.length > 0 ? bt.resolvedNames.join(', ') : bt.usernamesRaw || t('no_assignees')}
                                                        </div>

                                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                                                            {/* Plus Button */}
                                                            <button
                                                                onClick={() => {
                                                                    setActiveAssigneeEdit(activeAssigneeEdit?.index === idx && activeAssigneeEdit?.type === 'add' ? null : { index: idx, type: 'add' })
                                                                    setAssigneeSearch('')
                                                                }}
                                                                style={{
                                                                    width: '28px',
                                                                    height: '28px',
                                                                    borderRadius: '50%',
                                                                    border: '1px solid var(--glass-border)',
                                                                    background: 'rgba(255, 255, 255, 0.4)',
                                                                    backdropFilter: 'blur(8px)',
                                                                    display: 'flex',
                                                                    alignItems: 'center',
                                                                    justifyContent: 'center',
                                                                    cursor: 'pointer',
                                                                    fontSize: '1.2rem',
                                                                    fontWeight: 'bold',
                                                                    color: '#3b82f6',
                                                                    transition: 'all 0.2s'
                                                                }}
                                                                onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255, 255, 255, 0.6)'; e.currentTarget.style.transform = 'scale(1.1)'; }}
                                                                onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(255, 255, 255, 0.4)'; e.currentTarget.style.transform = 'scale(1)'; }}
                                                            >
                                                                +
                                                            </button>

                                                            {/* Minus Button */}
                                                            <button
                                                                onClick={() => setActiveAssigneeEdit(activeAssigneeEdit?.index === idx && activeAssigneeEdit?.type === 'remove' ? null : { index: idx, type: 'remove' })}
                                                                style={{
                                                                    width: '28px',
                                                                    height: '28px',
                                                                    borderRadius: '50%',
                                                                    border: '1px solid var(--glass-border)',
                                                                    background: 'rgba(255, 255, 255, 0.4)',
                                                                    backdropFilter: 'blur(8px)',
                                                                    display: 'flex',
                                                                    alignItems: 'center',
                                                                    justifyContent: 'center',
                                                                    cursor: 'pointer',
                                                                    fontSize: '1.2rem',
                                                                    fontWeight: 'bold',
                                                                    color: '#ef4444',
                                                                    transition: 'all 0.2s'
                                                                }}
                                                                onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255, 255, 255, 0.6)'; e.currentTarget.style.transform = 'scale(1.1)'; }}
                                                                onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(255, 255, 255, 0.4)'; e.currentTarget.style.transform = 'scale(1)'; }}
                                                            >
                                                                -
                                                            </button>
                                                        </div>
                                                    </div>

                                                    {/* Dropdowns/Popups */}
                                                    {activeAssigneeEdit?.index === idx && (
                                                        <>
                                                            <div
                                                                onClick={() => setActiveAssigneeEdit(null)}
                                                                style={{
                                                                    position: 'fixed',
                                                                    top: 0,
                                                                    left: 0,
                                                                    right: 0,
                                                                    bottom: 0,
                                                                    zIndex: 99,
                                                                    background: 'transparent',
                                                                    cursor: 'default'
                                                                }}
                                                            />
                                                            <div style={{
                                                                position: 'absolute',
                                                                top: '50%',
                                                                right: '4rem',
                                                                transform: 'translateY(-50%)',
                                                                zIndex: 100,
                                                                minWidth: '240px',
                                                                background: 'rgba(255, 255, 255, 0.95)',
                                                                backdropFilter: 'blur(12px)',
                                                                border: '1px solid var(--glass-border)',
                                                                borderRadius: '0.75rem',
                                                                boxShadow: '0 10px 15px -3px rgba(0,0,0,0.1)',
                                                                padding: '0.5rem',
                                                                animation: 'fadeIn 0.2s ease-out'
                                                            }}>
                                                                {activeAssigneeEdit.type === 'add' ? (
                                                                    // Add Dropdown
                                                                    <div>
                                                                        <div style={{ padding: '0.25rem 0.25rem 0.5rem 0.25rem', borderBottom: '1px solid #e2e8f0', marginBottom: '0.5rem' }}>
                                                                            <input
                                                                                autoFocus
                                                                                type="text"
                                                                                placeholder={t('search_placeholder')}
                                                                                value={assigneeSearch}
                                                                                onChange={(e) => setAssigneeSearch(e.target.value)}
                                                                                style={{
                                                                                    width: '100%',
                                                                                    padding: '0.4rem 0.6rem',
                                                                                    fontSize: '0.8rem',
                                                                                    borderRadius: '0.5rem',
                                                                                    border: '1px solid #e2e8f0',
                                                                                    outline: 'none',
                                                                                    background: '#f8fafc',
                                                                                    textAlign: locale === 'ar' ? 'right' : 'left'
                                                                                }}
                                                                            />
                                                                        </div>
                                                                        <div style={{ maxHeight: '180px', overflowY: 'auto' }}>
                                                                            {users
                                                                                .filter(u => !bt.resolvedIds.includes(u.id))
                                                                                .filter(u =>
                                                                                    `${u.firstName} ${u.lastName}`.toLowerCase().includes(assigneeSearch.toLowerCase())
                                                                                )
                                                                                .map(u => (
                                                                                    <div
                                                                                        key={u.id}
                                                                                        onClick={() => {
                                                                                            const newTasks = [...bulkTasks]
                                                                                            newTasks[idx].resolvedIds = [...bt.resolvedIds, u.id]
                                                                                            newTasks[idx].resolvedNames = [...bt.resolvedNames, `${u.firstName} ${u.lastName}`]
                                                                                            newTasks[idx].unresolvedUsernames = []
                                                                                            newTasks[idx].isInvalid = !bt.title || !bt.description || !bt.deadline
                                                                                            setBulkTasks(newTasks)
                                                                                            // Don't close pop-up as per request
                                                                                        }}
                                                                                        style={{
                                                                                            padding: '0.5rem',
                                                                                            fontSize: '0.85rem',
                                                                                            cursor: 'pointer',
                                                                                            borderRadius: '0.375rem',
                                                                                            transition: 'background 0.2s',
                                                                                            textAlign: locale === 'ar' ? 'right' : 'left'
                                                                                        }}
                                                                                        onMouseEnter={(e) => e.currentTarget.style.background = '#f1f5f9'}
                                                                                        onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                                                                                    >
                                                                                        <div style={{ fontWeight: '600' }}>{u.firstName} {u.lastName}</div>
                                                                                        <div style={{ fontSize: '0.7rem', color: '#94a3b8' }}>{t(`role_${u.role?.toLowerCase()}` as any)}</div>
                                                                                    </div>
                                                                                ))}
                                                                            {users.filter(u => !bt.resolvedIds.includes(u.id) && `${u.firstName} ${u.lastName}`.toLowerCase().includes(assigneeSearch.toLowerCase())).length === 0 && (
                                                                                <div style={{ padding: '1rem', textAlign: 'center', fontSize: '0.8rem', color: '#94a3b8' }}>{t('no_matches_found')}</div>
                                                                            )}
                                                                        </div>
                                                                    </div>
                                                                ) : (
                                                                    // Remove Popup
                                                                    <div>
                                                                        <div style={{ fontSize: '0.75rem', fontWeight: 'bold', color: '#64748b', padding: '0.25rem 0.5rem', borderBottom: '1px solid #e2e8f0', marginBottom: '0.25rem', textAlign: locale === 'ar' ? 'right' : 'left' }}>
                                                                            {t('remove_assignee')}
                                                                        </div>
                                                                        <div style={{ maxHeight: '180px', overflowY: 'auto' }}>
                                                                            {bt.resolvedIds.map((id: string, ridx: number) => (
                                                                                <div
                                                                                    key={id}
                                                                                    style={{
                                                                                        display: 'flex',
                                                                                        justifyContent: 'space-between',
                                                                                        alignItems: 'center',
                                                                                        padding: '0.5rem',
                                                                                        fontSize: '0.85rem',
                                                                                        borderRadius: '0.375rem',
                                                                                        flexDirection: locale === 'ar' ? 'row-reverse' : 'row'
                                                                                    }}
                                                                                >
                                                                                    <span style={{ fontWeight: '500' }}>{bt.resolvedNames[ridx]}</span>
                                                                                    <button
                                                                                        onClick={() => {
                                                                                            const newTasks = [...bulkTasks]
                                                                                            const nid = bt.resolvedIds.filter((_: any, i: number) => i !== ridx)
                                                                                            const nname = bt.resolvedNames.filter((_: any, i: number) => i !== ridx)
                                                                                            newTasks[idx].resolvedIds = nid
                                                                                            newTasks[idx].resolvedNames = nname
                                                                                            newTasks[idx].isInvalid = nid.length === 0 || !bt.title || !bt.description || !bt.deadline
                                                                                            setBulkTasks(newTasks)
                                                                                            // Pop-up stays open as requested
                                                                                        }}
                                                                                        style={{
                                                                                            border: 'none',
                                                                                            background: '#fee2e2',
                                                                                            color: '#ef4444',
                                                                                            borderRadius: '50%',
                                                                                            width: '20px',
                                                                                            height: '20px',
                                                                                            display: 'flex',
                                                                                            alignItems: 'center',
                                                                                            justifyContent: 'center',
                                                                                            cursor: 'pointer',
                                                                                            fontSize: '0.9rem'
                                                                                        }}
                                                                                    >
                                                                                        ×
                                                                                    </button>
                                                                                </div>
                                                                            ))}
                                                                            {bt.resolvedIds.length === 0 && (
                                                                                <div style={{ padding: '1rem', textAlign: 'center', fontSize: '0.8rem', color: '#94a3b8' }}>{t('no_assignees')}</div>
                                                                            )}
                                                                        </div>
                                                                    </div>
                                                                )}
                                                            </div>
                                                        </>
                                                    )}

                                                    {bt.unresolvedUsernames.length > 0 && (
                                                        <div style={{ color: '#ef4444', fontSize: '0.7rem', fontWeight: 'bold', marginTop: '0.25rem' }}>
                                                            {t('invalid_username')}: {bt.unresolvedUsernames.join(', ')}
                                                        </div>
                                                    )}
                                                </td>
                                                <td style={{ padding: '1rem' }}>
                                                    <div style={{ opacity: bt.isInvalid ? 0.5 : 1 }}>
                                                        {bt.deadline ? new Date(bt.deadline).toLocaleString(locale) : t('invalid_date' as any)}
                                                    </div>
                                                </td>
                                                <td style={{ padding: '1rem' }}>
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
                                                <td style={{ padding: '1rem' }}>
                                                    <button
                                                        className="btn"
                                                        style={{
                                                            padding: '0.4rem 0.8rem',
                                                            background: 'rgba(239, 68, 68, 0.1)',
                                                            color: '#dc2626',
                                                            borderRadius: '0.75rem'
                                                        }}
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
                        </div>

                        <div className="modal-footer" style={{ borderTop: '1px solid var(--glass-border)', background: 'rgba(255, 255, 255, 0.3)' }}>
                            <div style={{ flex: 1 }}>
                                {bulkTasks.some(t => t.isInvalid) && (
                                    <div style={{ color: '#991b1b', fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                        <span style={{ fontSize: '1.1rem' }}>⚠️</span>
                                        {t('skipped_status')}: {bulkTasks.filter(t => t.isInvalid).length} {t('rows_with_errors' as any)}
                                    </div>
                                )}
                            </div>
                            <button className="btn" onClick={() => setIsBulkModalOpen(false)} style={{ background: 'rgba(0,0,0,0.05)' }}>
                                {t('cancel')}
                            </button>
                            <button
                                className="btn btn-primary"
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

                                        if (!res.ok) {
                                            const errorData = await res.json().catch(() => ({}))
                                            throw new Error(errorData.message || t('bulk_create_failed'))
                                        }

                                        showToast(t('bulk_create_success'), 'success')
                                        setIsBulkModalOpen(false)
                                        router.push('/dashboard/tasks')
                                    } catch (err: any) {
                                        showToast(err.message, 'error')
                                    } finally {
                                        setIsSubmitting(false)
                                    }
                                }}
                                style={{ minWidth: '160px' }}
                            >
                                {isSubmitting ? t('processing') : (
                                    <>
                                        <span>✨</span>
                                        {t('create_tasks')} ({bulkTasks.filter(t => !t.isInvalid).length})
                                    </>
                                )}
                            </button>
                        </div>
                    </div>
                </div>,
                document.body
            )}

            {/* Manage Templates Modal (Super Admin) */}
            {mounted && isManageTemplatesOpen && createPortal(
                <div className="modal-overlay" style={{ zIndex: 10000 }}>
                    <div className="modal-content glass" style={{ width: '90%', maxWidth: '550px' }}>
                        <div className="modal-header">
                            <h2 className="modal-title">{t('manage_templates')}</h2>
                            <button className="modal-close" onClick={() => {
                                setIsManageTemplatesOpen(false)
                                setEnTemplateFile(null)
                                setArTemplateFile(null)
                            }}>×</button>
                        </div>

                        <div className="modal-body">
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
                                <div className="glass" style={{ padding: '1.25rem', background: 'rgba(255, 255, 255, 0.3)' }}>
                                    <label style={{ display: 'flex', alignItems: 'center', marginBottom: '1rem', fontWeight: '600', color: 'var(--text-main)' }}>
                                        <UKFlag /> {t('upload_en_template')}
                                    </label>
                                    <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
                                        <label className="btn" style={{
                                            flex: 1,
                                            cursor: 'pointer',
                                            background: 'rgba(255, 255, 255, 0.6)',
                                            fontSize: '0.85rem',
                                            justifyContent: 'flex-start',
                                            overflow: 'hidden',
                                            textOverflow: 'ellipsis',
                                            whiteSpace: 'nowrap'
                                        }}>
                                            <span>📂</span>
                                            {enTemplateFile ? enTemplateFile.name : t('choose_file')}
                                            <input
                                                type="file"
                                                accept=".xlsx"
                                                style={{ display: 'none' }}
                                                onChange={(e) => setEnTemplateFile(e.target.files?.[0] || null)}
                                            />
                                        </label>
                                        {enTemplateFile && (
                                            <button
                                                className="btn btn-primary"
                                                style={{ padding: '0.5rem 1rem', fontSize: '0.85rem', minWidth: '100px' }}
                                                disabled={isEnUploading}
                                                onClick={async () => {
                                                    setIsEnUploading(true)
                                                    const fd = new FormData()
                                                    fd.append('file', enTemplateFile)
                                                    fd.append('locale', 'en')
                                                    try {
                                                        const res = await fetch('/api/templates/upload', { method: 'POST', body: fd })
                                                        const result = await res.json().catch(() => ({}))
                                                        if (res.ok) {
                                                            showToast('English Template Updated', 'success')
                                                            setEnTemplateFile(null)
                                                        } else {
                                                            showToast(result.message || 'Upload Failed', 'error')
                                                        }
                                                    } catch {
                                                        showToast('Upload Error', 'error')
                                                    } finally {
                                                        setIsEnUploading(false)
                                                    }
                                                }}
                                            >
                                                {isEnUploading ? <div className="spinner-small" style={{ width: '16px', height: '16px' }} /> : 'Upload'}
                                            </button>
                                        )}
                                    </div>
                                </div>

                                <div className="glass" style={{ padding: '1.25rem', background: 'rgba(255, 255, 255, 0.3)' }}>
                                    <label style={{ display: 'flex', alignItems: 'center', marginBottom: '1rem', fontWeight: '600', color: 'var(--text-main)' }}>
                                        <SAFlag /> {t('upload_ar_template')}
                                    </label>
                                    <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
                                        <label className="btn" style={{
                                            flex: 1,
                                            cursor: 'pointer',
                                            background: 'rgba(255, 255, 255, 0.6)',
                                            fontSize: '0.85rem',
                                            justifyContent: 'flex-start',
                                            overflow: 'hidden',
                                            textOverflow: 'ellipsis',
                                            whiteSpace: 'nowrap'
                                        }}>
                                            <span>📂</span>
                                            {arTemplateFile ? arTemplateFile.name : t('choose_file')}
                                            <input
                                                type="file"
                                                accept=".xlsx"
                                                style={{ display: 'none' }}
                                                onChange={(e) => setArTemplateFile(e.target.files?.[0] || null)}
                                            />
                                        </label>
                                        {arTemplateFile && (
                                            <button
                                                className="btn btn-primary"
                                                style={{ padding: '0.5rem 1rem', fontSize: '0.85rem', minWidth: '100px' }}
                                                disabled={isArUploading}
                                                onClick={async () => {
                                                    setIsArUploading(true)
                                                    const fd = new FormData()
                                                    fd.append('file', arTemplateFile)
                                                    fd.append('locale', 'ar')
                                                    try {
                                                        const res = await fetch('/api/templates/upload', { method: 'POST', body: fd })
                                                        const result = await res.json().catch(() => ({}))
                                                        if (res.ok) {
                                                            showToast('Arabic Template Updated', 'success')
                                                            setArTemplateFile(null)
                                                        } else {
                                                            showToast(result.message || 'Upload Failed', 'error')
                                                        }
                                                    } catch {
                                                        showToast('Upload Error', 'error')
                                                    } finally {
                                                        setIsArUploading(false)
                                                    }
                                                }}
                                            >
                                                {isArUploading ? <div className="spinner-small" style={{ width: '16px', height: '16px' }} /> : 'Upload'}
                                            </button>
                                        )}
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div className="modal-footer" style={{ background: 'rgba(0, 0, 0, 0.03)' }}>
                            <button
                                className="btn"
                                style={{
                                    background: 'rgba(255, 255, 255, 0.6)',
                                    border: '1px solid var(--glass-border)',
                                    flex: 1
                                }}
                                onClick={() => window.open(`/api/templates/download?locale=${locale}`, '_blank')}
                            >
                                📥 {t('download_current_template')}
                            </button>
                            <button className="btn btn-primary" onClick={() => {
                                setIsManageTemplatesOpen(false)
                                setEnTemplateFile(null)
                                setArTemplateFile(null)
                            }} style={{ flex: 1 }}>
                                {t('cancel')}
                            </button>
                        </div>
                    </div>
                </div>,
                document.body
            )}
        </div>
    )
}

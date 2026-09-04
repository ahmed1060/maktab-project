'use client'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useSession } from 'next-auth/react'
import DateTimePicker from '@/components/DateTimePicker'
import { useLanguage } from '@/context/LanguageContext'
import { useCompany } from '@/context/CompanyContext'
import { useToast } from '@/context/ToastContext'
import LocationSearchInput from '@/components/LocationSearchInput'
import BulkTaskReviewModal from '@/components/BulkTaskReviewModal'
import ManageTemplatesModal from '@/components/ManageTemplatesModal'
// F-20: xlsx (SheetJS) is on a version with an unfixable-from-npm CVE
// (prototype pollution + ReDoS in the parser) — SheetJS stopped publishing
// patched releases to npm. exceljs is maintained and gets normal npm
// updates, but is a noticeably heavier bundle — imported dynamically in
// handleBulkUpload below so it only loads when a file is actually chosen,
// not on every visit to this page.
import { cellToPrimitive } from '@/lib/xlsx-cell'

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
                const usersList = data.data?.data || data.data || []
                if (!Array.isArray(usersList)) {
                    console.error('Invalid users data received:', data)
                    setUsers([])
                    return
                }
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
                const errorMessage = data.error || data.details || data.message || `${t('error_generic')} (${res.status})`
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
        const { Workbook } = await import('exceljs')
        const arrayBuffer = await file.arrayBuffer()
        const workbook = new Workbook()
        await workbook.xlsx.load(arrayBuffer)
        const worksheet = workbook.worksheets[0]

        if (worksheet) {
            // Mirror XLSX.utils.sheet_to_json(worksheet, { header: 1 }): one
            // array per row, 0-indexed columns, raw cell values. exceljs's
            // row.values is 1-indexed with index 0 always undefined, and rows
            // are 1-indexed too (no row 0) — accounted for by both slice(1)
            // below and by rows/jsonData already being built in sheet order.
            const jsonData: any[] = []
            worksheet.eachRow({ includeEmpty: true }, (row) => {
                const values = Array.isArray(row.values) ? row.values.slice(1) : []
                jsonData.push(values.map(cellToPrimitive))
            })

            // Process data starting from Row 3 (index 2)
            const rows = jsonData.slice(2).filter(row => row[0]) // row[0] is Title

            if (rows.length > 50) {
                showToast(t('bulk_limit_exceeded'), 'error')
                return
            }

            const tasks = rows.map(row => {
                const title = row[0] || ''
                const description = row[1] || ''
                const usernamesRaw = row[2] ? String(row[2]) : ''
                const deadlineDateStr = row[3] // Column D
                const deadlineTimeStr = row[4] // Column E
                const diffPoints = parseInt(row[5]) || 0 // Column F

                const validationErrors: Record<string, string[]> = {}
                const addError = (field: string, msg: string) => {
                    if (!validationErrors[field]) validationErrors[field] = []
                    validationErrors[field].push(msg)
                }

                // 1. Resolve usernames to IDs
                const usernames = usernamesRaw.split(',').map(u => u.trim()).filter(u => u)
                const resolvedIds: string[] = []
                const resolvedNames: string[] = []
                const unresolvedUsernames: string[] = []

                if (usernames.length === 0) addError('assignees', t('no_assignees' as any) || 'Missing assignees')

                for (const uname of usernames) {
                    const user = users.find(u => u.username?.toLowerCase() === uname.toLowerCase())
                    if (user) {
                        resolvedIds.push(user.id)
                        resolvedNames.push(`${user.firstName} ${user.lastName}`)
                    } else {
                        unresolvedUsernames.push(uname)
                    }
                }
                if (unresolvedUsernames.length > 0) addError('assignees', `${t('invalid_username' as any) || 'Invalid user'}: ${unresolvedUsernames.join(', ')}`)

                // 2. Process Deadline
                let finalDeadline = ''
                if (deadlineDateStr) {
                    let baseDate: Date | null = null
                    if (deadlineDateStr instanceof Date) {
                        // exceljs (unlike xlsx without cellDates:true) returns a
                        // native Date for a date-formatted cell rather than the
                        // raw Excel serial number.
                        baseDate = new Date(deadlineDateStr.getTime())
                    } else if (typeof deadlineDateStr === 'number') {
                        const excelDate = new Date((deadlineDateStr - 25569) * 86400 * 1000)
                        baseDate = excelDate
                    } else {
                        const dStr = String(deadlineDateStr).trim()
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
                        if (deadlineTimeStr !== undefined && deadlineTimeStr !== null && deadlineTimeStr !== '') {
                            if (deadlineTimeStr instanceof Date) {
                                // Same exceljs-vs-xlsx difference as the date column above.
                                hours = deadlineTimeStr.getUTCHours()
                                minutes = deadlineTimeStr.getUTCMinutes()
                            } else if (typeof deadlineTimeStr === 'number') {
                                const totalSeconds = Math.round(deadlineTimeStr * 24 * 3600)
                                hours = Math.floor(totalSeconds / 3600)
                                minutes = Math.floor((totalSeconds % 3600) / 60)
                            } else {
                                const tStr = String(deadlineTimeStr).trim().toUpperCase()
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

                        const minDeadline = new Date(Date.now() + 3 * 60 * 60 * 1000)
                        if (baseDate < minDeadline) addError('deadline', t('deadline_too_soon' as any) || 'Deadline must be at least 3h from now')
                    } else {
                        addError('deadline', t('invalid_date' as any) || 'Invalid date')
                    }
                } else {
                    addError('deadline', t('missing_deadline' as any) || 'Missing deadline')
                }

                // 3. String Lengths
                if (title.length < 3) addError('title', t('title_too_short' as any) || 'Title too short')
                if (title.length > 100) addError('title', t('title_too_long' as any) || 'Title too long')
                if (description.length < 10) addError('description', t('desc_too_short' as any) || 'Description too short')
                if (description.length > 1000) addError('description', t('desc_too_long' as any) || 'Description too long')

                // 4. Difficulty
                if (diffPoints < 0 || diffPoints > 10) addError('difficulty', t('invalid_difficulty' as any) || 'Difficulty must be 0-10')

                return {
                    title,
                    description,
                    usernamesRaw,
                    resolvedIds,
                    resolvedNames,
                    unresolvedUsernames,
                    deadline: finalDeadline,
                    difficulty: diffPoints,
                    location: '',
                    validationErrors,
                    isInvalid: Object.keys(validationErrors).length > 0
                }
            })

            if (tasks.length === 0) {
                showToast(t('no_data_available'), 'error')
                return
            }

            setBulkTasks(tasks)
            setIsBulkModalOpen(true)
        } else {
            showToast(t('no_data_available'), 'error')
        }
    }

    const revalidateRow = (task: any) => {
        const errors: Record<string, string[]> = {}
        const addError = (f: string, m: string) => {
            if (!errors[f]) errors[f] = []
            errors[f].push(m)
        }

        if (task.title.length < 3) addError('title', t('title_too_short'))
        if (task.title.length > 100) addError('title', t('title_too_long'))
        if (task.description.length < 10) addError('description', t('desc_too_short'))
        if (task.description.length > 1000) addError('description', t('desc_too_long'))

        if (task.resolvedIds.length === 0) {
            addError('assignees', t('no_assignees'))
        }

        if (task.deadline) {
            const date = new Date(task.deadline)
            const min = new Date(Date.now() + 3 * 60 * 60 * 1000)
            if (isNaN(date.getTime())) addError('deadline', t('invalid_date'))
            else if (date < min) addError('deadline', t('deadline_too_soon'))
        } else {
            addError('deadline', t('missing_deadline'))
        }

        if (task.difficulty < 0 || task.difficulty > 10) {
            addError('difficulty', t('invalid_difficulty'))
        }

        return {
            ...task,
            validationErrors: errors,
            isInvalid: Object.keys(errors).length > 0
        }
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
                        <button
                            type="button"
                            onClick={() => window.open('/dashboard/usernames', '_blank')}
                            title={t('view_usernames')}
                            style={{
                                background: 'rgba(255, 255, 255, 0.15)',
                                color: '#1e293b',
                                border: '2.5px solid white',
                                padding: '0',
                                borderRadius: '50%',
                                cursor: 'pointer',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                width: '46px',
                                height: '46px',
                                transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
                                boxShadow: '0 4px 15px rgba(0, 0, 0, 0.05)',
                                backdropFilter: 'blur(4px)'
                            }}
                            onMouseOver={(e) => {
                                e.currentTarget.style.transform = 'scale(1.1) rotate(5deg)';
                                e.currentTarget.style.background = 'rgba(255, 255, 255, 0.3)';
                                e.currentTarget.style.boxShadow = '0 8px 25px rgba(0, 0, 0, 0.1)';
                            }}
                            onMouseOut={(e) => {
                                e.currentTarget.style.transform = 'scale(1) rotate(0deg)';
                                e.currentTarget.style.background = 'rgba(255, 255, 255, 0.15)';
                                e.currentTarget.style.boxShadow = '0 4px 15px rgba(0, 0, 0, 0.05)';
                            }}
                        >
                            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                                <circle cx="12" cy="7" r="4" />
                            </svg>
                        </button>
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

            <BulkTaskReviewModal
                isOpen={isBulkModalOpen}
                onClose={() => setIsBulkModalOpen(false)}
                bulkTasks={bulkTasks}
                setBulkTasks={setBulkTasks}
                users={users}
                revalidateRow={revalidateRow}
                isSubmitting={isSubmitting}
                setIsSubmitting={setIsSubmitting}
            />

            <ManageTemplatesModal
                isOpen={isManageTemplatesOpen}
                onClose={() => setIsManageTemplatesOpen(false)}
            />

        </div >
    )
}

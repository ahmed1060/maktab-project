'use client'
import { useState, useMemo, useRef, useEffect } from 'react'
import useSWR from 'swr'
import { fetcher } from '@/lib/swr-fetcher'
import { useRouter } from 'next/navigation'
import { useSession } from 'next-auth/react'
import DateTimePicker from '@/components/DateTimePicker'
import { useLanguage } from '@/context/LanguageContext'
import { useCompany } from '@/context/CompanyContext'
import { useToast } from '@/context/ToastContext'
import TaskPlacePicker, { type TaskPlace } from '@/components/locations/TaskPlacePicker'
import { NamePicker } from '@/components/ui'
import { TASK_TITLE_MAX, TASK_DESCRIPTION_MAX, TASK_FIELDS } from '@/lib/new-task'
import { firstError } from '@/lib/form-errors'
import AssigneeChecklist from '@/components/forms/AssigneeChecklist'
import { pickIn, type CompanyPick } from '@/lib/saved-lists'
import { useListNames } from '@/components/lists/useListNames'
import { locationProblem, rowLocation, sheetLocations, type BulkPlace } from '@/lib/bulk-locations'
import type { TranslationKey } from '@/lib/translations'
import BulkTaskReviewModal from '@/components/BulkTaskReviewModal'
import ManageTemplatesModal from '@/components/ManageTemplatesModal'
// F-20: xlsx (SheetJS) is on a version with an unfixable-from-npm CVE
// (prototype pollution + ReDoS in the parser) — SheetJS stopped publishing
// patched releases to npm. exceljs is maintained and gets normal npm
// updates, but is a noticeably heavier bundle — imported dynamically in
// handleBulkUpload below so it only loads when a file is actually chosen,
// not on every visit to this page.
import { cellToPrimitive } from '@/lib/xlsx-cell'
import { useNow } from '@/lib/useNow'
import { earliestDeadline } from '@/lib/deadline'
import { useCan } from '@/lib/useCan'
import { useModules } from '@/lib/useModules'
import { DownloadSimpleIcon, IdentificationCardIcon, UploadSimpleIcon } from '@phosphor-icons/react/ssr'
import { Button, ButtonLink, Card, Field, Page, PageHeader, TextArea, TextInput } from '@/components/ui'

const NO_CLIENTS: any[] = []

export default function NewTaskPage() {
    const { t, locale } = useLanguage()
    const modules = useModules()
    // The deadline floor offered to the picker, kept current while the form
    // stays open. See lib/useNow.ts.
    const now = useNow()
    // Its title as typed, and the name it was picked as from the list
    // (CLIENTS_PLAN.md §5), in the company it was picked in.
    const [titlePick, setTitlePick] = useState<CompanyPick>({ name: { text: '', entryId: null }, company: null })
    const [description, setDescription] = useState('')
    const [assigneeIds, setAssigneeIds] = useState<string[]>([])
    const [deadline, setDeadline] = useState('')
    const [difficulty, setDifficulty] = useState('')
    const [place, setPlace] = useState<TaskPlace>({ clientId: '', locationId: '' })
    const [isBulkModalOpen, setIsBulkModalOpen] = useState(false)
    const [isManageTemplatesOpen, setIsManageTemplatesOpen] = useState(false)
    const [bulkTasks, setBulkTasks] = useState<any[]>([])
    // The company's locations in use, for the upload's rows (CLIENTS_PLAN.md §2.7).
    const [bulkPlaces, setBulkPlaces] = useState<BulkPlace[]>([])
    const router = useRouter()

    const { showToast } = useToast()

    const { data: session } = useSession()
    const { selectedCompanyId } = useCompany()
    const titleNames = useListNames('TASK_TITLE', selectedCompanyId)
    const titleName = pickIn(titlePick, selectedCompanyId)
    const title = titleName.text
    const userRole = (session?.user as any)?.role
    // The permission GET /api/clients checks: the bulk upload's rows are
    // matched to clients by name only for someone who may read the list.
    const canUseClients = useCan().can('clients.view')

    // Who can be assigned. SWR, keyed by the company a Super Admin is looking
    // at, so switching company cannot leave the previous company's people in
    // the picker if that answer arrives last.
    const usersKey = session
        ? `/api/users?${new URLSearchParams({ limit: '1000', ...(selectedCompanyId ? { companyId: selectedCompanyId } : {}) })}`
        : null
    const { data: usersResult, error: usersError } = useSWR(usersKey, fetcher)
    const users: any[] = useMemo(() => {
        const usersList = usersResult?.data?.data || usersResult?.data || []
        if (!Array.isArray(usersList)) {
            console.error('Invalid users data received:', usersResult)
            return []
        }
        const rolePriority: { [key: string]: number } = {
            'EMPLOYEE': 1,
            'TEAM_LEADER': 2,
            'ADMIN': 3,
            'SUPER_ADMIN': 4
        }
        // Sort by role: EMPLOYEE -> TEAM_LEADER -> ADMIN -> SUPER_ADMIN, then
        // by name. On a copy: the array belongs to SWR's cache.
        return [...usersList].sort((a: any, b: any) => {
            const priorityA = rolePriority[a.role] || 99
            const priorityB = rolePriority[b.role] || 99
            if (priorityA !== priorityB) return priorityA - priorityB
            return a.firstName.localeCompare(b.firstName)
        })
        // No filtering here any more.
        //
        // This used to hide Admins from a Team Leader's list, which
        // meant the request that fetched it had already returned them:
        // every Admin's row was in the page payload, and the browser
        // was politely not drawing it. /api/users now scopes a Team
        // Leader to their own team server-side, so what arrives is
        // already what they may see — and, more to the point, already
        // what the server will accept when they submit.
        //
        // Filtering in the browser was never a restriction. It decided
        // what a picker showed, not what a request could contain.
    }, [usersResult])

    // Super Admin needs a company selected — same as the clients page itself,
    // no fetch at all until then rather than a 400.
    const clientsKey = !canUseClients || (userRole === 'SUPER_ADMIN' && !selectedCompanyId)
        ? null
        : `/api/clients${userRole === 'SUPER_ADMIN' ? `?companyId=${encodeURIComponent(selectedCompanyId!)}` : ''}`
    const { data: clientsResult } = useSWR(clientsKey, fetcher)
    const clients: any[] = clientsKey && Array.isArray(clientsResult?.data) ? clientsResult.data : NO_CLIENTS

    const [error, setError] = useState('')
    const [fieldErrors, setFieldErrors] = useState<{ [key: string]: string }>({})
    const [isSubmitting, setIsSubmitting] = useState(false)

    // Reloading or closing the tab with something typed asks first, as it
    // would lose it; not once it's being sent (Vercel's web interface audit).
    const started = !!(title || description || assigneeIds.length || deadline || difficulty || place.clientId || place.locationId)
    useEffect(() => {
        if (!started || isSubmitting) return
        const warn = (e: BeforeUnloadEvent) => { e.preventDefault() }
        window.addEventListener('beforeunload', warn)
        return () => window.removeEventListener('beforeunload', warn)
    }, [started, isSubmitting])

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        setIsSubmitting(true)
        setError('')
        setFieldErrors({})

        // Client-side Validation (matching server rules), in the order the
        // fields are in, so the first one wrong is the first one found.
        const errors: { [key: string]: string } = {}
        if (!title || title.length < 3 || title.length > TASK_TITLE_MAX) {
            errors.title = t('task_title_validation')
        }
        if (!description || description.length < 10 || description.length > TASK_DESCRIPTION_MAX) {
            errors.description = t('task_description_validation')
        }
        if (!place.locationId) {
            errors.locationId = t('task_location_required')
        }
        if (assigneeIds.length === 0) {
            errors.assigneeIds = t('assignees_required')
        }
        if (!deadline) {
            errors.deadline = t('deadline_required')
        }
        if (difficulty === '') {
            errors.difficulty = t('points_required')
        }

        const first = firstError(errors, TASK_FIELDS)
        if (first) {
            setFieldErrors(errors)
            setIsSubmitting(false)
            // The first field that's wrong takes the focus, which brings it into view.
            document.querySelector<HTMLElement>(`#field-${first} :is(input, textarea, select, button)`)?.focus()
            return
        }

        try {
            // Attachments removed from creation as per user request

            const res = await fetch('/api/tasks', {
                method: 'POST',
                body: JSON.stringify({
                    title,
                    titleEntryId: titleName.entryId ?? undefined,
                    description,
                    assigneeIds,
                    deadline,
                    difficulty: parseInt(difficulty) || 0,
                    clientId: place.clientId || undefined,
                    locationId: place.locationId,
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
            // The locations a row can name (CLIENTS_PLAN.md §2.7): the
            // template's own Locations sheet, by the hidden column of each
            // name's location; and the company's in use now, to check them
            // against. A template from before has no such sheet, and its
            // rows take their client's HQ.
            const listed = workbook.worksheets.find(w => w.name === 'Locations' || w.name === 'المواقع')
            const listedRows: unknown[][] = []
            listed?.eachRow(row => { listedRows.push(Array.isArray(row.values) ? row.values.slice(1).map(cellToPrimitive) : []) })
            const sheet = sheetLocations(listedRows)
            let places: BulkPlace[]
            try {
                const company = userRole === 'SUPER_ADMIN' && selectedCompanyId ? `&companyId=${encodeURIComponent(selectedCompanyId)}` : ''
                places = (await fetcher(`/api/locations?pick=all${company}`)).data.locations
            } catch (err: any) {
                showToast(t(err?.status === 403 ? 'task_location_no_permission' : 'task_location_load_failed'), 'error')
                return
            }
            setBulkPlaces(places)

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
                const clientNameRaw = row[2] ? String(row[2]).trim() : '' // Column C, optional
                // Column D, "Employee Name" — one merged column for both
                // cases: a single assignee is normally picked from the
                // dropdown, which writes "FirstName LastName (username)"
                // (the same display text as the Users sheet, so the
                // parenthesized username is always unambiguous even when two
                // employees share a full name); multiple assignees are typed
                // directly as comma-separated usernames, bypassing the
                // dropdown. Handled as one rule below rather than two
                // separate columns: split on comma, then per piece, a
                // trailing "(username)" is extracted if present, otherwise
                // the piece itself is taken as a literal username.
                const employeeFieldRaw = row[3] ? String(row[3]) : ''
                const deadlineDateStr = row[4] // Column E
                const deadlineTimeStr = row[5] // Column F
                const diffPoints = parseInt(row[6]) || 0 // Column G

                const validationErrors: Record<string, string[]> = {}
                const addError = (field: string, msg: string) => {
                    if (!validationErrors[field]) validationErrors[field] = []
                    validationErrors[field].push(msg)
                }

                // 1. Resolve usernames to IDs
                const usernamesRaw = employeeFieldRaw
                const usernames = employeeFieldRaw
                    .split(',')
                    .map(piece => {
                        const trimmed = piece.trim()
                        const dropdownMatch = trimmed.match(/\(([^)]+)\)\s*$/)
                        return dropdownMatch ? dropdownMatch[1].trim() : trimmed
                    })
                    .filter(u => u)
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

                // 1.5 Resolve client name (optional — empty cell means no
                // client, task falls back to whatever location gets set
                // manually in the review step). Client names are unique per
                // company (schema constraint), so a plain name match here
                // has no ambiguity risk the way employee full names would.
                let clientId: string | null = null
                if (clientNameRaw) {
                    const client = clients.find((v: any) => v.name.toLowerCase() === clientNameRaw.toLowerCase())
                    if (client) {
                        clientId = client.id
                    } else {
                        addError('client', `${t('invalid_client_name' as any) || 'Unknown client'}: ${clientNameRaw}`)
                    }
                }

                // 1.6 Its location: Column H through the template's list, or
                // its client's HQ. A name the list doesn't have is flagged,
                // with what was written, to be picked on the review screen.
                const locationCell = row[7] === null || row[7] === undefined ? '' : String(row[7]).trim()
                const { locationId, problem } = rowLocation(locationCell, clientId, sheet, places)
                // What was written is said with it: the select can't show a
                // location this row may not have.
                if (problem) addError('location', locationCell ? `${t(`bulk_location_${problem}` as TranslationKey)}: ${locationCell}` : t(`bulk_location_${problem}` as TranslationKey))

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

                        const minDeadline = earliestDeadline()
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
                    locationId,
                    clientId,
                    clientNameRaw,
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
            const min = earliestDeadline()
            if (isNaN(date.getTime())) addError('deadline', t('invalid_date'))
            else if (date < min) addError('deadline', t('deadline_too_soon'))
        } else {
            addError('deadline', t('missing_deadline'))
        }

        if (task.difficulty < 0 || task.difficulty > 10) {
            addError('difficulty', t('invalid_difficulty'))
        }

        // Its location, as picked on the review screen, for its client.
        const problem = locationProblem(task.locationId, task.clientId, bulkPlaces)
        if (problem) addError('location', t(`bulk_location_${problem}` as TranslationKey))

        return {
            ...task,
            validationErrors: errors,
            isInvalid: Object.keys(errors).length > 0
        }
    }

    // The Excel upload's file, picked from its button in the header.
    const fileInput = useRef<HTMLInputElement>(null)
    const num = (n: number) => n.toLocaleString(locale === 'ar' ? 'ar-EG' : 'en-GB')
    const used = (n: number, max: number) => t('ui_characters_used').replace('{used}', num(n)).replace('{max}', num(max))
    const clearError = (field: string) => { if (fieldErrors[field]) setFieldErrors({ ...fieldErrors, [field]: '' }) }

    return (
        <Page>
            <PageHeader
                title={t('create_new_task')}
                back={{ href: '/dashboard/tasks', label: modules.label('tasks') }}
                // Many tasks at once, from Excel: its template, the
                // usernames it takes, and the upload. A Super Admin manages
                // the templates instead of downloading one.
                action={(
                    <>
                        {userRole === 'SUPER_ADMIN'
                            ? <Button icon={DownloadSimpleIcon} onClick={() => setIsManageTemplatesOpen(true)}>{t('download_template')}</Button>
                            : <ButtonLink href={`/api/templates/download?locale=${locale}`} target="_blank" prefetch={false} icon={DownloadSimpleIcon}>{t('download_template')}</ButtonLink>}
                        <ButtonLink href="/dashboard/usernames" target="_blank" prefetch={false} icon={IdentificationCardIcon}>{t('view_usernames')}</ButtonLink>
                        <Button icon={UploadSimpleIcon} onClick={() => fileInput.current?.click()}>{t('upload_tasks_excel')}</Button>
                        <input
                            ref={fileInput}
                            aria-label={t('upload_tasks_excel')}
                            type="file"
                            accept=".xlsx, .xls"
                            hidden
                            onChange={(e) => {
                                const file = e.target.files?.[0]
                                if (file) handleBulkUpload(file)
                                e.target.value = '' // Reset
                            }}
                        />
                    </>
                )}
            />

            <Card>
                <form onSubmit={handleSubmit} noValidate className="ui-form">
                    <div id="field-title">
                        {/* Typed, or picked from the company's task titles (CLIENTS_PLAN.md §5). */}
                        <Field label={t('title_label')} hint={used(title.length, TASK_TITLE_MAX)} error={fieldErrors.title || undefined}>{p => (
                            <NamePicker
                                {...p}
                                value={titleName}
                                onChange={next => {
                                    setTitlePick({ name: next, company: selectedCompanyId })
                                    clearError('title')
                                }}
                                {...titleNames}
                                addLabel={t('lists_add_to_list')}
                                failedLabel={t('lists_add_failed')}
                                maxLength={TASK_TITLE_MAX}
                                disabled={isSubmitting}
                            />
                        )}</Field>
                    </div>
                    <div id="field-description">
                        <Field label={t('description_label')} hint={used(description.length, TASK_DESCRIPTION_MAX)} error={fieldErrors.description || undefined}>{p => (
                            <TextArea {...p} value={description} rows={4} maxLength={TASK_DESCRIPTION_MAX} disabled={isSubmitting}
                                onChange={e => { setDescription(e.target.value); clearError('description') }} />
                        )}</Field>
                    </div>
                    {/* Where it's done: its client, if it has one, and a location
                        picked from the list (CLIENTS_PLAN.md §2.3). */}
                    <div id="field-locationId">
                        <TaskPlacePicker
                            value={place}
                            onChange={next => { setPlace(next); clearError('locationId') }}
                            companyId={userRole === 'SUPER_ADMIN' ? selectedCompanyId : null}
                            error={fieldErrors.locationId || undefined}
                            disabled={isSubmitting}
                        />
                    </div>
                    {/* Who it's for: as many as it needs, found by name (DESIGN.md §5.3). */}
                    <AssigneeChecklist
                        id="field-assigneeIds"
                        people={usersError ? null : usersResult ? users : undefined}
                        value={assigneeIds}
                        onChange={ids => { setAssigneeIds(ids); clearError('assigneeIds') }}
                        disabled={isSubmitting}
                        error={fieldErrors.assigneeIds || undefined}
                    />
                    <div id="field-deadline">
                        <DateTimePicker
                            asField
                            label={t('deadline_label')}
                            value={deadline}
                            onChange={v => { setDeadline(v); clearError('deadline') }}
                            min={earliestDeadline(now).toISOString()}
                            error={fieldErrors.deadline || undefined}
                        />
                    </div>
                    <div id="field-difficulty">
                        <Field label={t('difficulty')} hint={t('points_hint')} error={fieldErrors.difficulty || undefined}>{p => (
                            <TextInput
                                {...p}
                                type="number"
                                inputMode="numeric"
                                min={0}
                                max={10}
                                value={difficulty}
                                disabled={isSubmitting}
                                onChange={e => {
                                    const val = e.target.value
                                    setDifficulty(val === '' ? '' : Math.min(Math.max(parseInt(val), 0), 10).toString())
                                    clearError('difficulty')
                                }}
                            />
                        )}</Field>
                    </div>

                    {error && <p className="ui-error" role="alert">{error}</p>}
                    <div className="ui-form-actions">
                        <Button type="submit" variant="primary" busy={isSubmitting}>
                            {isSubmitting ? t('creating') : t('create_task_button')}
                        </Button>
                        <ButtonLink href={'/dashboard/tasks'}>{t('cancel')}</ButtonLink>
                    </div>
                </form>
            </Card>

            <BulkTaskReviewModal
                isOpen={isBulkModalOpen}
                onClose={() => setIsBulkModalOpen(false)}
                bulkTasks={bulkTasks}
                setBulkTasks={setBulkTasks}
                users={users}
                clients={clients}
                places={bulkPlaces}
                revalidateRow={revalidateRow}
                isSubmitting={isSubmitting}
                setIsSubmitting={setIsSubmitting}
            />

            <ManageTemplatesModal
                isOpen={isManageTemplatesOpen}
                onClose={() => setIsManageTemplatesOpen(false)}
            />
        </Page>
    )
}

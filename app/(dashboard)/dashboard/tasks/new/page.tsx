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
import { sheetLocations, type BulkPlace } from '@/lib/bulk-locations'
import { readRows, type BulkRow, type SheetRow } from '@/lib/bulk-tasks'
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
import { DownloadSimpleIcon, FileXlsIcon, IdentificationCardIcon, UploadSimpleIcon } from '@phosphor-icons/react/ssr'
import { Button, ButtonLink, Card, Field, Page, PageHeader, TextArea, TextInput } from '@/components/ui'

const NO_CLIENTS: any[] = []

/**
 * Who can be assigned, from /api/users's answer, nothing before it's come:
 * employees, then team leaders, Admins and Super Admins, each by name. On
 * a copy, as the answer belongs to SWR's cache.
 *
 * No filtering here. This used to hide Admins from a Team Leader's list,
 * which meant the request that fetched it had already returned them: every
 * Admin's row was in the page payload, and the browser was politely not
 * drawing it. /api/users now scopes a Team Leader to their own team
 * server-side, so what arrives is already what they may see, and already
 * what the server will accept when they submit. Filtering in the browser
 * was never a restriction: it decided what a picker showed, not what a
 * request could contain.
 */
function peopleIn(result: any): any[] | undefined {
    if (!result) return undefined
    const list = result?.data?.data || result?.data || []
    if (!Array.isArray(list)) {
        console.error('Invalid users data received:', result)
        return []
    }
    const rolePriority: { [key: string]: number } = { EMPLOYEE: 1, TEAM_LEADER: 2, ADMIN: 3, SUPER_ADMIN: 4 }
    return [...list].sort((a: any, b: any) => {
        const priorityA = rolePriority[a.role] || 99
        const priorityB = rolePriority[b.role] || 99
        if (priorityA !== priorityB) return priorityA - priorityB
        return a.firstName.localeCompare(b.firstName)
    })
}

/** The company's clients, from /api/clients's answer, nothing before it's come. */
const clientsIn = (result: any): any[] | undefined => (Array.isArray(result?.data) ? result.data : undefined)

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
    const [bulkTasks, setBulkTasks] = useState<BulkRow[]>([])
    // The company's locations in use, for the upload's rows (CLIENTS_PLAN.md §2.7).
    const [bulkPlaces, setBulkPlaces] = useState<BulkPlace[]>([])
    // While a file picked is read, its button is busy.
    const [readingFile, setReadingFile] = useState(false)
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
    const { data: usersResult, error: usersError, mutate: retryUsers, isValidating: retryingUsers } = useSWR(usersKey, fetcher)
    const users: any[] = useMemo(() => peopleIn(usersResult) ?? [], [usersResult])

    // Super Admin needs a company selected — same as the clients page itself,
    // no fetch at all until then rather than a 400.
    const clientsKey = !canUseClients || (userRole === 'SUPER_ADMIN' && !selectedCompanyId)
        ? null
        : `/api/clients${userRole === 'SUPER_ADMIN' ? `?companyId=${encodeURIComponent(selectedCompanyId!)}` : ''}`
    const { data: clientsResult, mutate: retryClients } = useSWR(clientsKey, fetcher)
    const clients: any[] = (clientsKey && clientsIn(clientsResult)) || NO_CLIENTS

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

    // The upload's rows, read in lib/bulk-tasks.ts and checked in the review
    // (DESIGN.md §5.5, "Rows read from a file").
    const handleBulkUpload = async (file: File) => {
        // The people and clients the rows name, before they're read: a file
        // picked as the page opens was read before they had loaded, and its
        // rows matched no one (PR 212's browser flows).
        const peopleNow = usersResult ? users : peopleIn(await retryUsers().catch(() => undefined))
        if (!peopleNow) return showToast(t('bulk_people_load_failed'), 'error')
        const clientsNow = !clientsKey ? NO_CLIENTS : clientsIn(clientsResult ?? await retryClients().catch(() => undefined))
        if (!clientsNow) return showToast(t('bulk_clients_load_failed'), 'error')

        // A file exceljs can't open, an old .xls or anything else, was an
        // error in the console and nothing on the page. exceljs itself not
        // loading, as after a new release, isn't the file's fault.
        const exceljs = await import('exceljs').catch(() => null)
        if (!exceljs) return showToast(t('bulk_reader_failed'), 'error')
        const workbook = new exceljs.Workbook()
        try {
            await workbook.xlsx.load(await file.arrayBuffer())
        } catch {
            return showToast(t('bulk_file_unreadable'), 'error')
        }
        const worksheet = workbook.worksheets[0]
        if (!worksheet) return showToast(t('bulk_no_rows'), 'error')

        // The locations a row can name (CLIENTS_PLAN.md §2.7): the
        // template's own Locations sheet, by the hidden column of each
        // name's location; and the company's in use now, to check them
        // against. A template from before has no such sheet, and its rows
        // take their client's HQ.
        const listed = workbook.worksheets.find(w => w.name === 'Locations' || w.name === 'المواقع')
        const listedRows: unknown[][] = []
        listed?.eachRow(row => { listedRows.push(Array.isArray(row.values) ? row.values.slice(1).map(cellToPrimitive) : []) })
        let places: BulkPlace[]
        try {
            const company = userRole === 'SUPER_ADMIN' && selectedCompanyId ? `&companyId=${encodeURIComponent(selectedCompanyId)}` : ''
            places = (await fetcher(`/api/locations?pick=all${company}`)).data.locations
        } catch (err: any) {
            return showToast(t(err?.status === 403 ? 'task_location_no_permission' : 'task_location_load_failed'), 'error')
        }

        // Each row with its number in the file, and its cells from the
        // first column: exceljs's row.values starts at index 1.
        const sheetRows: SheetRow[] = []
        worksheet.eachRow({ includeEmpty: true }, row => {
            sheetRows.push({ line: row.number, cells: Array.isArray(row.values) ? row.values.slice(1).map(cellToPrimitive) : [] })
        })
        const read = readRows(sheetRows, { people: peopleNow, clients: clientsNow, sheet: sheetLocations(listedRows), places })
        if ('problem' in read) return showToast(t(read.problem === 'too_many' ? 'bulk_limit_exceeded' : 'bulk_no_rows'), 'error')

        setBulkPlaces(places)
        setBulkTasks(read.rows)
        setIsBulkModalOpen(true)
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
                            ? <Button icon={FileXlsIcon} onClick={() => setIsManageTemplatesOpen(true)}>{t('manage_templates')}</Button>
                            : <ButtonLink href={`/api/templates/download?locale=${locale}`} target="_blank" prefetch={false} icon={DownloadSimpleIcon}>{t('download_template')}</ButtonLink>}
                        <ButtonLink href="/dashboard/usernames" target="_blank" prefetch={false} icon={IdentificationCardIcon}>{t('view_usernames')}</ButtonLink>
                        <Button icon={UploadSimpleIcon} busy={readingFile} onClick={() => fileInput.current?.click()}>{t('upload_tasks_excel')}</Button>
                        <input
                            ref={fileInput}
                            aria-label={t('upload_tasks_excel')}
                            type="file"
                            accept=".xlsx"
                            hidden
                            onChange={(e) => {
                                const file = e.target.files?.[0]
                                e.target.value = '' // The same file can be picked again.
                                if (!file) return
                                setReadingFile(true)
                                void handleBulkUpload(file).finally(() => setReadingFile(false))
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
                            <TextArea {...p} name="description" dir="auto" value={description} rows={4} maxLength={TASK_DESCRIPTION_MAX} disabled={isSubmitting}
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
                        onRetry={() => { void retryUsers() }}
                        retrying={retryingUsers}
                        value={assigneeIds}
                        onChange={ids => { setAssigneeIds(ids); clearError('assigneeIds') }}
                        disabled={isSubmitting}
                        error={fieldErrors.assigneeIds || undefined}
                    />
                    <div id="field-deadline">
                        <DateTimePicker
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
                                name="difficulty"
                                autoComplete="off"
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
                rows={bulkTasks}
                onRowsChange={setBulkTasks}
                people={usersError ? null : usersResult ? users : undefined}
                onRetryPeople={() => { void retryUsers() }}
                retryingPeople={retryingUsers}
                clients={clients}
                places={bulkPlaces}
            />

            <ManageTemplatesModal
                isOpen={isManageTemplatesOpen}
                onClose={() => setIsManageTemplatesOpen(false)}
            />
        </Page>
    )
}

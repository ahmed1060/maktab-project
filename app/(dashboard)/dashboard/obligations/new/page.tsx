'use client'
import { useState, useEffect } from 'react'
import { PlusIcon } from '@phosphor-icons/react/ssr'
import { useRouter } from 'next/navigation'
import { useSession } from 'next-auth/react'
import DateTimePicker from '@/components/DateTimePicker'
import { useLanguage } from '@/context/LanguageContext'
import { useCompany } from '@/context/CompanyContext'
import { useNow } from '@/lib/useNow'
import { earliestDeadline } from '@/lib/deadline'
import { permissionsOf, useCan } from '@/lib/useCan'
import AccessDenied from '@/components/AccessDenied'
import { fetchRetrying } from '@/lib/swr-fetcher'
import { useModules } from '@/lib/useModules'
import { firstError } from '@/lib/form-errors'
import AssigneeChecklist from '@/components/forms/AssigneeChecklist'
import { Button, ButtonLink, Card, Choice, Field, Page, PageHeader, TextArea, TextInput } from '@/components/ui'

/** The longest an obligation's title and description may be, as this form takes them. */
const TITLE_MAX = 100
const DESCRIPTION_MAX = 500
/** Its fields in the order they're in, for the first one wrong to take the focus. */
const FIELDS = ['title', 'description', 'assigneeIds', 'deadline', 'difficulty'] as const
const RECURRENCES = ['ONE_TIME', 'DAILY', 'WEEKLY', 'MONTHLY'] as const

export default function NewObligationPage() {
    const { t, locale } = useLanguage()
    const modules = useModules()
    // The deadline floor offered to the picker, kept current while the form
    // stays open. See lib/useNow.ts.
    const now = useNow()
    const [title, setTitle] = useState('')
    const [description, setDescription] = useState('')
    const [assigneeIds, setAssigneeIds] = useState<string[]>([])
    const [deadline, setDeadline] = useState('')
    const [difficulty, setDifficulty] = useState('')
    const [recurrence, setRecurrence] = useState<(typeof RECURRENCES)[number]>('ONE_TIME')
    const [users, setUsers] = useState<any[]>([])
    // Whether the people have come: the list says it's loading until they
    // have, rather than that there's no one, and says so if they couldn't.
    const [people, setPeople] = useState<'loading' | 'loaded' | 'failed'>('loading')
    // Try again asks once more, with the checklist's failure kept, busy, until it's answered.
    const [tries, setTries] = useState(0)
    const [retrying, setRetrying] = useState(false)
    const router = useRouter()

    const { data: session } = useSession()
    const { selectedCompanyId } = useCompany()
    // Creating obligations is a manager's (the list offers the button only to
    // them); anyone else reaching this address by hand is told so, rather
    // than asking for a colleague list they may not read.
    const mayCreate = useCan().can('obligations.manage')

    useEffect(() => {
        if (!mayCreate) return
        const queryParams = new URLSearchParams()
        queryParams.set('limit', '1000')
        if (selectedCompanyId) queryParams.set('companyId', selectedCompanyId)

        // A server error, once tried again, is given back rather than thrown:
        // read as an empty list, it said no one matched the search.
        fetchRetrying(`/api/users?${queryParams.toString()}`)
            .then(res => {
                if (!res.ok) throw new Error(`Couldn't load the people (${res.status})`)
                return res.json()
            })
            .then(result => {
                const usersList = result?.data?.data || []
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
                // A team-scoped manager is not offered the company's Admins.
                const permissions = permissionsOf(session?.user as any)
                const teamOnly = permissions.can('obligations.manage') && !permissions.companyWide('obligations.manage')
                const filteredData = teamOnly
                    ? sortedData.filter((u: any) => !['ADMIN', 'SUPER_ADMIN'].includes(u.role))
                    : sortedData
                setUsers(filteredData)
                setPeople('loaded')
            })
            .catch(() => setPeople('failed'))
            .finally(() => setRetrying(false))
    }, [session, selectedCompanyId, mayCreate, tries])

    const [error, setError] = useState('')
    const [fieldErrors, setFieldErrors] = useState<{ [key: string]: string }>({})
    const [isSubmitting, setIsSubmitting] = useState(false)

    // Reloading or closing the tab with something typed asks first, as it
    // would lose it; not once it's being sent (Vercel's web interface audit).
    const started = !!(title || description || assigneeIds.length || deadline || difficulty || recurrence !== 'ONE_TIME')
    useEffect(() => {
        if (!started || isSubmitting) return
        const warn = (e: BeforeUnloadEvent) => { e.preventDefault() }
        window.addEventListener('beforeunload', warn)
        return () => window.removeEventListener('beforeunload', warn)
    }, [started, isSubmitting])

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        setFieldErrors({})
        setIsSubmitting(true)
        setError('')

        // Client-side Validation, in the order the fields are in. Who it's
        // for and when were only checked by the server, whose refusal came
        // back above the form rather than under the field.
        const errors: { [key: string]: string } = {}
        if (!title || title.length < 3 || title.length > TITLE_MAX) {
            errors.title = t('task_title_validation')
        }
        if (!description || description.length < 10 || description.length > DESCRIPTION_MAX) {
            errors.description = t('obligation_description_validation')
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

        const first = firstError(errors, FIELDS)
        if (first) {
            setFieldErrors(errors)
            setIsSubmitting(false)
            // The first field that's wrong takes the focus, which brings it into view.
            document.querySelector<HTMLElement>(`#field-${first} :is(input, textarea, select, button)`)?.focus()
            return
        }

        try {
            // Attachments removed from creation as per user request

            const res = await fetch('/api/obligations', {
                method: 'POST',
                body: JSON.stringify({
                    title,
                    description,
                    assigneeIds,
                    deadline,
                    difficulty: parseInt(difficulty) || 0,
                    recurrence,
                    attachments: []
                }),
                headers: { 'Content-Type': 'application/json' }
            })

            if (!res.ok) {
                const data = await res.json().catch(() => ({}))
                // data.error is always a plain string; data.details (when
                // present) is a raw Zod .format() object and must never be
                // used as the message itself — stringifying it renders as
                // literal "[object Object]".
                throw new Error(data.error || `${t('error_generic')} (${res.status})`)
            }

            router.push('/dashboard/obligations')
            router.refresh()
        } catch (err: any) {
            console.error(err)
            setError(err.message || t('error_generic'))
            setIsSubmitting(false)
        }
    }

    const num = (n: number) => n.toLocaleString(locale === 'ar' ? 'ar-EG' : 'en-GB')
    const used = (n: number, max: number) => t('ui_characters_used').replace('{used}', num(n)).replace('{max}', num(max))
    const clearError = (field: string) => { if (fieldErrors[field]) setFieldErrors({ ...fieldErrors, [field]: '' }) }

    if (!mayCreate) return <AccessDenied />

    return (
        <Page>
            <PageHeader title={t('add_obligation')} back={{ href: '/dashboard/obligations', label: modules.label('obligations') }} />

            <Card>
                <form onSubmit={handleSubmit} noValidate className="ui-form">
                    <div id="field-title">
                        <Field label={t('title_label')} hint={used(title.length, TITLE_MAX)} error={fieldErrors.title || undefined}>{p => (
                            <TextInput {...p} name="title" autoComplete="off" dir="auto" value={title} maxLength={TITLE_MAX} disabled={isSubmitting}
                                onChange={e => { setTitle(e.target.value); clearError('title') }} />
                        )}</Field>
                    </div>
                    <div id="field-description">
                        <Field label={t('description_label')} hint={used(description.length, DESCRIPTION_MAX)} error={fieldErrors.description || undefined}>{p => (
                            <TextArea {...p} name="description" dir="auto" value={description} rows={4} maxLength={DESCRIPTION_MAX} disabled={isSubmitting}
                                onChange={e => { setDescription(e.target.value); clearError('description') }} />
                        )}</Field>
                    </div>
                    {/* Who it's for: as many as it needs, found by name (DESIGN.md §5.3). */}
                    <AssigneeChecklist
                        id="field-assigneeIds"
                        people={people === 'loading' ? undefined : people === 'failed' ? null : users}
                        onRetry={() => { setRetrying(true); setTries(n => n + 1) }}
                        retrying={retrying}
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
                    {/* How often it comes round: a few options, so radio buttons (DESIGN.md §5.3). */}
                    <Choice
                        legend={t('recurrence_label')}
                        name="recurrence"
                        value={recurrence}
                        onChange={setRecurrence}
                        options={RECURRENCES.map(r => ({ value: r, label: t(`recurrence_${r.toLowerCase()}` as 'recurrence_one_time') }))}
                    />
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
                        <Button type="submit" variant="primary" icon={PlusIcon} busy={isSubmitting}>
                            {isSubmitting ? t('creating') : t('create_obligation_button')}
                        </Button>
                        <ButtonLink href={'/dashboard/obligations'}>{t('cancel')}</ButtonLink>
                    </div>
                </form>
            </Card>
        </Page>
    )
}

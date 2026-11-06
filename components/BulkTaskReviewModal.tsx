'use client'
import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { CalendarBlankIcon, HashIcon, MapPinIcon, UsersIcon, WarningCircleIcon } from '@phosphor-icons/react/ssr'
import { useLanguage } from '@/context/LanguageContext'
import { useToast } from '@/context/ToastContext'
import DateTimePicker from '@/components/DateTimePicker'
import AssigneeChecklist, { type Assignable } from '@/components/forms/AssigneeChecklist'
import { Button, DataList, Dialog, Field, Icon, ListCard, Select, TextArea, TextInput, visibleRow, type Column, type SelectOption } from '@/components/ui'
import { useNow } from '@/lib/useNow'
import { useAdjustOnChange } from '@/lib/useAdjustOnChange'
import { earliestDeadline } from '@/lib/deadline'
import { countOf } from '@/lib/plural'
import { dateTimeText } from '@/lib/calendar-text'
import { locationLabel } from '@/lib/locations'
import type { BulkPlace } from '@/lib/bulk-locations'
import { TASK_DESCRIPTION_MAX, TASK_TITLE_MAX } from '@/lib/new-task'
import type { TranslationKey } from '@/lib/translations'
import {
    createTasks, mistakesInOrder, rowMistakes, rowToSend, withClient, withDeadline, withLocation, withPeople, withoutUnknownPeople, withRowBack,
    TASK_DIFFICULTY_MAX, type BulkField, type BulkMistake, type BulkMistakes, type BulkRow, type RemovedRow,
} from '@/lib/bulk-tasks'

type Client = { id: string; name: string }
type Checked = { row: BulkRow; mistakes: BulkMistakes; wrong: boolean }

/** What's wrong, then what the file had, kept apart from the sentence's direction. */
function mistakeText(t: (key: TranslationKey) => string, mistake: BulkMistake | undefined): string | undefined {
    if (!mistake) return undefined
    return mistake.detail === undefined ? t(mistake.key) : `${t(mistake.key)}: \u2068${mistake.detail}\u2069`
}

/**
 * The tasks read from an Excel file, checked before any is created
 * (DESIGN.md §5.5, "Rows read from a file"): the rows as a list, each with
 * its row's number in the file and its mistakes under its title; a row's
 * Edit opens its fields in the dialog, and Done goes back to that row;
 * Remove takes one out; the main button says how many it creates.
 *
 * Create task reads the file and keeps the rows; this changes them. It was a
 * window of its own making, each title and description changed in a pop-up
 * placed beside it by hand, its people added and taken off with round plus
 * and minus buttons, and sparkles on its main button (PR 212).
 */
export default function BulkTaskReviewModal({ isOpen, onClose, rows, onRowsChange, people, onRetryPeople, retryingPeople, clients, places }: {
    isOpen: boolean
    onClose: () => void
    rows: BulkRow[]
    onRowsChange: (rows: BulkRow[]) => void
    /** Who can be assigned: undefined while they load, null when they couldn't be. */
    people: Assignable[] | null | undefined
    onRetryPeople: () => void
    retryingPeople: boolean
    clients: Client[]
    /** The company's locations in use, which each row picks from (CLIENTS_PLAN.md §2.7). */
    places: BulkPlace[]
}) {
    const { t, locale } = useLanguage()
    // The deadline floor, kept current while the review stays open. See lib/useNow.ts.
    const now = useNow()
    const { showToast } = useToast()
    const router = useRouter()
    // The row whose fields are open, by its row in the file.
    const [editing, setEditing] = useState<number | null>(null)
    const [sending, setSending] = useState(false)
    // What the server said when it created none: null when it said nothing.
    const [refused, setRefused] = useState<string | null | undefined>(undefined)
    // The row last removed, for Undo to put back where it was.
    const [removed, setRemoved] = useState<RemovedRow | null>(null)
    // Where the focus goes once the view has changed: the row's first field
    // that's wrong as its fields open, or a row's button as the list comes back.
    const focusNext = useRef<'field' | { line: number; button: 'edit' | 'remove' } | null>(null)
    const body = useRef<HTMLDivElement>(null)
    // Each file's review starts at its list, with nothing said from the last.
    useAdjustOnChange([isOpen], () => {
        if (!isOpen) return
        setEditing(null)
        setSending(false)
        setRefused(undefined)
        setRemoved(null)
    })
    // Leaving the page loses the file's rows and what was fixed in them:
    // the browser asks first, as Create task does for what's typed in it.
    useEffect(() => {
        if (!isOpen || sending) return
        const warn = (e: BeforeUnloadEvent) => { e.preventDefault() }
        window.addEventListener('beforeunload', warn)
        return () => window.removeEventListener('beforeunload', warn)
    }, [isOpen, sending])
    useEffect(() => {
        const want = focusNext.current
        if (!want) return
        focusNext.current = null
        if (want === 'field') {
            // The first field with what's wrong under it, at the control
            // marked wrong where it says which, as the dialogs' forms do;
            // or the title, for a row with nothing wrong.
            const fields = body.current
            const wrong = [...(fields?.querySelectorAll<HTMLElement>('.ui-field') ?? [])].find(f => f.querySelector(':scope > .ui-error'))
            const target = wrong?.querySelector<HTMLElement>('[aria-invalid="true"]') ?? wrong?.querySelector<HTMLElement>('input, select, textarea, button') ?? fields?.querySelector<HTMLElement>('input, textarea, select')
            target?.focus()
        } else {
            visibleRow(String(want.line))?.querySelector<HTMLElement>(`[data-${want.button}]`)?.focus()
        }
    })

    const num = (n: number) => n.toLocaleString(locale === 'ar' ? 'ar-EG' : 'en-GB')
    const tasks = (n: number) => countOf(t, locale, n, 'tasks')
    const checked: Checked[] = rows.map(row => {
        const mistakes = rowMistakes(row, places, now)
        return { row, mistakes, wrong: Object.keys(mistakes).length > 0 }
    })
    const ready = checked.filter(c => !c.wrong).map(c => c.row)
    const left = rows.length - ready.length

    const ignore = () => {}
    const open = (line: number) => {
        focusNext.current = 'field'
        setEditing(line)
    }
    const back = () => {
        if (editing !== null) focusNext.current = { line: editing, button: 'edit' }
        setEditing(null)
    }
    const change = (next: BulkRow) => onRowsChange(rows.map(r => (r.line === next.line ? next : r)))
    // Nothing is saved yet, so it doesn't ask, and Undo puts it back; the
    // focus goes to the next row's Remove.
    const remove = (line: number) => {
        const at = rows.findIndex(r => r.line === line)
        const rest = rows.filter(r => r.line !== line)
        if (rest.length > 0) focusNext.current = { line: rest[Math.min(at, rest.length - 1)].line, button: 'remove' }
        setRemoved({ row: rows[at], at })
        onRowsChange(rest)
        if (rest.length === 0) return onClose()
    }
    const undo = () => {
        if (!removed) return
        focusNext.current = { line: removed.row.line, button: 'edit' }
        setRemoved(null)
        onRowsChange(withRowBack(rows, removed))
    }
    const create = async () => {
        if (sending || ready.length === 0) return
        const sent = ready.map(rowToSend)
        setSending(true)
        setRefused(undefined)
        const result = await createTasks(sent)
        if ('refused' in result) {
            setSending(false)
            setRefused(result.refused)
            return
        }
        // As the server counted them: it leaves out one it refuses.
        const skipped = sent.length - result.created
        showToast(skipped > 0
            ? t('bulk_created_some').replace('{created}', tasks(result.created)).replace('{skipped}', tasks(skipped))
            : t('bulk_created').replace('{tasks}', tasks(result.created)), skipped > 0 ? 'warning' : 'success')
        onClose()
        router.push('/dashboard/tasks')
    }

    const nameOf = (id: string) => {
        const person = people?.find(p => p.id === id)
        return person ? [person.firstName, person.lastName].filter(Boolean).join(' ') : null
    }
    const names = (row: BulkRow) => {
        const known = row.assigneeIds.map(nameOf).filter((name): name is string => !!name)
        return known.length > 0 ? known.join(t('list_separator')) : <span className="ui-bulk-unset">{t('bulk_no_one')}</span>
    }
    const deadline = (row: BulkRow) => dateTimeText(row.deadline, locale) ?? <span className="ui-bulk-unset">{t('bulk_none_yet')}</span>
    const place = (row: BulkRow) => {
        const location = places.find(p => p.id === row.locationId)
        const client = clients.find(c => c.id === row.clientId)?.name
        const text = location ? locationLabel(location.name, client) : client
        return text ? <bdi>{text}</bdi> : <span className="ui-bulk-unset">{t('bulk_none_yet')}</span>
    }
    // Its title, the start of its description, then what's wrong with it.
    const titled = ({ row, mistakes }: Checked) => (
        <>
            <div className="ui-item-title">{row.title || <span className="ui-bulk-unset">{t('bulk_no_title')}</span>}</div>
            {row.description && <div className="ui-item-detail"><span className="ui-clamp" dir="auto">{row.description}</span></div>}
            <RowMistakes line={row.line} mistakes={mistakes} num={num} />
        </>
    )
    const buttons = (row: BulkRow) => (
        <span className="ui-row-actions">
            <Button size="sm" aria-label={t('bulk_edit_row').replace('{n}', num(row.line))} data-edit="" disabled={sending} onClick={() => open(row.line)}>{t('edit')}</Button>
            <Button size="sm" variant="quiet" aria-label={t('bulk_remove_row').replace('{n}', num(row.line))} data-remove="" disabled={sending} onClick={() => remove(row.line)}>{t('remove')}</Button>
        </span>
    )
    const columns: Column<Checked>[] = [
        { key: 'line', header: t('bulk_col_row'), cell: c => num(c.row.line) },
        { key: 'task', header: t('tasks_col_task'), cell: titled },
        { key: 'assignees', header: t('assignees_label'), cell: c => names(c.row) },
        { key: 'deadline', header: t('deadline_label'), cell: c => <span className="ui-due">{deadline(c.row)}</span> },
        { key: 'place', header: t('task_location'), cell: c => place(c.row) },
        { key: 'actions', header: t('actions_label'), hideHeader: true, align: 'end', cell: c => buttons(c.row) },
    ]

    const row = editing === null ? undefined : rows.find(r => r.line === editing)
    return (
        <Dialog
            open={isOpen}
            onClose={sending ? ignore : editing !== null ? back : onClose}
            title={row ? t('bulk_edit_title').replace('{n}', num(row.line)) : t('bulk_review_title')}
            actions={row ? (
                <Button variant="primary" onClick={back}>{t('done')}</Button>
            ) : (
                <>
                    <Button onClick={onClose} disabled={sending}>{t('cancel')}</Button>
                    <Button variant="primary" busy={sending} disabled={ready.length === 0} onClick={create}>
                        {ready.length > 0 ? t('bulk_create_n').replace('{tasks}', tasks(ready.length)) : t('create_tasks')}
                    </Button>
                </>
            )}
        >
            <div ref={body} className="ui-bulk-review">
                {row ? (
                    <BulkRowFields row={row} onChange={change} people={people} onRetryPeople={onRetryPeople} retryingPeople={retryingPeople} clients={clients} places={places} now={now} />
                ) : (
                    <>
                        <div>
                            <p>{left > 0
                                ? t('bulk_review_read_mistakes').replace('{tasks}', tasks(rows.length)).replace('{n}', num(left))
                                : t('bulk_review_read').replace('{tasks}', tasks(rows.length))}</p>
                            {/* Always here, empty until a row is removed, so a screen reader hears it as it changes. */}
                            <p className="ui-bulk-status" role="status">
                                {removed && <>
                                    {t('bulk_removed').replace('{n}', num(removed.row.line))}
                                    <Button size="sm" variant="quiet" onClick={undo}>{t('bulk_undo')}</Button>
                                </>}
                            </p>
                        </div>
                        <DataList
                            caption={t('bulk_review_list')}
                            columns={columns}
                            rows={checked}
                            rowKey={c => String(c.row.line)}
                            tone={c => (c.wrong ? 'problem' : undefined)}
                            card={c => (
                                <ListCard
                                    title={c.row.title || <span className="ui-bulk-unset">{t('bulk_no_title')}</span>}
                                    note={<>
                                        {c.row.description && <div className="ui-item-detail"><span className="ui-clamp" dir="auto">{c.row.description}</span></div>}
                                        <RowMistakes line={c.row.line} mistakes={c.mistakes} num={num} />
                                    </>}
                                    details={[
                                        { icon: HashIcon, text: t('bulk_row').replace('{n}', num(c.row.line)) },
                                        { icon: UsersIcon, text: names(c.row) },
                                        { icon: CalendarBlankIcon, text: deadline(c.row) },
                                        { icon: MapPinIcon, text: place(c.row) },
                                    ]}
                                    foot={buttons(c.row)}
                                />
                            )}
                        />
                        {left > 0 && <p className="ui-hint">{t('bulk_left_out').replace('{tasks}', tasks(left))}</p>}
                        {refused !== undefined && <p className="ui-error" role="alert">{refused ?? t('bulk_create_failed')}</p>}
                    </>
                )}
            </div>
        </Dialog>
    )
}

/** What's wrong with a row, in the order its fields are in, under its title. */
function RowMistakes({ line, mistakes, num }: { line: number; mistakes: BulkMistakes; num: (n: number) => string }) {
    const { t } = useLanguage()
    const list = mistakesInOrder(mistakes)
    if (list.length === 0) return null
    return (
        <ul className="ui-row-mistakes" aria-label={t('bulk_mistakes').replace('{n}', num(line))}>
            {list.map(mistake => <li key={mistake.field}><Icon icon={WarningCircleIcon} size={16} />{mistakeText(t, mistake)}</li>)}
        </ul>
    )
}

/**
 * A row's fields, as Create task has them, each with what's wrong with it
 * under it. Each change is kept as it's made: Done only goes back.
 */
export function BulkRowFields({ row, onChange, people, onRetryPeople, retryingPeople, clients, places, now }: {
    row: BulkRow
    onChange: (row: BulkRow) => void
    people: Assignable[] | null | undefined
    onRetryPeople: () => void
    retryingPeople: boolean
    clients: Client[]
    places: BulkPlace[]
    now: number
}) {
    const { t, locale } = useLanguage()
    const mistakes = rowMistakes(row, places, now)
    const said = (field: BulkField) => mistakeText(t, mistakes[field])
    const num = (n: number) => n.toLocaleString(locale === 'ar' ? 'ar-EG' : 'en-GB')
    const used = (n: number, max: number) => t('ui_characters_used').replace('{used}', num(n)).replace('{max}', num(max))

    // Its locations as the task form's picker lists them (DESIGN.md §5.3):
    // its client's, its HQ first, then the shared ones; one with no pin
    // greyed, with why.
    const optionOf = (p: BulkPlace): SelectOption => ({
        value: p.id,
        label: [p.name, p.isHq && t('locations_hq'), p.needsPin && t('task_location_needs_pin')].filter(Boolean).join(' · '),
        disabled: p.needsPin,
    })
    const clientName = clients.find(c => c.id === row.clientId)?.name ?? ''
    const groups = [
        { label: t('task_location_client_group').replace('{name}', clientName), options: row.clientId ? places.filter(p => p.clientId === row.clientId).map(optionOf) : [] },
        { label: t('task_location_shared_group'), options: places.filter(p => !p.clientId).map(optionOf) },
    ]
    // A client the file named that isn't one stays shown, as not found, until one is picked.
    const clientOptions: SelectOption[] = [
        ...(row.unknownClient ? [{ value: '?', label: t('bulk_client_not_found').replace('{text}', `\u2068${row.unknownClient}\u2069`), disabled: true }] : []),
        { value: '', label: t('task_no_client') },
        ...clients.map(c => ({ value: c.id, label: c.name })),
    ]

    return (
        <div className="ui-form">
            <Field label={t('title_label')} hint={used(row.title.length, TASK_TITLE_MAX)} error={said('title')}>{p => (
                <TextInput {...p} name="title" dir="auto" autoComplete="off" value={row.title} maxLength={TASK_TITLE_MAX}
                    onChange={e => onChange({ ...row, title: e.target.value })} />
            )}</Field>
            <Field label={t('description_label')} hint={used(row.description.length, TASK_DESCRIPTION_MAX)} error={said('description')}>{p => (
                <TextArea {...p} name="description" dir="auto" rows={4} value={row.description} maxLength={TASK_DESCRIPTION_MAX}
                    onChange={e => onChange({ ...row, description: e.target.value })} />
            )}</Field>
            {/* Its client, and where it's done (CLIENTS_PLAN.md §2.3, §2.7). */}
            <div className="ui-field-group">
                <Field label={t('location_client')} error={said('client')}>{p => (
                    <Select {...p} name="clientId" value={row.unknownClient ? '?' : row.clientId ?? ''} options={clientOptions}
                        onChange={e => onChange(withClient(row, e.target.value || null, places))} />
                )}</Field>
                <Field label={t('task_location')} error={said('location')}>{p => (
                    <Select {...p} name="locationId" value={row.locationId ?? ''} options={[{ value: '', label: t('task_location_choose') }]} groups={groups}
                        onChange={e => onChange(withLocation(row, e.target.value || null))} />
                )}</Field>
            </div>
            <div className="ui-field-group">
                <AssigneeChecklist id="bulk-row-assignees" people={people} value={row.assigneeIds} onChange={ids => onChange(withPeople(row, ids))}
                    onRetry={onRetryPeople} retrying={retryingPeople} error={said('assignees')} />
                {row.unknownPeople.length > 0 && (
                    <div><Button size="sm" onClick={() => onChange(withoutUnknownPeople(row))}>{t('bulk_ignore_usernames')}</Button></div>
                )}
            </div>
            <DateTimePicker label={t('deadline_label')} value={row.deadline} onChange={v => onChange(withDeadline(row, v))}
                min={earliestDeadline(now).toISOString()} error={said('deadline')} />
            <Field label={t('difficulty')} hint={t('points_hint')} error={said('difficulty')}>{p => (
                <TextInput {...p} name="difficulty" type="number" inputMode="numeric" autoComplete="off" min={0} max={TASK_DIFFICULTY_MAX}
                    value={Number.isNaN(row.difficulty) ? '' : String(row.difficulty)}
                    onChange={e => {
                        const typed = parseInt(e.target.value, 10)
                        onChange({ ...row, difficulty: Number.isNaN(typed) ? Number.NaN : Math.min(Math.max(typed, 0), TASK_DIFFICULTY_MAX) })
                    }} />
            )}</Field>
        </div>
    )
}

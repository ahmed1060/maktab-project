'use client'
import { useId, useRef } from 'react'
import DateTimePicker from '@/components/DateTimePicker'
import TaskPlacePicker from '@/components/locations/TaskPlacePicker'
import { useLanguage } from '@/context/LanguageContext'
import { useNow } from '@/lib/useNow'
import { earliestDeadline } from '@/lib/deadline'
import { useBusyAction } from '@/lib/useBusyAction'
import { locationLabel } from '@/lib/locations'
import { Button, Dialog, DialogActions, Field, NamePicker, TextArea, TextInput } from '@/components/ui'
import { useListNames } from '@/components/lists/useListNames'

// A task's edit window, a dialog of the building blocks. Its form's values
// and errors live with the page, which fills them as it opens and sends
// them, so it's the form alone.
interface TaskEditDetailsModalProps {
    isOpen: boolean
    onClose: () => void
    onSubmit: (e: React.FormEvent) => Promise<void> | void
    editForm: {
        title: string
        titleEntryId: string | null
        description: string
        clientId: string
        locationId: string
        deadline: string
        difficulty: number
    }
    setEditForm: (form: any) => void
    editFieldErrors: { title: string, description: string, locationId: string }
    setEditFieldErrors: (errors: { title: string, description: string, locationId: string }) => void
    task: any
}

export default function TaskEditDetailsModal({ isOpen, onClose, onSubmit, editForm, setEditForm, editFieldErrors, setEditFieldErrors, task }: TaskEditDetailsModalProps) {
    const { t, locale } = useLanguage()
    // The deadline floor offered to the picker, kept current while the form
    // stays open. See lib/useNow.ts.
    const now = useNow()
    const action = useBusyAction()
    const titleNames = useListNames('TASK_TITLE', task.companyId)
    const formId = useId()
    const form = useRef<HTMLFormElement>(null)
    const num = (n: number) => n.toLocaleString(locale === 'ar' ? 'ar-EG' : 'en-GB')
    const used = (n: number, max: number) => t('ui_characters_used').replace('{used}', num(n)).replace('{max}', num(max))
    const names = (task.assignees ?? []).map((a: any) => `${a.firstName} ${a.lastName}`)

    return (
        <Dialog open={isOpen} onClose={onClose} title={t('edit_task_details_title')}>
            <form ref={form} id={formId} className="ui-form" noValidate onSubmit={e => {
                e.preventDefault()
                void action.run('save', async () => {
                    await onSubmit(e)
                    // To the first field that needs fixing, once it's marked; saved, the dialog is gone.
                    requestAnimationFrame(() => form.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus())
                })
            }}>
                {/* Typed, or picked from the company's task titles (CLIENTS_PLAN.md §5). */}
                <Field label={t('title_label')} hint={used(editForm.title.length, 100)} error={editFieldErrors.title || undefined}>{p => (
                    <NamePicker
                        {...p}
                        value={{ text: editForm.title, entryId: editForm.titleEntryId }}
                        onChange={next => { setEditForm({ ...editForm, title: next.text, titleEntryId: next.entryId }); setEditFieldErrors({ ...editFieldErrors, title: '' }) }}
                        {...titleNames}
                        addLabel={t('lists_add_to_list')}
                        failedLabel={t('lists_add_failed')}
                        maxLength={100}
                    />
                )}</Field>
                <Field label={t('description_label')} hint={used(editForm.description.length, 1000)} error={editFieldErrors.description || undefined}>{p => (
                    <TextArea {...p} name="description" dir="auto" rows={4} maxLength={1000} value={editForm.description}
                        onChange={e => { setEditForm({ ...editForm, description: e.target.value }); setEditFieldErrors({ ...editFieldErrors, description: '' }) }} />
                )}</Field>
                {/* Its client and its location, picked again (CLIENTS_PLAN.md §2.3, §3.1). */}
                <TaskPlacePicker
                    value={{ clientId: editForm.clientId, locationId: editForm.locationId }}
                    onChange={next => { setEditForm({ ...editForm, ...next }); setEditFieldErrors({ ...editFieldErrors, locationId: '' }) }}
                    companyId={task.companyId}
                    current={task.place && task.locationId ? { id: task.locationId, label: locationLabel(task.place.name, task.place.client?.name) } : null}
                    currentClient={task.client && task.clientId ? { id: task.clientId, name: task.client.name } : null}
                    error={editFieldErrors.locationId || undefined}
                />
                {/* Who it's for changes with Transfer task, not here. */}
                <div className="ui-field">
                    <span className="ui-label">{t('assignees_label')}</span>
                    <p><bdi>{names.length ? new Intl.ListFormat(locale === 'ar' ? 'ar' : 'en', { type: 'conjunction' }).format(names) : t('no_assignee')}</bdi></p>
                    <span className="ui-hint">{t('transfer_notice')}</span>
                </div>
                {/* At least 3 hours out, as the server needs (TaskService.updateDetails), as Create task's is. */}
                <DateTimePicker asField label={t('deadline_label')} value={editForm.deadline} onChange={v => setEditForm({ ...editForm, deadline: v })} min={earliestDeadline(now).toISOString()} />
                <Field label={t('difficulty')} hint={t('points_hint')}>{p => (
                    <TextInput {...p} type="number" inputMode="numeric" name="difficulty" autoComplete="off" min={0} max={10} value={editForm.difficulty}
                        onChange={e => setEditForm({ ...editForm, difficulty: parseInt(e.target.value) || 0 })} />
                )}</Field>
                <DialogActions>
                    <Button onClick={onClose}>{t('cancel')}</Button>
                    <Button type="submit" variant="primary" disabled={action.running} busy={action.is('save')}>{t('save_changes_button')}</Button>
                </DialogActions>
            </form>
        </Dialog>
    )
}

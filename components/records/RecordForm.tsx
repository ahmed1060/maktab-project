'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { useLanguage } from '@/context/LanguageContext'
import { useToast } from '@/context/ToastContext'
import DatePickerSingle from '@/components/DatePickerSingle'
import { Button, Dialog, Field, FileChip, FileChips, FilePicker, Select, TextArea, TextInput } from '@/components/ui'
import { RECORD_FILES_FOLDER, RECORD_FILES_MAX, RECORD_FILE_ACCEPT, RECORD_FILE_MAX_BYTES, type RecordFile } from '@/lib/record-files'
import { RECORD_TEXT_MAX, REMINDER_DAYS_MAX, SECTION_TITLE_MAX } from '@/lib/validations/record.schema'
import type { RecordItem, SectionItem } from './types'

const NEW_SECTION = '__new__'
const KINDS = RECORD_FILE_ACCEPT.split(',')

type Errors = Partial<Record<'section' | 'content' | 'files' | 'reminder', string>>

/** Files uploaded for a record that isn't saved with them: removed again, without waiting. */
function discard(urls: string[]) {
    if (!urls.length) return
    void fetch('/api/records/uploads', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ urls }),
        keepalive: true,
    }).catch(() => {})
}

/**
 * Adding a record to a client, or editing one (CLIENTS_PLAN.md §0.2): its
 * section, its text, its files and its expiry date with a reminder. A
 * client's first record names its first section. New files upload when it's
 * saved, so a cancelled form leaves nothing behind: once uploaded, a file
 * is kept for another try if the save fails, and removed again if the form
 * closes without saving it.
 */
export default function RecordForm({ open, onClose, vendorId, sections, record, onSaved }: {
    open: boolean
    onClose: () => void
    vendorId: string
    sections: SectionItem[]
    /** The record being edited; none to add one. */
    record?: RecordItem | null
    onSaved: () => void
}) {
    // Mounted afresh each time it opens, so it starts from the record as it is.
    if (!open) return null
    return <Form onClose={onClose} vendorId={vendorId} sections={sections} record={record ?? null} onSaved={onSaved} />
}

function Form({ onClose, vendorId, sections, record, onSaved }: {
    onClose: () => void
    vendorId: string
    sections: SectionItem[]
    record: RecordItem | null
    onSaved: () => void
}) {
    const { t, locale } = useLanguage()
    const { showToast } = useToast()
    const formId = useId()
    const form = useRef<HTMLFormElement>(null)
    const editing = record !== null
    const [sectionId, setSectionId] = useState(record?.section.id ?? sections[0]?.id ?? NEW_SECTION)
    const [sectionTitle, setSectionTitle] = useState('')
    const [content, setContent] = useState(record?.content ?? '')
    const [kept, setKept] = useState<RecordFile[]>(record?.files ?? [])
    const [picked, setPicked] = useState<File[]>([])
    const [expiryDate, setExpiryDate] = useState(record?.expiryDate ?? '')
    const [reminderDays, setReminderDays] = useState(record?.reminderDays ? String(record.reminderDays) : '')
    const [errors, setErrors] = useState<Errors>({})
    const [saving, setSaving] = useState(false)
    // What this form uploaded that no saved record has yet.
    const unsaved = useRef<string[]>([])
    // A save on its way, and whether the form has closed since it began.
    const inFlight = useRef(false)
    const closed = useRef(false)
    useEffect(() => {
        const list = unsaved.current
        closed.current = false
        return () => {
            closed.current = true
            // A save still on its way may yet keep them: it decides once it hears back.
            if (!inFlight.current) discard(list.splice(0))
        }
    }, [])

    const newSection = sectionId === NEW_SECTION
    const num = (n: number) => n.toLocaleString(locale === 'ar' ? 'ar-EG' : 'en-GB')

    const addFiles = (files: File[]) => {
        const room = RECORD_FILES_MAX - kept.length - picked.length
        const ok: File[] = []
        let problem: string | undefined
        for (const f of files) {
            const kind = f.name.slice(f.name.lastIndexOf('.')).toLowerCase()
            if (!KINDS.includes(kind)) problem = t('records_file_wrong_kind').replace('{name}', f.name)
            else if (f.size > RECORD_FILE_MAX_BYTES) problem = t('records_file_too_large').replace('{name}', f.name)
            else if (ok.length >= room) problem = t('records_too_many_files')
            else ok.push(f)
        }
        setPicked(p => [...p, ...ok])
        setErrors(e => ({ ...e, files: problem }))
    }

    const check = (): Errors => {
        const found: Errors = {}
        if (newSection && !sectionTitle.trim()) found.section = t('records_section_required')
        if (!content.trim()) found.content = t('records_text_required')
        const days = reminderDays.trim()
        if (days) {
            const n = Number(days)
            if (!expiryDate) found.reminder = t('records_reminder_needs_date')
            else if (!Number.isInteger(n) || n < 1 || n > REMINDER_DAYS_MAX) found.reminder = t('records_reminder_range')
        }
        return found
    }

    const upload = async (file: File): Promise<RecordFile> => {
        const form = new FormData()
        form.append('file', file)
        form.append('folder', RECORD_FILES_FOLDER)
        const res = await fetch('/api/upload', { method: 'POST', body: form })
        const body = await res.json().catch(() => null)
        if (!res.ok || !body?.data?.url) throw new Error(body?.error || t('records_upload_failed').replace('{name}', file.name))
        return { url: body.data.url, name: file.name, size: file.size, type: file.type || 'application/octet-stream', uploadedAt: new Date().toISOString() }
    }

    const save = async (e: React.FormEvent) => {
        e.preventDefault()
        const found = check()
        setErrors(found)
        if (Object.values(found).some(Boolean)) {
            // To the first field that needs fixing, once it's marked.
            requestAnimationFrame(() => form.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus())
            return
        }
        setSaving(true)
        inFlight.current = true
        try {
            // Each upload joins the kept files at once, so a failed save isn't uploaded again.
            let files = kept
            for (const file of picked) {
                const done = await upload(file)
                unsaved.current.push(done.url)
                files = [...files, done]
                setKept(files)
                setPicked(p => p.filter(f => f !== file))
            }
            const days = reminderDays.trim()
            const fields = {
                content: content.trim(),
                files,
                expiryDate: expiryDate || null,
                reminderDays: expiryDate && days ? Number(days) : null,
            }
            const where = editing
                ? { id: record!.id, sectionId }
                : newSection ? { vendorId, sectionTitle: sectionTitle.trim() } : { sectionId }
            const res = await fetch('/api/records', {
                method: editing ? 'PUT' : 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ...fields, ...where }),
            })
            const body = await res.json().catch(() => null)
            if (!res.ok) {
                showToast(body?.error || t('error_generic'), 'error')
                return
            }
            // Saved with the record now, but for any taken off again before this save.
            const saved = new Set(files.map(f => f.url))
            discard(unsaved.current.splice(0).filter(url => !saved.has(url)))
            showToast(t(editing ? 'records_saved' : 'records_added'), 'success')
            onSaved()
            onClose()
        } catch (error) {
            showToast(error instanceof Error && error.message ? error.message : t('error_generic'), 'error')
        } finally {
            inFlight.current = false
            // Closed while it saved: what it uploaded and didn't save goes now (none, if it saved).
            if (closed.current) discard(unsaved.current.splice(0))
            setSaving(false)
        }
    }

    const sectionOptions = [
        ...sections.map(s => ({ value: s.id, label: s.title })),
        ...(editing ? [] : [{ value: NEW_SECTION, label: t('records_new_section') }]),
    ]

    return (
        <Dialog
            open
            onClose={() => { if (!saving) onClose() }}
            title={t(editing ? 'records_edit' : 'records_add')}
            actions={<>
                <Button onClick={onClose} disabled={saving}>{t('cancel')}</Button>
                <Button type="submit" form={formId} variant="primary" busy={saving}>{t(editing ? 'records_save' : 'records_add')}</Button>
            </>}
        >
            <form ref={form} id={formId} onSubmit={save} className="ui-dialog-body" noValidate>
                {sections.length > 0 && (
                    <Field label={t('records_section')}>{p => (
                        <Select {...p} value={sectionId} onChange={e => setSectionId(e.target.value)} options={sectionOptions} disabled={saving} />
                    )}</Field>
                )}
                {newSection && (
                    <Field label={t('records_section_name')} hint={sections.length === 0 ? t('records_first_section_hint') : undefined} error={errors.section}>{p => (
                        <TextInput {...p} value={sectionTitle} onChange={e => setSectionTitle(e.target.value)} maxLength={SECTION_TITLE_MAX} autoComplete="off" disabled={saving} />
                    )}</Field>
                )}
                <Field label={t('records_text')} hint={t('ui_characters_used').replace('{used}', num(content.length)).replace('{max}', num(RECORD_TEXT_MAX))} error={errors.content}>{p => (
                    <TextArea {...p} value={content} onChange={e => setContent(e.target.value)} maxLength={RECORD_TEXT_MAX} rows={4} disabled={saving} />
                )}</Field>
                <div className="ui-field">
                    <span className="ui-label">{t('records_files')}</span>
                    {(kept.length > 0 || picked.length > 0) && (
                        <FileChips label={t('records_files')}>
                            {kept.map(f => (
                                <FileChip key={f.url} name={f.name} size={f.size} href={f.url} onRemove={saving ? undefined : () => setKept(k => k.filter(x => x.url !== f.url))} />
                            ))}
                            {picked.map((f, i) => (
                                <FileChip key={`${f.name}-${i}`} name={f.name} size={f.size} onRemove={saving ? undefined : () => setPicked(p => p.filter((_, j) => j !== i))} />
                            ))}
                        </FileChips>
                    )}
                    <FilePicker label={t('records_attach')} hint={t('records_files_hint')} accept={RECORD_FILE_ACCEPT} onFiles={addFiles} disabled={saving || kept.length + picked.length >= RECORD_FILES_MAX} />
                    {errors.files && <span className="ui-error" role="alert">{errors.files}</span>}
                </div>
                <DatePickerSingle asField label={t('records_expiry_date')} value={expiryDate} onChange={setExpiryDate} disabled={saving} />
                <Field label={t('records_reminder')} hint={t('records_reminder_hint')} error={errors.reminder}>{p => (
                    <TextInput {...p} type="number" inputMode="numeric" autoComplete="off" min={1} max={REMINDER_DAYS_MAX} value={reminderDays} onChange={e => setReminderDays(e.target.value)} disabled={saving || !expiryDate} />
                )}</Field>
            </form>
        </Dialog>
    )
}

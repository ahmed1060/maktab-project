'use client'

import { useId, useState } from 'react'
import { useLanguage } from '@/context/LanguageContext'
import { useToast } from '@/context/ToastContext'
import { Button, Choice, Details, Dialog, Field, FileChip, FileChips, FilePicker, TextArea, TextInput } from '@/components/ui'
import {
    CASH_ADVANCE_NOTE_MAX, HANDOVER_ACCEPT, HANDOVER_FOLDER, balanceAfter, refusalText, signedAmount, todayHere, type RecordedKind,
} from '@/lib/cash-advances'
import { useAdjustOnChange } from '@/lib/useAdjustOnChange'
import type { TranslationKey } from '@/lib/translations'
import type { AdvancePerson } from './types'

const TITLE: Record<RecordedKind, TranslationKey> = { GIVEN: 'advances_give_title', RETURNED: 'advances_return_title', CORRECTION: 'advances_correct_title' }
const SAVE: Record<RecordedKind, TranslationKey> = { GIVEN: 'advances_give', RETURNED: 'advances_record_return', CORRECTION: 'advances_save_correction' }
const DONE: Record<RecordedKind, TranslationKey> = { GIVEN: 'advances_given_done', RETURNED: 'advances_returned_done', CORRECTION: 'advances_corrected_done' }

/**
 * Give advance, Record return or Correction (CLIENTS_PLAN.md §7.3, §7.4):
 * the amount, the day the money changed hands and a note, and for an
 * advance given, a photo of the signed hand-over. A return is never more
 * than they hold, and a correction says why and never takes the balance
 * below zero. The server asks for two-factor sign-in.
 */
export default function CashAdvanceDialog({ person, kind, today: companyToday, onClose, onSaved }: {
    person: AdvancePerson | null
    kind: RecordedKind
    /** Today where the company is, as the server says: the day it opens on, and the last it takes. */
    today?: string
    onClose: () => void
    onSaved: () => void
}) {
    const { t, locale } = useLanguage()
    const { showToast } = useToast()
    const formId = useId()
    const [amount, setAmount] = useState('')
    const [direction, setDirection] = useState<'add' | 'take'>('add')
    const today = companyToday ?? todayHere()
    const [date, setDate] = useState(today)
    const [note, setNote] = useState('')
    const [photo, setPhoto] = useState<File | null>(null)
    const [saving, setSaving] = useState(false)
    // The photo, once uploaded: a try again after a refusal sends the same file.
    const [uploaded, setUploaded] = useState<{ file: File; url: string } | null>(null)

    useAdjustOnChange([person?.id, kind], () => {
        setAmount(''); setDirection('add'); setDate(today); setNote(''); setPhoto(null); setUploaded(null)
    })

    const balance = person?.balance ?? 0
    const typed = direction === 'take' && kind === 'CORRECTION' ? `-${amount.trim()}` : amount
    const signed = amount.trim() === '' ? null : signedAmount(kind, typed)
    const after = signed === null ? null : balanceAfter(balance, signed)
    const amountError = amount.trim() === '' ? undefined
        : signed === null ? t('advances_amount_invalid')
            : after === null ? t(kind === 'RETURNED' ? 'advances_more_than_held' : 'advances_below_zero')
                : undefined
    const dateError = date && date > today ? t('advances_date_invalid') : undefined
    const noteError = note.length > CASH_ADVANCE_NOTE_MAX ? t('advances_note_too_long') : undefined
    const ready = signed !== null && after !== null && !!date && !dateError && !noteError && (kind !== 'CORRECTION' || note.trim() !== '')

    const money = (n: number) => `${n.toLocaleString(locale === 'ar' ? 'ar-EG' : 'en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${t('egp')}`

    /** The photo, uploaded to the company's hand-overs folder, unless it already was. */
    const photoUrl = async (): Promise<string | null> => {
        if (!photo) return null
        if (uploaded?.file === photo) return uploaded.url
        const form = new FormData()
        form.append('file', photo)
        form.append('folder', HANDOVER_FOLDER)
        const res = await fetch('/api/upload', { method: 'POST', body: form }).catch(() => null)
        const result = res?.ok ? await res.json().catch(() => null) : null
        if (!result?.success || typeof result.data?.url !== 'string') throw new Error(t('advances_photo_upload_failed'))
        setUploaded({ file: photo, url: result.data.url })
        return result.data.url as string
    }

    const save = async (e?: { preventDefault: () => void }) => {
        e?.preventDefault()
        if (!person || !ready || saving) return
        setSaving(true)
        try {
            const res = await fetch(`/api/cash-advances/${encodeURIComponent(person.id)}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ kind, amount: kind === 'CORRECTION' ? signed : Math.abs(signed!), date, note: note.trim() || null, photoUrl: kind === 'GIVEN' ? await photoUrl() : null }),
            })
            const answer = await res.json().catch(() => null)
            if (!res.ok) {
                showToast(refusalText(t, answer), 'error')
                return
            }
            showToast(t(DONE[kind]), 'success')
            onSaved()
            onClose()
        } catch (error) {
            showToast(error instanceof Error && error.message ? error.message : t('error_generic'), 'error')
        } finally {
            setSaving(false)
        }
    }

    return (
        <Dialog
            open={!!person}
            onClose={() => { if (!saving) onClose() }}
            title={t(TITLE[kind]).replace('{name}', person?.name ?? '')}
            actions={<>
                <Button onClick={onClose} disabled={saving}>{t('cancel')}</Button>
                <Button type="submit" form={formId} variant="primary" busy={saving} disabled={!ready}>{t(SAVE[kind])}</Button>
            </>}
        >
            <form id={formId} onSubmit={save} className="ui-dialog-body" noValidate>
                <p className="ui-hint">{t(kind === 'GIVEN' ? 'advances_give_hint' : kind === 'RETURNED' ? 'advances_return_hint' : 'advances_correct_hint')}</p>
                <Details items={[
                    { label: t('advances_col_balance'), value: <span className="ui-num">{money(balance)}</span> },
                    ...(after !== null ? [{ label: t('advances_balance_after'), value: <span className="ui-num">{money(after)}</span> }] : []),
                ]} />
                {kind === 'CORRECTION' && (
                    <Choice
                        legend={t('advances_correct_direction')}
                        name="direction"
                        value={direction}
                        onChange={setDirection}
                        options={[{ value: 'add', label: t('advances_correct_add') }, { value: 'take', label: t('advances_correct_take') }]}
                    />
                )}
                <Field label={t('advances_amount')} error={amountError}>{p => (
                    <TextInput {...p} name="amount" autoComplete="off" type="number" inputMode="decimal" min={0.01} step="0.01" value={amount} onChange={e => setAmount(e.target.value)} />
                )}</Field>
                <Field label={t('advances_date')} error={dateError}>{p => (
                    <TextInput {...p} name="date" autoComplete="off" type="date" max={today} value={date} onChange={e => setDate(e.target.value)} />
                )}</Field>
                <Field label={t(kind === 'CORRECTION' ? 'advances_reason' : 'advances_note')} hint={t(kind === 'CORRECTION' ? 'advances_reason_hint' : 'advances_note_hint')} error={noteError}>{p => (
                    <TextArea {...p} name="note" autoComplete="off" rows={2} maxLength={CASH_ADVANCE_NOTE_MAX} value={note} onChange={e => setNote(e.target.value)} />
                )}</Field>
                {kind === 'GIVEN' && (
                    <div className="ui-field">
                        {photo && (
                            <FileChips label={t('advances_photo')}>
                                <FileChip name={photo.name} size={photo.size} onRemove={() => setPhoto(null)} />
                            </FileChips>
                        )}
                        <FilePicker label={t('advances_photo_attach')} hint={t('advances_photo_hint')} accept={HANDOVER_ACCEPT} onFiles={files => setPhoto(files[0] ?? null)} disabled={saving} multiple={false} />
                    </div>
                )}
            </form>
        </Dialog>
    )
}

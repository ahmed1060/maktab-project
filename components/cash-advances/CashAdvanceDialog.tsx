'use client'

import { useId, useState } from 'react'
import useSWR from 'swr'
import { useLanguage } from '@/context/LanguageContext'
import { useToast } from '@/context/ToastContext'
import DatePickerSingle from '@/components/DatePickerSingle'
import { Button, Choice, Details, Dialog, Field, FileChip, FileChips, FilePicker, Select, TextArea, TextInput } from '@/components/ui'
import {
    CASH_ADVANCE_NOTE_MAX, HANDOVER_ACCEPT, HANDOVER_FOLDER, balanceAfter, refusalText, signedAmount, todayHere, type RecordedKind,
} from '@/lib/cash-advances'
import { useAdjustOnChange } from '@/lib/useAdjustOnChange'
import { useBusyAction } from '@/lib/useBusyAction'
import { useLive } from '@/components/LiveUpdates'
import type { TranslationKey } from '@/lib/translations'
import { fetcher } from '@/lib/swr-fetcher'
import type { AdvancePerson, HeldFor, Owed } from './types'

const TITLE: Record<RecordedKind, TranslationKey> = { GIVEN: 'advances_give_title', RETURNED: 'advances_return_title', CORRECTION: 'advances_correct_title' }
const SAVE: Record<RecordedKind, TranslationKey> = { GIVEN: 'advances_give', RETURNED: 'advances_record_return', CORRECTION: 'advances_save_correction' }
const DONE: Record<RecordedKind, TranslationKey> = { GIVEN: 'advances_given_done', RETURNED: 'advances_returned_done', CORRECTION: 'advances_corrected_done' }

/**
 * Give advance, Record return or Correction (CLIENTS_PLAN.md §7.3, §7.4):
 * the amount, the day the money changed hands and a note, and for an
 * advance given, a photo of the signed hand-over. A return is never more
 * than they hold, and a correction says why and never takes the balance
 * below zero. The server asks for two-factor sign-in.
 *
 * An advance given says what it's for: any cost, one of the open tasks the
 * person is on, or one of the company's clients (CLIENTS_PLAN.md §7.9). A
 * return or a correction says which part of the advance it's on, where
 * they hold money for a task or a client, and never takes that part below
 * zero.
 *
 * What they hold is drawn again as it changes elsewhere while it's open
 * (REALTIME_PLAN.md, part 4a), and what's typed stays. Saving is the
 * person's own change, said to the list behind it as it starts (ActionStarts),
 * so it isn't tinted there.
 */

/** A part of a person's advance, as the From field picks it: "" for the running balance. */
const partKey = (part: { forTask: { id: string } | null; forClient: { id: string } | null }) =>
    part.forTask ? `task:${part.forTask.id}` : part.forClient ? `client:${part.forClient.id}` : ''
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
    const action = useBusyAction()
    const saving = action.running
    // The photo, once uploaded: a try again after a refusal sends the same file.
    const [uploaded, setUploaded] = useState<{ file: File; url: string } | null>(null)
    // What the company owes them, offered with the advance (CLIENTS_PLAN.md §7.3): asked for as it opens.
    const [payOwed, setPayOwed] = useState<'yes' | 'no'>('no')
    // What it's for, an advance given (§7.9), or which part a return or a correction is on.
    const [forKind, setForKind] = useState<'any' | 'task' | 'client'>('any')
    const [forId, setForId] = useState('')
    const [from, setFrom] = useState('')
    const { data: about, mutate: refreshAbout } = useSWR<{ data: { balance: number; owed: Owed | null; running: number; held: HeldFor[] } }>(person ? `/api/cash-advances/${encodeURIComponent(person.id)}?limit=1` : null, fetcher)
    useLive('advances', () => { void refreshAbout() })
    const owed = kind === 'GIVEN' ? about?.data?.owed ?? null : null
    const held = about?.data?.held ?? []
    const { data: offered } = useSWR<{ data: { tasks: { id: string; title: string }[]; clients: { id: string; name: string }[] } }>(
        person && kind === 'GIVEN' ? `/api/cash-advances/${encodeURIComponent(person.id)}/purposes` : null, fetcher)
    const choices = forKind === 'task'
        ? (offered?.data?.tasks ?? []).map(task => ({ value: task.id, label: task.title }))
        : (offered?.data?.clients ?? []).map(client => ({ value: client.id, label: client.name }))

    useAdjustOnChange([person?.id, kind], () => {
        setAmount(''); setDirection('add'); setDate(today); setNote(''); setPhoto(null); setUploaded(null); setPayOwed('no')
        setForKind('any'); setForId(''); setFrom('')
    })

    // A return or a correction is on the part picked: the running balance, or what's for a task or a client.
    const picked = held.find(part => partKey(part) === from)
    // As the server says now, once it's answered: the list's row may be older.
    const balance = kind === 'GIVEN' ? about?.data?.balance ?? person?.balance ?? 0 : picked ? picked.amount : about?.data?.running ?? person?.balance ?? 0
    const balanceLabel = kind === 'GIVEN' || held.length === 0 ? t('advances_col_balance')
        : picked ? t('advances_for_name').replace('{name}', picked.forTask?.title ?? picked.forClient?.name ?? '') : t('advances_running')
    const typed = direction === 'take' && kind === 'CORRECTION' ? `-${amount.trim()}` : amount
    const signed = amount.trim() === '' ? null : signedAmount(kind, typed)
    const after = signed === null ? null : balanceAfter(balance, signed)
    const amountError = amount.trim() === '' ? undefined
        : signed === null ? t('advances_amount_invalid')
            : after === null ? t(kind === 'RETURNED' ? 'advances_more_than_held' : 'advances_below_zero')
                : undefined
    const dateError = date && date > today ? t('advances_date_invalid') : undefined
    const noteError = note.length > CASH_ADVANCE_NOTE_MAX ? t('advances_note_too_long') : undefined
    const forChosen = kind !== 'GIVEN' || forKind === 'any' || !!forId
    const ready = signed !== null && after !== null && !!date && !dateError && !noteError && (kind !== 'CORRECTION' || note.trim() !== '') && forChosen

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

    const save = (e?: { preventDefault: () => void }) => {
        e?.preventDefault()
        if (!person || !ready) return
        void action.run('save', () => send(person))
    }

    const send = async (person: AdvancePerson) => {
        try {
            const res = await fetch(`/api/cash-advances/${encodeURIComponent(person.id)}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    kind, amount: kind === 'CORRECTION' ? signed : Math.abs(signed!), date, note: note.trim() || null, photoUrl: kind === 'GIVEN' ? await photoUrl() : null,
                    forTaskId: kind === 'GIVEN' ? (forKind === 'task' ? forId : null) : picked?.forTask?.id ?? null,
                    forClientId: kind === 'GIVEN' ? (forKind === 'client' ? forId : null) : picked?.forClient?.id ?? null,
                }),
            })
            const answer = await res.json().catch(() => null)
            if (!res.ok) {
                showToast(refusalText(t, answer), 'error')
                return
            }
            // What they hold for each part has moved: the next entry opens on it as it is now.
            void refreshAbout()
            // And what they're owed, exactly as it said, as Mark all as paid pays their costs (§4.1).
            const paying = owed && payOwed === 'yes' ? owed : null
            if (paying) {
                const paid = await fetch('/api/tasks/payment/bulk', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ filters: { employeeId: person.id }, confirm: { digest: paying.digest } }),
                }).catch(() => null)
                const paidAnswer = paid ? await paid.json().catch(() => null) : null
                if (!paid?.ok) showToast(paidAnswer?.code === 'PAYMENT_LIST_CHANGED' ? t('advances_owed_changed') : t('advances_owed_failed'), 'warning')
                else showToast(t('advances_given_and_paid').replace('{amount}', money(paying.amount)), 'success')
            } else {
                showToast(t(DONE[kind]), 'success')
            }
            onSaved()
            onClose()
        } catch (error) {
            showToast(error instanceof Error && error.message ? error.message : t('error_generic'), 'error')
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
                {kind !== 'GIVEN' && held.length > 0 && (
                    <Field label={t('advances_from')}>{p => (
                        <Select {...p} name="from" value={from} onChange={e => setFrom(e.target.value)} options={[
                            { value: '', label: `${t('advances_running')}: ${money(about?.data?.running ?? 0)}` },
                            // The name isolated, so a name in the other script keeps its place beside the amount.
                            ...held.map(part => ({ value: partKey(part), label: `\u2068${part.forTask?.title ?? part.forClient?.name ?? ''}\u2069: ${money(part.amount)}` })),
                        ]} />
                    )}</Field>
                )}
                <Details items={[
                    { label: balanceLabel, value: <span className="ui-num">{money(balance)}</span> },
                    ...(after !== null ? [{ label: t('advances_balance_after'), value: <span className="ui-num">{money(after)}</span> }] : []),
                ]} />
                {kind === 'GIVEN' && (
                    <Choice
                        legend={t('advances_for')}
                        name="for"
                        value={forKind}
                        onChange={value => { setForKind(value); setForId('') }}
                        options={[{ value: 'any', label: t('advances_for_any') }, { value: 'task', label: t('advances_for_task') }, { value: 'client', label: t('advances_for_client') }]}
                    />
                )}
                {kind === 'GIVEN' && forKind !== 'any' && (
                    choices.length > 0
                        ? <Field label={t(forKind === 'task' ? 'advances_pick_task' : 'advances_pick_client')} hint={t('advances_for_hint')}>{p => (
                            <Select {...p} name="forId" value={forId} onChange={e => setForId(e.target.value)} options={[{ value: '', label: t(forKind === 'task' ? 'advances_choose_task' : 'advances_choose_client') }, ...choices]} />
                        )}</Field>
                        : offered && <p className="ui-hint">{t(forKind === 'task' ? 'advances_no_open_tasks' : 'advances_no_clients')}</p>
                )}
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
                <DatePickerSingle name="date" label={t('advances_date')} value={date} maxDate={today} error={dateError} onChange={setDate} />
                <Field label={t(kind === 'CORRECTION' ? 'advances_reason' : 'advances_note')} hint={t(kind === 'CORRECTION' ? 'advances_reason_hint' : 'advances_note_hint')} error={noteError}>{p => (
                    <TextArea {...p} name="note" autoComplete="off" rows={2} maxLength={CASH_ADVANCE_NOTE_MAX} value={note} onChange={e => setNote(e.target.value)} />
                )}</Field>
                {owed && (
                    <Choice
                        legend={t('advances_owed_title').replace('{name}', person?.name ?? '').replace('{amount}', money(owed.amount))}
                        name="payOwed"
                        value={payOwed}
                        onChange={setPayOwed}
                        options={[
                            { value: 'yes', label: t('advances_owed_pay').replace('{amount}', money(owed.amount)) },
                            { value: 'no', label: t('advances_owed_not_now') },
                        ]}
                    />
                )}
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

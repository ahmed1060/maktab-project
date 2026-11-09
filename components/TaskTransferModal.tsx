'use client'

import { useId, useState } from 'react'
import useSWR from 'swr'
import AssigneeChecklist, { type Assignable } from '@/components/forms/AssigneeChecklist'
import { Button, Dialog, Field, Select } from '@/components/ui'
import { useLanguage } from '@/context/LanguageContext'
import { fetcher } from '@/lib/swr-fetcher'
import { useAdjustOnChange } from '@/lib/useAdjustOnChange'
import { fill } from '@/components/attendance-calendar/fill'
import type { TranslationKey } from '@/lib/translations'

/** What the transfer would do with what's held for the task (CLIENTS_PLAN.md §7.9, 7h). */
export type TransferPreview = {
    copy: boolean
    held: boolean
    moves: {
        person: { id: string; name: string }
        what: 'KEPT' | 'PASSED' | 'RUNNING'
        to: { id: string; name: string } | null
        /** Only for whoever may see their cash advance, or it's their own. */
        amount: number | null
    }[]
    pickReceiver: boolean
}

/** Each line's words: with its amount, or without where it isn't theirs to see. */
const LINE: Record<string, [TranslationKey, TranslationKey]> = {
    KEPT: ['transfer_held_kept', 'transfer_held_kept_hidden'],
    PASSED: ['transfer_held_passed', 'transfer_held_passed_hidden'],
    PICK: ['transfer_held_passed_pick', 'transfer_held_passed_pick_hidden'],
    RUNNING: ['transfer_held_running', 'transfer_held_running_hidden'],
}

/**
 * Moving a task to other people (DESIGN.md §5.5): the shared people
 * checklist, found by name, in a dialog. Who can be picked, and who is,
 * live with the page, which loads them and sends the transfer.
 *
 * Where anyone on it holds cash advance money for it (DESIGN.md §5.5,
 * Dialog; CLIENTS_PLAN.md §7.9, 7h), what happens to it for the people
 * picked, worked out by the server as the transfer will do it, under them;
 * and who takes what someone left off holds, where the copy has more than
 * one person. The main button waits for what's said to be for what's picked.
 */
export default function TaskTransferModal({ taskId, isOpen, onClose, people, onRetry, retrying, transferAssigneeIds, setTransferAssigneeIds, transferring, onTransfer }: {
    taskId: string
    isOpen: boolean
    onClose: () => void
    /** Undefined while they load, null when they couldn't be. */
    people: Assignable[] | null | undefined
    onRetry: () => void
    retrying: boolean
    transferAssigneeIds: string[]
    setTransferAssigneeIds: (ids: string[]) => void
    transferring: boolean
    /** With who takes what someone left off holds, where it's picked. */
    onTransfer: (heldGoesTo: string | null) => void
}) {
    const { t, locale } = useLanguage()
    const id = useId()
    const [goesTo, setGoesTo] = useState('')
    // Each time it opens, nobody's picked to take it yet.
    useAdjustOnChange([isOpen], () => { if (isOpen) setGoesTo('') })
    // Only someone it's going to; unpicked as they're taken off the list.
    const picked = transferAssigneeIds.includes(goesTo) ? goesTo : ''

    const key = isOpen && transferAssigneeIds.length > 0
        ? `/api/tasks/${encodeURIComponent(taskId)}/transfer?to=${transferAssigneeIds.map(encodeURIComponent).join(',')}&goesTo=${encodeURIComponent(picked)}`
        : null
    const { data, error, isValidating, mutate } = useSWR<{ data: TransferPreview }>(key, fetcher)
    const current = key && data ? data.data : null
    // The last one worked out stays while the next is, so the dialog doesn't jump.
    const [shown, setShown] = useState<TransferPreview | null>(null)
    useAdjustOnChange([current], () => { if (current) setShown(current) })
    const preview = current ?? shown
    const failed = !!error && !current

    const money = (n: number) => `${n.toLocaleString(locale === 'ar' ? 'ar-EG' : 'en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${t('egp')}`
    const nameOf = (person: string) => {
        const p = people?.find(x => x.id === person)
        return p ? `${p.firstName} ${p.lastName}`.trim() : ''
    }
    const line = (m: TransferPreview['moves'][number]) => {
        const [withAmount, without] = LINE[m.what === 'PASSED' && !m.to ? 'PICK' : m.what]
        return fill(t(m.amount === null ? without : withAmount), {
            name: <bdi>{m.person.name}</bdi>,
            amount: m.amount === null ? '' : <span className="ui-num">{money(m.amount)}</span>,
            to: <bdi>{m.to?.name ?? ''}</bdi>,
        })
    }

    // Waits for what's said to be for what's picked, and for a pick where one's needed.
    const ready = !!current && !(current.pickReceiver && !picked)
    const showsHeld = !!preview && (preview.moves.length > 0 || (!preview.copy && preview.held))

    return (
        <Dialog
            open={isOpen}
            onClose={onClose}
            title={t('transfer_task_title')}
            actions={<>
                <Button onClick={onClose}>{t('cancel')}</Button>
                <Button variant="primary" onClick={() => onTransfer(picked || null)} disabled={transferAssigneeIds.length === 0 || !ready} busy={transferring}>{t('confirm_transfer_button')}</Button>
            </>}
        >
            <p>{t('transfer_task_msg')}</p>
            <AssigneeChecklist
                people={people}
                value={transferAssigneeIds}
                onChange={setTransferAssigneeIds}
                onRetry={onRetry}
                retrying={retrying}
            />
            {failed ? (
                <div className="ui-transfer-held" aria-live="polite">
                    <p className="ui-error">{t('transfer_held_failed')}</p>
                    <Button size="sm" onClick={() => { void mutate() }} busy={isValidating}>{t('try_again')}</Button>
                </div>
            ) : showsHeld && preview && (
                // Said to screen readers as it changes: once it's in, not while the last stands in.
                <section className="ui-transfer-held" aria-labelledby={`${id}-held`} aria-live="polite" aria-busy={!current || undefined}>
                    <h3 id={`${id}-held`} className="ui-settlement-title">{t('transfer_held_title')}</h3>
                    {preview.copy
                        ? <ul className="ui-dialog-list">{preview.moves.map(m => <li key={m.person.id}>{line(m)}</li>)}</ul>
                        : <p>{t('transfer_held_stays')}</p>}
                    {preview.pickReceiver && (
                        <Field label={t('transfer_held_to_label')} hint={t('transfer_held_to_hint')}>{p => (
                            <Select {...p} name="heldGoesTo" value={picked} onChange={e => setGoesTo(e.target.value)} options={[
                                { value: '', label: t('transfer_held_to_none') },
                                ...transferAssigneeIds.map(person => ({ value: person, label: nameOf(person) })),
                            ]} />
                        )}</Field>
                    )}
                </section>
            )}
        </Dialog>
    )
}

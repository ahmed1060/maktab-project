'use client'
import { useRef, useState, type FormEvent } from 'react'
import { useLanguage } from '@/context/LanguageContext'
import { focusFirstWrong } from '@/components/attendance-calendar/focus'
import { Button, Dialog, DialogActions, Field, Select } from '@/components/ui'
import { handoffLeaders } from '@/lib/end-contract'
import { countOf } from '@/lib/plural'

export type Person = { id: string; firstName: string; lastName: string }
export type Leader = Person & { status?: string | null }

const fullName = (p: Person) => `${p.firstName} ${p.lastName}`.trim()

/**
 * "Move their team first", asked whenever something would take a Team Leader
 * away from the people who report to them: a demotion, an archive or a
 * company move on the profile's form, and ending their contract (a person's
 * profile, part 5, PR 195).
 *
 * One dialog for all of them, so the question reads the same wherever it's
 * asked and the answer is sent the same way: an id to move them, null to
 * leave them unassigned. Never an empty string, which is none of the three
 * states the server understands.
 *
 * Answered, it stays open until the change is sent, as a confirmation does
 * (DESIGN.md §5.5, Dialog): Cancel off and the main button busy. onConfirm
 * hands back why the leader picked can't take them, said under the leader,
 * or null once it's sent, when whoever opened it closes it.
 */
export function TeamHandOffDialog({ leaderId, leaderName, reports, leaders, onCancel, onConfirm }: {
    /** The leader who is going; never offered as the one to take them. */
    leaderId: string
    leaderName: string
    /** Who still reports to them, as the server named them. */
    reports: Person[]
    /** The company's team leaders, any of whom could take them; null while they load. */
    leaders: Leader[] | null
    onCancel: () => void
    onConfirm: (reassignTo: string | null) => Promise<string | null>
}) {
    const { t, locale } = useLanguage()
    const form = useRef<HTMLFormElement>(null)
    const [handoffTo, setHandoffTo] = useState('')
    const [error, setError] = useState<string | null>(null)
    const [busy, setBusy] = useState(false)
    const [before, after] = t('handoff_body').split('{name}')
    const count = countOf(t, locale, reports.length, 'employees')
    // While they load, the picker says so, and nothing's answered yet.
    const options = leaders === null
        ? [{ value: '', label: t('loading') }]
        : [{ value: '', label: t('handoff_unassign') }, ...handoffLeaders(leaders, leaderId).map(l => ({ value: l.id, label: fullName(l) }))]

    const cancel = () => { if (!busy) onCancel() }
    const submit = async (e: FormEvent<HTMLFormElement>) => {
        e.preventDefault()
        if (busy || leaders === null) return
        setError(null)
        setBusy(true)
        try {
            // The empty option means unassign, so it goes as null.
            const problem = await onConfirm(handoffTo || null)
            if (problem) {
                setError(problem)
                focusFirstWrong(form.current)
            }
        } finally {
            setBusy(false)
        }
    }

    return (
        <Dialog open onClose={cancel} title={t('handoff_title')}>
            <form ref={form} className="ui-form" noValidate onSubmit={submit}>
                <p>{before.replace('{count}', count)}<bdi>{leaderName}</bdi>{(after ?? '').replace('{count}', count)}</p>
                {/* Named, not counted. "7 people" is a number to accept; a
                    list is a decision an Admin can actually make. */}
                <ul className="ui-dialog-list">
                    {reports.map(r => <li key={r.id}><bdi>{fullName(r)}</bdi></li>)}
                </ul>
                <Field label={t('handoff_move_to')} hint={leaders !== null && handoffTo === '' ? t('handoff_unassign_note') : undefined} error={error ?? undefined}>{p => (
                    <Select {...p} name="handoffTo" value={handoffTo} options={options} disabled={busy || leaders === null}
                        onChange={e => { setHandoffTo(e.target.value); setError(null) }} />
                )}</Field>
                <DialogActions>
                    <Button onClick={cancel} disabled={busy}>{t('handoff_cancel')}</Button>
                    <Button type="submit" variant="primary" busy={busy} disabled={leaders === null}>{t('handoff_confirm')}</Button>
                </DialogActions>
            </form>
        </Dialog>
    )
}

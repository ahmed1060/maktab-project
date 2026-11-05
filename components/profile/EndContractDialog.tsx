'use client'
import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import useSWR from 'swr'
import { useLanguage } from '@/context/LanguageContext'
import { useToast } from '@/context/ToastContext'
import { focusFirstWrong } from '@/components/attendance-calendar/focus'
import { Button, Dialog, DialogActions, DocGroup, DocLine, DocNote, DocTotal, Field, TextArea, TextInput } from '@/components/ui'
import { apiErrorText } from '@/lib/api-error-text'
import { accessEndsNow, dayLabel, endContractRefusal, handoffRefusal, lastDayErrors, TEAM_LEADERS, undecidedDays, type Settlement } from '@/lib/end-contract'
import { countOf } from '@/lib/plural'
import { fetcher, fetchRetrying } from '@/lib/swr-fetcher'
import type { TranslationKey } from '@/lib/translations'
import { TeamHandOffDialog, type Leader, type Person } from './TeamHandOffDialog'

/** What the dialog has for a date: its settlement, why it can't be worked out, or that it didn't load. */
type Shown =
    | { for: string; settlement: Settlement; undecided: number }
    | { for: string; refused: TranslationKey }
    | { for: string; failed: true }

/** A text with {name} in it, the name kept whole in either direction. */
function Named({ text, name }: { text: string; name: string }) {
    const [before, after] = text.split('{name}')
    return <>{before}<bdi>{name}</bdi>{after}</>
}

/**
 * Ending someone's contract, with the settlement shown before it happens, or
 * reinstating one that was ended (a person's profile, part 5, PR 195): the
 * building blocks' dialog, as a form, under their name.
 *
 * The settlement is the reason this is a dialog of its own rather than a
 * status on the form. The same leaving date is money owed to them or money
 * owed back by them, depending on whether the month's salary had gone out,
 * and whoever picks the date sees which before they commit, not on a
 * statement a fortnight later. It's worked out again for each date, by the
 * same calculation that records it, and End contract waits for the date's
 * own: the figure confirmed is the figure recorded.
 *
 * What's wrong is said under the date where it's about it, above the buttons
 * otherwise, in the reader's language. A leader with a team is asked where it
 * goes first, in the hand-off, and the contract ends with the answer.
 */
export function EndContractDialog({ userId, name, status, leadsATeam = false, today, onClose, onDone }: {
    userId: string
    name: string
    /** ARCHIVED reinstates instead. */
    status: string
    /** They're a Team Leader, so a team may be theirs to hand over. */
    leadsATeam?: boolean
    /** Today in the company's calendar: the leaving date offered first, and what's past. */
    today: string
    onClose: () => void
    onDone: () => void
}) {
    const { t, locale } = useLanguage()
    const { showToast } = useToast()
    const ending = status !== 'ARCHIVED'
    const form = useRef<HTMLFormElement>(null)
    const [lastWorkingDay, setLastWorkingDay] = useState(today)
    const [reason, setReason] = useState('')
    const [shown, setShown] = useState<Shown | null>(null)
    // Asked for again, after a settlement that didn't load.
    const [attempt, setAttempt] = useState(0)
    const [errors, setErrors] = useState<{ lastWorkingDay?: string }>({})
    const [error, setError] = useState<string | null>(null)
    const [busy, setBusy] = useState(false)
    // Set when the server says they still lead a team: who's in it, for the hand-off to ask about.
    const [handoff, setHandoff] = useState<Person[] | null>(null)
    // Who could take them, asked for as it opens for a Team Leader, so they're
    // there when the question comes, and the picker has the focus; for anyone
    // else only if it comes. After its three tries, a picker left with only
    // Leave them unassigned.
    const { data: leadersAnswer, error: leadersError } = useSWR(handoff || leadsATeam ? TEAM_LEADERS : null, fetcher)
    const leaders: Leader[] | null = leadersError ? [] : leadersAnswer ? (leadersAnswer?.data?.data ?? []) : null

    useEffect(() => {
        if (!ending || !lastWorkingDay) return
        let cancelled = false
        // Debounced: a date typed in changes as each part is, and each would
        // be a settlement worked out.
        const timer = setTimeout(async () => {
            try {
                const res = await fetchRetrying(`/api/users/${encodeURIComponent(userId)}/employment?lastWorkingDay=${encodeURIComponent(lastWorkingDay)}`)
                const body = await res.json().catch(() => null)
                if (cancelled) return
                if (res.ok) {
                    setShown({ for: lastWorkingDay, settlement: body.data.preview, undecided: undecidedDays(body.data.timeline) })
                    return
                }
                // About the date, such as a month they had no salary in: said under it.
                const refused = endContractRefusal(body)
                setShown(refused && refused !== 'quiet' && refused.field ? { for: lastWorkingDay, refused: refused.key } : { for: lastWorkingDay, failed: true })
            } catch {
                if (!cancelled) setShown({ for: lastWorkingDay, failed: true })
            }
        }, 350)
        return () => { cancelled = true; clearTimeout(timer) }
    }, [userId, lastWorkingDay, ending, attempt])

    // What's on screen is the date's own: worked out for it, not for the one
    // before. Until it is, End contract waits.
    const current = shown?.for === lastWorkingDay ? shown : null
    const loading = ending && !!lastWorkingDay && !current
    // Nor once it didn't load: what it said, and Try again, are above it.
    const unavailable = !!current && 'failed' in current
    // The last one worked out stays while the next is, so the dialog doesn't jump.
    const settled = shown && 'settlement' in shown ? shown : null
    const refusedDate = current && 'refused' in current ? t(current.refused) : undefined

    /**
     * Ends the contract, or reinstates it. `reassignTo` is the hand-off's
     * answer: left out on the first attempt, so the server can ask, then an id
     * to move the team or null to leave them unassigned. Hands back why the
     * leader picked can't take them, for the hand-off to say under the leader.
     */
    const send = async (reassignTo?: string | null): Promise<string | null> => {
        setBusy(true)
        setError(null)
        try {
            const res = await fetch(`/api/users/${encodeURIComponent(userId)}/employment`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(ending ? {
                    action: 'END_CONTRACT',
                    lastWorkingDay,
                    reason: reason.trim() || undefined,
                    ...(reassignTo !== undefined && { reassignReportsTo: reassignTo }),
                } : { action: 'REINSTATE' }),
            })
            const text = await res.text()
            let answer: { code?: string; data?: { archivedNow?: boolean }; details?: { reports?: unknown } } | null = null
            try { answer = JSON.parse(text) } catch { /* not JSON: said as it came */ }
            if (res.ok) {
                // Said, as a contract ending later changes nothing on their details yet.
                showToast(!ending ? t('reinstate_done')
                    : answer?.data?.archivedNow ? t('end_contract_ended')
                        : t('end_contract_recorded').replace('{date}', dayLabel(lastWorkingDay, locale)), 'success')
                onDone()
                onClose()
                return null
            }
            // Not an error to report: a question to ask. The refusal names who
            // still reports to them.
            const reports = answer?.details?.reports
            if (Array.isArray(reports) && reports.length > 0) {
                setHandoff(reports as Person[])
                return null
            }
            const handedOff = reassignTo !== undefined ? handoffRefusal(answer) : null
            if (handedOff) return t(handedOff)
            setHandoff(null)
            const refused = endContractRefusal(answer)
            if (refused === 'quiet') return null
            if (refused?.field) {
                setErrors({ [refused.field]: t(refused.key) })
                focusFirstWrong(form.current)
            } else {
                setError(refused ? t(refused.key) : apiErrorText(text, t('error_generic')))
            }
            return null
        } catch {
            setHandoff(null)
            setError(t('error_generic'))
            return null
        } finally {
            setBusy(false)
        }
    }

    const submit = (e: FormEvent<HTMLFormElement>) => {
        e.preventDefault()
        if (busy) return
        if (ending) {
            // A date not typed in full reads as empty, as though left empty.
            const date = e.currentTarget.elements.namedItem('lastWorkingDay')
            const wrong = lastDayErrors({ lastWorkingDay, unreadable: date instanceof HTMLInputElement && date.validity.badInput })
            if (wrong.lastWorkingDay) {
                setErrors({ lastWorkingDay: t(wrong.lastWorkingDay) })
                focusFirstWrong(form.current)
                return
            }
            // Ended only as it's worked out for the date on the form.
            if (!current || !('settlement' in current)) {
                if (refusedDate) focusFirstWrong(form.current)
                return
            }
        }
        void send()
    }

    const cancel = () => { if (!busy) onClose() }

    return (
        <>
            <Dialog open onClose={cancel} title={<Named text={t(ending ? 'end_contract_title' : 'reinstate_title')} name={name} />}>
                <form ref={form} className="ui-form" noValidate onSubmit={submit}>
                    {ending ? (
                        <>
                            <Field label={t('last_working_day')} hint={t('last_working_day_hint')} error={errors.lastWorkingDay ?? refusedDate}>{p => (
                                <TextInput {...p} name="lastWorkingDay" type="date" autoComplete="off" value={lastWorkingDay} disabled={busy}
                                    onChange={e => { setLastWorkingDay(e.target.value); setErrors({}); setError(null) }} />
                            )}</Field>
                            {lastWorkingDay && !refusedDate && (
                                <SettlementPreview
                                    settlement={settled?.settlement ?? null}
                                    undecided={settled?.undecided ?? 0}
                                    stale={!!settled && settled.for !== lastWorkingDay}
                                    failed={unavailable}
                                    onRetry={() => { setShown(null); setAttempt(n => n + 1) }}
                                />
                            )}
                            <Field label={t('end_contract_reason')}>{p => (
                                <TextArea {...p} name="reason" dir="auto" rows={2} value={reason} disabled={busy} onChange={e => setReason(e.target.value)} />
                            )}</Field>
                            {lastWorkingDay && <p className="ui-hint">{t(accessEndsNow(lastWorkingDay, today) ? 'end_contract_effective_now' : 'end_contract_effective_later')}</p>}
                        </>
                    ) : (
                        <p>{t('reinstate_msg')}</p>
                    )}
                    {error && <p className="ui-error" role="alert">{error}</p>}
                    <DialogActions>
                        <Button onClick={cancel} disabled={busy}>{t('cancel')}</Button>
                        {ending
                            ? <Button type="submit" variant="danger" busy={busy} disabled={loading || unavailable}>{t('end_contract_confirm')}</Button>
                            : <Button type="submit" variant="primary" busy={busy}>{t('reinstate')}</Button>}
                    </DialogActions>
                </form>
            </Dialog>
            {handoff && (
                <TeamHandOffDialog
                    leaderId={userId}
                    leaderName={name}
                    reports={handoff}
                    leaders={leaders}
                    onCancel={() => setHandoff(null)}
                    onConfirm={reassignTo => send(reassignTo)}
                />
            )}
        </>
    )
}

/**
 * The settlement ending on a date would record, with the statement's own
 * lines, totals and notes (DESIGN.md §5.5, Document), as the statement will
 * have them once it's issued: what was paid taken off, the debts they owe
 * taken from what they're paid, who owes whom in the colour of what it means
 * for them, and where the figure for what was paid comes from. With the days
 * nobody has ruled on, treated as paid until somebody does.
 */
export function SettlementPreview({ settlement, undecided = 0, stale = false, failed = false, onRetry }: {
    settlement: Settlement | null
    undecided?: number
    /** Worked out for the date before, while the date picked's is. */
    stale?: boolean
    /** It didn't load, after its three tries. */
    failed?: boolean
    onRetry?: () => void
}) {
    const { t, locale } = useLanguage()
    const id = useId()
    // The sign is said in words (who owes whom), so the figure is shown without one.
    const money = (n: number) => new Intl.NumberFormat(locale === 'ar' ? 'ar-EG' : 'en-EG', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Math.abs(n))
    const count = (n: number) => n.toLocaleString(locale === 'ar' ? 'ar-EG' : 'en-GB')

    let content
    if (failed) {
        content = <>
            <p className="ui-error">{t('end_contract_preview_failed')}</p>
            <Button size="sm" onClick={onRetry}>{t('try_again')}</Button>
        </>
    } else if (!settlement) {
        content = <p className="ui-hint">{t('loading')}</p>
    } else {
        const held = settlement.cashAdvanceHeld ?? 0
        const remains = settlement.debtsOutstanding - settlement.debtRecovered
        // Chosen from the sign, in one place, so the words and the figure can't disagree.
        const verdict = {
            COMPANY_OWES: { text: t('settlement_company_owes'), tone: 'good' as const },
            PERSON_OWES: { text: t('settlement_person_owes'), tone: 'problem' as const },
            SETTLED: { text: t('settlement_settled'), tone: 'neutral' as const },
        }[settlement.direction]
        content = <>
            <DocGroup>
                <DocLine label={t('settlement_days_worked')} amount={count(settlement.daysWorked)} />
                <DocLine label={t('settlement_earned')} amount={money(settlement.earned)} />
                {/* No minus sign on nothing, as the statement has it. */}
                <DocLine label={t('settlement_paid')} amount={money(settlement.paid)} minus={settlement.paid !== 0} />
                <DocTotal label={t('settlement_net')} amount={money(settlement.net)} />
            </DocGroup>
            {/* What can't be taken out of the settlement stays a debt, said
                before the contract ends, not found on the statement after. */}
            {settlement.debtsOutstanding > 0 && (
                <DocGroup>
                    {/* Their cash advance, said before it becomes a debt (CLIENTS_PLAN.md §7.3). */}
                    {held > 0 && <p className="ui-hint">{t('settlement_advance_to_debt').replace('{amount}', money(held))}</p>}
                    <DocLine label={t('settlement_debt_recovered')} amount={money(settlement.debtRecovered)} minus={settlement.debtRecovered !== 0} />
                    <DocTotal label={t('settlement_payable')} amount={money(settlement.payable)} />
                </DocGroup>
            )}
            {remains > 0 && <DocNote tone="waiting">{t('settlement_debt_remains').replace('{amount}', money(remains))}</DocNote>}
            <DocNote tone={verdict.tone}>{verdict.text}</DocNote>
            {/* Said only when it's true. A month whose payroll isn't paid yet
                is the one to act on, so it isn't a quiet line as the other two. */}
            {settlement.paidSource === 'RUN_NOT_PAID'
                ? <DocNote tone="waiting">{t('settlement_run_not_paid')}</DocNote>
                : <p className="ui-hint">{t(settlement.paidSource === 'PAYSLIP' ? 'settlement_paid_from_payslip' : 'settlement_provisional')}</p>}
            {undecided > 0 && <DocNote tone="waiting">{t('end_contract_undecided').replace('{days}', countOf(t, locale, undecided, 'days'))}</DocNote>}
        </>
    }

    // Said to screen readers as it changes: once it's in, not while the last
    // date's figures stand in for the next.
    return (
        <section className="ui-settlement" aria-labelledby={id} aria-live="polite" aria-busy={stale || undefined}>
            <h3 id={id} className="ui-settlement-title">{t('settlement_preview')}</h3>
            {content}
        </section>
    )
}

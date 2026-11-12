'use client'

import { useMemo, useState } from 'react'
import { useSession } from 'next-auth/react'
import useSWR from 'swr'
import { CheckCircleIcon, ClockIcon, CoinsIcon, HourglassIcon, InfoIcon, UserIcon, WarningCircleIcon } from '@phosphor-icons/react/ssr'
import { Button, DataList, Details, Dialog, DialogActions, EmptyState, Field, ItemTitle, ListCard, PeriodBar, Section, Select, StatusBadge, Tabs, TextArea, TotalTiles, type Column, type Tile } from '@/components/ui'
import { fetcher, type SWRError } from '@/lib/swr-fetcher'
import { useCan } from '@/lib/useCan'
import { useLanguage } from '@/context/LanguageContext'
import { useToast } from '@/context/ToastContext'
import type { TranslationKey } from '@/lib/translations'
import { ActionStarts, useBusyAction } from '@/lib/useBusyAction'
import { useLive, useWantedChannels } from '@/components/LiveUpdates'
import { useArrivalsIn } from '@/components/useArrivals'
import AddPunchDialog from './AddPunchDialog'
import { checkoutDate } from '@/lib/attendance/checkout-date'
import { send, json } from './send'
import { lastDayOf, pad, useDayInAddress, useFigures, useMonthInAddress } from './period'

/**
 * Daily exceptions (ATTENDANCE_PLAN.md §13.1): only what needs a decision,
 * with a count per kind, for the people the viewer sees. Lateness and early
 * leave that count, and absences, are excused (not charged, with a reason)
 * or accepted (the charge stands); a missing punch is added; overtime is
 * approved or rejected. What waits on the Requests page and the Employee
 * numbers and Face tabs is counted, and opens there. Every decision is
 * audited and can be undone.
 *
 * On the building blocks (UI_PLAN.md §5 step 5, Attendance part 5, PR 151):
 * the month the other tabs are about, and a day of it, under the page header
 * (DESIGN.md §5.3), up to yesterday, the last day that's over; what waits
 * elsewhere as tiles that open it; the kinds as the building blocks' tabs,
 * kept in the address; each kind as a list (§5.4); and excusing, or turning
 * overtime down, in the building blocks' dialog.
 */

type RuleOutcome = { minutes: number; days: number; occurrence: number; note: string | null }
type Row = {
    id: string; userId: string; name: string; teamLeaderId: string | null; date: string; status: string
    firstIn: string | null; lastOut: string | null; lateMinutes: number; earlyLeaveMinutes: number; overtimeMinutes: number
    deductionMinor: number | null; breakdown: { lateness: RuleOutcome; earlyLeave: RuleOutcome; absenceDays: number }
    expectedEndMinutes: number | null
}
type Decided = { id: string; userId: string; name: string; teamLeaderId: string | null; date: string; subject: Subject; outcome: 'EXCUSED' | 'ACCEPTED'; reason: string | null }
type Subject = 'LATENESS' | 'EARLY_LEAVE' | 'ABSENCE'
type Data = {
    late: Row[]; early: Row[]; absent: Row[]; incomplete: Row[]; overtime: Row[]; decided: Decided[]
    counts: { late: number; early: number; absent: number; incomplete: number; overtime: number; permissions: number | null; missing: number | null; unmatched: number | null; faceOverdue?: number | null }
    /** Kinds with more than the list shows. */
    capped?: Record<string, boolean>
}
type Kind = 'lateEarly' | 'absent' | 'incomplete' | 'overtime' | 'decided'
type Person = { id: string; name: string; teamLeaderId: string | null }
/** A late arrival or an early leave, one row each. */
type LateEarly = { key: string; r: Row; subject: 'LATENESS' | 'EARLY_LEAVE'; minutes: number; rule: RuleOutcome }

const KINDS: Kind[] = ['lateEarly', 'absent', 'incomplete', 'overtime', 'decided']
const KIND_LABEL: Record<Kind, TranslationKey> = { lateEarly: 'exc_tab_late', absent: 'exc_tab_absent', incomplete: 'exc_tab_incomplete', overtime: 'exc_tab_overtime', decided: 'exc_tab_decided' }
const NOTE_KEY: Record<string, TranslationKey> = { FREE_OCCURRENCE: 'day_note_free', ESCALATED: 'day_note_escalated', CAPPED: 'day_note_capped' }

export default function ExceptionsTab({ q, companyId, today, topics }: { q: string; companyId: string | null; today: string; topics: string[] }) {
    const { t } = useLanguage()
    const { num, amount, minutes: minutesText, days: daysWord, clock, date } = useFigures()
    const { showToast } = useToast()
    const p = useCan()
    const { data: session } = useSession()
    const me = session?.user?.id
    // Only days that are over have exceptions: up to yesterday, the
    // company's, and with no month in the address, yesterday's month.
    const yesterday = useMemo(() => {
        const d = new Date(`${today}T00:00:00Z`)
        d.setUTCDate(d.getUTCDate() - 1)
        return d.toISOString().slice(0, 10)
    }, [today])
    const period = useMonthInAddress(today, yesterday)
    const { params, pathname, router, year, monthNumber, month, monthName, setPeriod, months, years } = period
    const { day, setDay, days, dayName } = useDayInAddress(period, yesterday)
    const from = day ? `${month}-${pad(day)}` : `${month}-01`
    const end = day ? from : lastDayOf(month)
    const to = end < yesterday ? end : yesterday
    const over = from <= to

    // The kind, kept in the address, so a reload or a link opens on it.
    const linked = params.get('kind') as Kind | null
    const kind: Kind = linked && KINDS.includes(linked) ? linked : 'lateEarly'
    const setKind = (k: Kind) => {
        const next = new URLSearchParams(params.toString())
        next.set('kind', k)
        router.replace(`${pathname}?${next.toString()}`, { scroll: false })
    }
    const tabHref = (tab: 'numbers' | 'face') => {
        const next = new URLSearchParams(params.toString())
        next.set('tab', tab)
        next.delete('kind')
        return `${pathname}?${next.toString()}`
    }

    const [excusing, setExcusing] = useState<{ row: { userId: string; name: string; date: string }; subject: Subject } | null>(null)
    const [rejecting, setRejecting] = useState<Row | null>(null)
    const [reason, setReason] = useState('')
    const [reasonError, setReasonError] = useState<string | undefined>()
    const [adding, setAdding] = useState<Row | null>(null)

    const listUrl = over ? `/api/attendance/exceptions?${q}from=${from}&to=${to}` : null
    const { data: body, error, isValidating, mutate } = useSWR(listUrl, fetcher)
    const { data: peopleBody } = useSWR(`/api/attendance/people?${q}`, fetcher)
    const people: Person[] = useMemo(() => peopleBody?.data?.people ?? [], [peopleBody])
    const data: Data | undefined = body?.data
    const companyField = companyId ? { companyId } : {}

    const lateEarly: LateEarly[] = data ? [
        ...data.late.map(r => ({ key: `${r.id}:LATENESS`, r, subject: 'LATENESS' as const, minutes: r.lateMinutes, rule: r.breakdown.lateness })),
        ...data.early.map(r => ({ key: `${r.id}:EARLY_LEAVE`, r, subject: 'EARLY_LEAVE' as const, minutes: r.earlyLeaveMinutes, rule: r.breakdown.earlyLeave })),
    ].sort((a, b) => b.r.date.localeCompare(a.r.date) || a.r.name.localeCompare(b.r.name)) : []

    // Drawn again as attendance changes, and as the requests it counts do (part 2), while open
    // (REALTIME_PLAN.md, part 4c): at most every 30 seconds, whichever it hears, as a flagged
    // check-in sends both (found by Codex on PR 265). A row someone else added or changed in the
    // list shown is tinted, by the list's own key; the person's own decisions aren't.
    useWantedChannels(topics)
    useLive(['attendance', 'requests'], () => { void mutate() })
    const shown: { key: string; row: unknown }[] | null = !data ? null
        : kind === 'lateEarly' ? lateEarly.map(x => ({ key: x.key, row: x }))
        : kind === 'decided' ? data.decided.map(d => ({ key: d.id, row: d }))
        : data[kind].map(r => ({ key: r.id, row: r }))
    const arrivals = useArrivalsIn(['attendance', 'requests'], `${listUrl}#${kind}`, shown, x => x.key)
    const action = useBusyAction(arrivals.own)

    const act = (key: string, url: string, init: RequestInit, done: TranslationKey) => action.run(key, async () => {
        const r = await send(url, init, t('punch_failed'))
        if (!r.ok) { showToast(r.error, 'error'); return false }
        showToast(t(done), 'success')
        arrivals.saved()
        await mutate()
        return true
    })
    const decide = (row: { userId: string; date: string }, subject: Subject, outcome: 'EXCUSED' | 'ACCEPTED', why?: string) =>
        act(`${outcome}:${row.userId}:${row.date}:${subject}`, '/api/attendance/decisions', json('POST', { ...companyField, userId: row.userId, date: row.date, subject, outcome, reason: why ?? null }), outcome === 'EXCUSED' ? 'exc_excused' : 'exc_accepted')
    const overtime = (row: Row, status: 'APPROVED' | 'REJECTED', note?: string) =>
        act(`${status}:${row.id}`, '/api/attendance/overtime', json('POST', { ...companyField, userId: row.userId, date: row.date, status, note: note || null }), status === 'APPROVED' ? 'req_approved' : 'req_rejected')
    const corrects = (row: { userId: string; teamLeaderId: string | null }) => row.userId !== me && p.canFor('attendance.correct', row.userId, row.teamLeaderId)
    const approvesOvertime = (row: Row) => row.userId !== me && p.canFor('attendance.approve_overtime', row.userId, row.teamLeaderId)

    const openExcuse = (row: { userId: string; name: string; date: string }, subject: Subject) => { setReason(''); setReasonError(undefined); setExcusing({ row, subject }) }
    const openReject = (row: Row) => { setReason(''); setReasonError(undefined); setRejecting(row) }
    // Not while it works: closing then would hide the answer.
    const closeExcuse = () => { if (!action.running) setExcusing(null) }
    const closeReject = () => { if (!action.running) setRejecting(null) }
    const excuse = (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault()
        if (!excusing) return
        const form = e.currentTarget
        if (reason.trim().length < 3) {
            setReasonError(t('punch_reason_required'))
            requestAnimationFrame(() => form.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus())
            return
        }
        // Refused, it stays open with the reason typed, to try again.
        void decide(excusing.row, excusing.subject, 'EXCUSED', reason.trim()).then(ok => { if (ok) setExcusing(null) })
    }
    const reject = (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault()
        if (!rejecting) return
        void overtime(rejecting, 'REJECTED', reason.trim()).then(ok => { if (ok) setRejecting(null) })
    }

    const c = data?.counts
    const cap = data?.capped ?? {}
    const counts: Record<Kind, { n: number | undefined; more?: boolean }> = {
        lateEarly: { n: c ? c.late + c.early : undefined, more: cap.late || cap.early },
        absent: { n: c?.absent, more: cap.absent },
        incomplete: { n: c?.incomplete, more: cap.incomplete },
        overtime: { n: c?.overtime, more: cap.overtime },
        decided: { n: data?.decided.length },
    }
    const kindLabel = (k: Kind) => {
        const { n, more } = counts[k]
        return n === undefined ? t(KIND_LABEL[k]) : `${t(KIND_LABEL[k])} (${num(n)}${more ? '+' : ''})`
    }

    // What waits elsewhere: a tile each, opening where it's decided (DESIGN.md §5.5).
    const waitingRequests = (c?.permissions ?? 0) + (c?.missing ?? 0)
    const waiting: Tile[] = [
        ...(waitingRequests > 0 ? [{ label: t('exc_tile_requests'), value: num(waitingRequests), href: '/dashboard/requests?tab=review' }] : []),
        ...((c?.unmatched ?? 0) > 0 ? [{ label: t('exc_tile_unmatched'), value: num(c!.unmatched!), href: tabHref('numbers') }] : []),
        ...((c?.faceOverdue ?? 0) > 0 ? [{ label: t('exc_tile_face'), value: num(c!.faceOverdue!), href: tabHref('face') }] : []),
    ]

    // One day's list is on that day, a month's in it (found in the interface audit, PR 151).
    const listTitle = dayName ? t('exc_list_title_day').replace('{day}', dayName) : t('exc_list_title').replace('{period}', monthName)
    // A day's punches, from and to; none for a day with no punch, where it said —–— (found in the interface audit, PR 151).
    const times = (r: Row) => (r.firstIn || r.lastOut ? <bdi>{r.firstIn ? clock(r.firstIn) : '—'}–{r.lastOut ? clock(r.lastOut) : '—'}</bdi> : null)
    const note = (rule: RuleOutcome) => (rule.note && NOTE_KEY[rule.note] ? t(NOTE_KEY[rule.note]).replace('{n}', num(rule.occurrence)) : null)
    const who = (r: { date: string; name: string }) => <ItemTitle title={date(r.date)} detail={r.name} />
    const busyKey = (key: string) => action.is(key)
    const decisionButtons = (row: Row, subject: Subject) => corrects(row) ? (
        <span className="ui-row-actions">
            <Button variant="primary" size="sm" disabled={action.running} onClick={() => openExcuse(row, subject)}>{t('exc_excuse')}</Button>
            <Button size="sm" disabled={action.running} busy={busyKey(`ACCEPTED:${row.userId}:${row.date}:${subject}`)} onClick={() => { void decide(row, subject, 'ACCEPTED') }}>{t('exc_accept')}</Button>
        </span>
    ) : null
    const actionsColumn = <T,>(cell: (row: T) => React.ReactNode): Column<T> => ({ key: 'actions', header: t('actions_label'), hideHeader: true, align: 'end', cell })

    const lateWhat = (x: LateEarly) => t(x.subject === 'LATENESS' ? 'exc_late_n' : 'exc_early_n').replace('{n}', num(x.minutes))
    const ruleDays = (rule: RuleOutcome) => (rule.days > 0 ? daysWord(rule.days) : '—')

    const empty = <EmptyState icon={CheckCircleIcon} title={t('exc_none')} />
    const list = (() => {
        if (!data) return null
        const label = t(KIND_LABEL[kind])
        if (kind === 'lateEarly') return (
            <DataList<LateEarly> caption={label} rows={lateEarly} rowKey={x => x.key} arrived={arrivals.arrived} empty={empty}
                columns={[
                    { key: 'date', header: t('punch_date'), cell: x => who(x.r) },
                    { key: 'what', header: t('exc_what'), cell: x => <>{lateWhat(x)}{times(x.r) && <div className="ui-item-detail">{times(x.r)}</div>}{note(x.rule) && <div className="ui-item-detail">{note(x.rule)}</div>}</> },
                    { key: 'deduction', header: t('day_deduction'), align: 'end', cell: x => ruleDays(x.rule) },
                    actionsColumn<LateEarly>(x => decisionButtons(x.r, x.subject)),
                ]}
                card={x => <ListCard title={date(x.r.date)} details={[
                    { icon: UserIcon, text: x.r.name },
                    { icon: ClockIcon, text: <span>{lateWhat(x)}{times(x.r) && <>, {times(x.r)}</>}</span> },
                    ...(note(x.rule) ? [{ icon: InfoIcon, text: note(x.rule) }] : []),
                    ...(x.rule.days > 0 ? [{ icon: CoinsIcon, text: <span>{t('day_deduction')}: {ruleDays(x.rule)}</span> }] : []),
                ]} foot={decisionButtons(x.r, x.subject) ?? undefined} />} />
        )
        if (kind === 'absent') return (
            <DataList<Row> caption={label} rows={data.absent} rowKey={r => r.id} arrived={arrivals.arrived} empty={empty}
                columns={[
                    { key: 'date', header: t('punch_date'), cell: who },
                    { key: 'deduction', header: t('day_deduction'), align: 'end', cell: r => (r.deductionMinor ? <bdi>{amount(r.deductionMinor)}</bdi> : '—') },
                    actionsColumn<Row>(r => decisionButtons(r, 'ABSENCE')),
                ]}
                card={r => <ListCard title={date(r.date)} details={[
                    { icon: UserIcon, text: r.name },
                    ...(r.deductionMinor ? [{ icon: CoinsIcon, text: <span>{t('day_deduction')}: <bdi>{amount(r.deductionMinor)}</bdi></span> }] : []),
                ]} foot={decisionButtons(r, 'ABSENCE') ?? undefined} />} />
        )
        if (kind === 'incomplete') {
            const add = (r: Row) => (corrects(r) ? <Button variant="primary" size="sm" onClick={() => setAdding(r)}>{t('punch_add')}</Button> : null)
            return (
                <DataList<Row> caption={label} rows={data.incomplete} rowKey={r => r.id} arrived={arrivals.arrived} empty={empty}
                    columns={[
                        { key: 'date', header: t('punch_date'), cell: who },
                        { key: 'punched', header: t('exc_punched'), cell: r => <><bdi>{r.firstIn ? clock(r.firstIn) : '—'}</bdi><div className="ui-item-detail">{t('day_unpriced_incomplete')}</div></> },
                        actionsColumn<Row>(add),
                    ]}
                    card={r => <ListCard title={date(r.date)} details={[
                        { icon: UserIcon, text: r.name },
                        { icon: ClockIcon, text: <span>{t('exc_punched')}: <bdi>{r.firstIn ? clock(r.firstIn) : '—'}</bdi></span> },
                        { icon: InfoIcon, text: t('day_unpriced_incomplete') },
                    ]} foot={add(r) ?? undefined} />} />
            )
        }
        if (kind === 'overtime') {
            const decideOvertime = (r: Row) => (approvesOvertime(r) ? (
                <span className="ui-row-actions">
                    <Button variant="primary" size="sm" disabled={action.running} busy={busyKey(`APPROVED:${r.id}`)} onClick={() => { void overtime(r, 'APPROVED') }}>{t('req_approve')}</Button>
                    <Button size="sm" disabled={action.running} onClick={() => openReject(r)}>{t('req_reject')}</Button>
                </span>
            ) : null)
            return (
                <DataList<Row> caption={label} rows={data.overtime} rowKey={r => r.id} arrived={arrivals.arrived} empty={empty}
                    columns={[
                        { key: 'date', header: t('punch_date'), cell: who },
                        { key: 'overtime', header: t('day_overtime'), cell: r => <>{minutesText(r.overtimeMinutes)}{times(r) && <div className="ui-item-detail">{times(r)}</div>}</> },
                        actionsColumn<Row>(decideOvertime),
                    ]}
                    card={r => <ListCard title={date(r.date)} details={[
                        { icon: UserIcon, text: r.name },
                        { icon: ClockIcon, text: <span>{minutesText(r.overtimeMinutes)}{times(r) && <>, {times(r)}</>}</span> },
                    ]} foot={decideOvertime(r) ?? undefined} />} />
            )
        }
        const badge = (d: Decided) => <StatusBadge tone={d.outcome === 'EXCUSED' ? 'good' : 'neutral'}>{t(d.outcome === 'EXCUSED' ? 'exc_outcome_excused' : 'exc_outcome_accepted')}</StatusBadge>
        const undo = (d: Decided) => (corrects(d) ? (
            <Button size="sm" disabled={action.running} busy={busyKey(`undo:${d.id}`)} onClick={() => { void act(`undo:${d.id}`, `/api/attendance/decisions/${d.id}`, { method: 'DELETE' }, 'exc_undone') }}>{t('exc_undo')}</Button>
        ) : null)
        return (
            <DataList<Decided> caption={label} rows={data.decided} rowKey={d => d.id} arrived={arrivals.arrived} empty={empty}
                columns={[
                    { key: 'date', header: t('punch_date'), cell: who },
                    { key: 'what', header: t('exc_what'), cell: d => t(`audit_value_${d.subject}` as TranslationKey) },
                    { key: 'decision', header: t('req_decision'), cell: d => <>{badge(d)}{d.reason && <div className="ui-item-detail">{d.reason}</div>}</> },
                    actionsColumn<Decided>(undo),
                ]}
                card={d => <ListCard title={date(d.date)} status={badge(d)} details={[
                    { icon: UserIcon, text: d.name },
                    { icon: InfoIcon, text: t(`audit_value_${d.subject}` as TranslationKey) },
                    ...(d.reason ? [{ icon: InfoIcon, text: d.reason }] : []),
                ]} foot={undo(d) ?? undefined} />} />
        )
    })()

    // Which day and what, so the one meant is the one decided.
    const facts = (row: { name: string; date: string }, what: string) => (
        <Details items={[{ label: t('punch_person'), value: row.name }, { label: t('punch_date'), value: date(row.date) }, { label: t('exc_what'), value: what }]} />
    )

    return (
        <>
            <PeriodBar>
                <Field label={t('day_month')}>{f => (
                    <Select {...f} value={String(monthNumber)} onChange={e => setPeriod(year, Number(e.target.value))} options={months} />
                )}</Field>
                <Field label={t('year')}>{f => (
                    <Select {...f} value={String(year)} onChange={e => setPeriod(Number(e.target.value), monthNumber)} options={years} />
                )}</Field>
                <Field label={t('punch_day')}>{f => (
                    <Select {...f} value={day ? String(day) : ''} onChange={e => setDay(e.target.value ? Number(e.target.value) : null)} options={days} />
                )}</Field>
            </PeriodBar>

            {waiting.length > 0 && <TotalTiles items={waiting} />}

            <Section title={listTitle}>
                <p className="ui-hint">{t('exc_hint')}</p>
                {!over ? (
                    <div className="ui-panel"><EmptyState icon={HourglassIcon} title={t('exc_not_over')} /></div>
                ) : error ? (
                    <div className="ui-panel">
                        <EmptyState icon={WarningCircleIcon} title={t('exc_load_failed')} detail={(error as SWRError).info?.error}
                            action={<Button busy={isValidating} onClick={() => { void mutate() }}>{t('try_again')}</Button>} />
                    </div>
                ) : !data ? (
                    <div className="ui-panel" role="status"><EmptyState icon={HourglassIcon} title={t('loading')} /></div>
                ) : (
                    <>
                        <Tabs label={t('exc_kinds')} idPrefix="exc-kind" value={kind} onChange={setKind}
                            items={KINDS.map(k => ({ value: k, label: kindLabel(k), controls: 'exc-kind-panel' }))} />
                        <div role="tabpanel" id="exc-kind-panel" aria-labelledby={`exc-kind-${kind}`}>{list}</div>
                    </>
                )}
            </Section>

            {/* Adding the punch that's missing is the person's own, said to the list as it starts. */}
            <ActionStarts.Provider value={arrivals.own}>
                {adding && (
                    <AddPunchDialog
                        today={today}
                        companyId={companyId}
                        people={people.filter(x => x.id === adding.userId)}
                        initial={{ userId: adding.userId, date: checkoutDate(adding.date, adding.expectedEndMinutes), direction: 'OUT' }}
                        onClose={() => setAdding(null)}
                        onAdded={() => { setAdding(null); arrivals.saved(); void mutate() }}
                    />
                )}
            </ActionStarts.Provider>

            {/* Excused, it isn't charged: it asks why, kept with the day and in the audit log. */}
            <Dialog open={excusing !== null} onClose={closeExcuse} title={t('exc_excuse')}>
                {excusing && (
                    <form className="ui-form" noValidate onSubmit={excuse}>
                        {facts(excusing.row, t(`audit_value_${excusing.subject}` as TranslationKey))}
                        <p>{t('exc_excuse_hint')}</p>
                        <Field label={t('punch_reason')} error={reasonError}>{f => (
                            <TextArea {...f} name="reason" value={reason} disabled={action.running}
                                onChange={e => { setReason(e.target.value); setReasonError(undefined) }} />
                        )}</Field>
                        <DialogActions>
                            <Button onClick={closeExcuse} disabled={action.running}>{t('cancel')}</Button>
                            <Button variant="primary" type="submit" disabled={action.running} busy={action.running}>{t('exc_excuse')}</Button>
                        </DialogActions>
                    </form>
                )}
            </Dialog>

            {/* Turning overtime down: why is the decider's to say, or not. */}
            <Dialog open={rejecting !== null} onClose={closeReject} title={t('req_reject')}>
                {rejecting && (
                    <form className="ui-form" noValidate onSubmit={reject}>
                        {facts(rejecting, minutesText(rejecting.overtimeMinutes))}
                        <p>{t('req_reject_hint')}</p>
                        <Field label={t('punch_reason')}>{f => (
                            <TextArea {...f} name="reason" value={reason} disabled={action.running} onChange={e => setReason(e.target.value)} />
                        )}</Field>
                        <DialogActions>
                            <Button onClick={closeReject} disabled={action.running}>{t('cancel')}</Button>
                            <Button variant="danger" type="submit" disabled={action.running} busy={action.running}>
                                {t('req_reject')}
                            </Button>
                        </DialogActions>
                    </form>
                )}
            </Dialog>
        </>
    )
}

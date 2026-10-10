'use client'

import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useSession } from 'next-auth/react'
import useSWR from 'swr'
import { fetcher } from '@/lib/swr-fetcher'
import { useCan } from '@/lib/useCan'
import { useLanguage } from '@/context/LanguageContext'
import { useHeader } from '@/context/HeaderContext'
import { useToast } from '@/context/ToastContext'
import { send, json } from './send'
import FaceTab from './FaceTab'
import RequestsTab, { AskPermissionModal, ReportMissingModal } from './RequestsTab'
import AddPunchModal from './AddPunchModal'
import { checkoutDate } from '@/lib/attendance/checkout-date'
import ExceptionsTab from './ExceptionsTab'
import LoadingSpinner from '@/components/LoadingSpinner'
import ConfirmModal from '@/components/ConfirmModal'
import type { TranslationKey } from '@/lib/translations'
import { useBusyAction } from '@/lib/useBusyAction'

/**
 * Punches (ATTENDANCE_PLAN.md Phase 0): what came in, from a terminal's
 * spreadsheet or added by hand, and who each terminal number is.
 *
 * Everyone sees their own punches; attendance.view_team shows other people's
 * at its scope. attendance.correct adds and withdraws them, never one's own,
 * and — held company-wide — imports files and maps employee numbers.
 *
 * Nothing here is edited: a wrong punch, or a whole wrong file, is withdrawn
 * and stays on record. Days and their deductions are worked out from these by
 * the engine; this screen shows the evidence.
 */

type Punch = {
    id: string; userId: string | null; name: string | null; hardwareUserId: string | null
    source: string; at: string; direction: 'IN' | 'OUT' | null; note: string | null; deviceName?: string | null
    placeName?: string | null; status?: string; flagReasons?: string[]
    voidedAt: string | null; voidReason: string | null
}
type Person = { id: string; name: string; teamLeaderId: string | null }
type Report = {
    fileName: string; headers: string[]; columns: { code: number; date: number; time: number | null; direction: number | null } | null
    rowCount: number; ready: number; duplicates: number; locked: number
    problems: { row: number; code: string | null; error: string }[]; problemCount: number
    codes: { code: string; userId: string | null; name: string | null; rows: number }[]
    from: string | null; to: string | null; importId?: string; added?: number
}
type ImportRow = { id: string; fileName: string; createdAt: string; rowCount: number; addedCount: number; duplicateCount: number; refusedCount: number; voidedAt: string | null; voidReason: string | null }
type Codes = { mapped: { id: string; code: string; userId: string; name: string }[]; unmatched: { code: string; punches: number; from: string; to: string }[] }

type Tab = 'exceptions' | 'days' | 'punches' | 'requests' | 'face' | 'import' | 'numbers'

const pad = (n: number) => String(n).padStart(2, '0')
const monthStart = (date: string) => `${date.slice(0, 8)}01`

export default function AttendancePage() {
    const { t } = useLanguage()
    const { setTitle, setSubtitle } = useHeader()
    const { data: session, status } = useSession()
    const params = useSearchParams()
    const router = useRouter()
    const pathname = usePathname()
    const p = useCan()
    const isSuperAdmin = session?.user?.role === 'SUPER_ADMIN'
    const companyId = isSuperAdmin ? params.get('companyId') : null
    const q = companyId ? `companyId=${encodeURIComponent(companyId)}&` : ''

    useEffect(() => {
        setTitle(t('attendance_title'))
        setSubtitle(t('punch_page_hint'))
        return () => { setTitle(null); setSubtitle(null) }
    }, [t, setTitle, setSubtitle])

    const correctsCompany = p.companyWide('attendance.correct')
    // The company's date, not the device's: around midnight, or for somebody
    // abroad, they differ, and every default date below starts from it (review on #12).
    // Asked once the session says who is asking: before, a Super Admin's request went without the company (review on #49).
    const { data: peopleBody, error: peopleError } = useSWR(status !== 'loading' && (!isSuperAdmin || companyId) ? `/api/attendance/people?${q}` : null, fetcher)
    const today: string | undefined = peopleBody?.data?.today
    // Whoever sees other people's attendance starts on what needs a decision (§13.1).
    const seesOthers = p.can('attendance.view_team')
    const tabs: Tab[] = [
        ...(seesOthers ? ['exceptions' as const] : []),
        'days', 'punches', 'requests',
        // Face verification (§9.5): only whoever decides it, company-wide.
        ...(p.companyWide('attendance.approve_face') ? ['face' as const] : []),
        ...(correctsCompany ? ['import' as const, 'numbers' as const] : []),
    ]
    // A link may open a tab (?tab=requests, from a notice about a phone); one this person doesn't have falls back.
    // A tab picked by hand goes into the address too: the same notice's link followed again is then a change
    // of address, and opens its tab, where a pick held aside kept winning (review on #21).
    const linked = params.get('tab') as Tab | null
    const setTab = (k: Tab) => {
        const next = new URLSearchParams(params.toString())
        next.set('tab', k)
        router.replace(`${pathname}?${next.toString()}`, { scroll: false })
    }
    const tab: Tab = linked && tabs.includes(linked) ? linked : seesOthers ? 'exceptions' : 'days'

    if (status === 'loading') return <LoadingSpinner />
    // Failed, it says so: everything below waits on the company's date, and a spinner would wait for good (review on #12).
    if (peopleError && !today && !(isSuperAdmin && !companyId)) return <p role="alert" style={{ color: 'var(--danger-fg)' }}>{t('error_generic')}</p>
    if (!today && !(isSuperAdmin && !companyId)) return <LoadingSpinner />
    if (isSuperAdmin && !companyId) {
        return <p style={{ color: 'var(--text-soft)' }}>{t('punch_pick_company')}</p>
    }

    const label: Record<Tab, TranslationKey> = { exceptions: 'exc_tab', days: 'day_tab_days', punches: 'punch_tab_punches', requests: 'req_tab', face: 'face_tab', import: 'punch_tab_import', numbers: 'punch_tab_numbers' }
    return (
        <div style={{ display: 'grid', gap: '1rem' }}>
            {tabs.length > 1 && (
                <div role="tablist" style={{ display: 'flex', gap: '0.4rem', overflowX: 'auto' }}>
                    {tabs.map(k => (
                        <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'btn btn-primary' : 'btn btn-secondary'} onClick={() => setTab(k)}>
                            {t(label[k])}
                        </button>
                    ))}
                </div>
            )}
            {/* Another company, picked without leaving the page, starts afresh: the tabs' dates were the last
                company's, from its own calendar, and a file chosen for import was meant for it (review on #13). */}
            <Fragment key={companyId ?? ''}>
                {tab === 'exceptions' && today && seesOthers && <ExceptionsTab q={q} companyId={companyId} today={today} onOpen={setTab} />}
                {tab === 'days' && today && <DaysTab q={q} companyId={companyId} today={today} />}
                {tab === 'punches' && today && <PunchesTab q={q} companyId={companyId} today={today} />}
                {tab === 'requests' && today && <RequestsTab q={q} companyId={companyId} today={today} />}
                {tab === 'face' && <FaceTab q={q} />}
                {tab === 'import' && correctsCompany && <ImportTab q={q} companyId={companyId} />}
                {tab === 'numbers' && correctsCompany && <NumbersTab q={q} companyId={companyId} />}
            </Fragment>
        </div>
    )
}

// --- Days ------------------------------------------------------------------------

type RuleOutcome = { minutes: number; days: number; occurrence: number; note: string | null }
type Day = {
    id: string; userId: string; name: string; date: string; status: string
    firstIn: string | null; lastOut: string | null; workedMinutes: number
    lateMinutes: number; earlyLeaveMinutes: number; overtimeMinutes: number; excusedMinutes: number
    expectedStartMinutes: number | null; expectedEndMinutes: number | null
    deductionDays: number; deductionMinor: number | null; overtimeStatus: string; overtimeMinor: number | null
    breakdown: { lateness: RuleOutcome; earlyLeave: RuleOutcome; absenceDays: number; unpriced: string | null; holiday: string | null; excusedAbsence?: boolean }
}

const STATUS_COLOR: Record<string, string> = {
    PRESENT: 'var(--ok-fg)', ABSENT: 'var(--danger-fg)', INCOMPLETE: 'var(--warn-fg)', LEAVE: 'var(--info-fg)',
    WORKED_REST_DAY: 'var(--info-fg)', WORKED_HOLIDAY: 'var(--info-fg)',
}
const money = (minor: number) => (minor / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const lastDayOf = (month: string) => { const [y, m] = month.split('-').map(Number); return `${month}-${pad(new Date(Date.UTC(y, m, 0)).getUTCDate())}` }

function DaysTab({ q, companyId, today }: { q: string; companyId: string | null; today: string }) {
    const { t } = useLanguage()
    const { showToast } = useToast()
    const p = useCan()
    const seesOthers = p.can('attendance.view_team')
    const correctsCompany = p.companyWide('attendance.correct')
    const [month, setMonth] = useState(() => today.slice(0, 7))
    const [who, setWho] = useState('')
    const [busy, setBusy] = useState(false)
    const { data: peopleBody } = useSWR(seesOthers ? `/api/attendance/people?${q}` : null, fetcher)
    const people: Person[] = useMemo(() => peopleBody?.data?.people ?? [], [peopleBody])
    const url = month ? `/api/attendance/days?${q}from=${month}-01&to=${lastDayOf(month)}${who ? `&userId=${encodeURIComponent(who)}` : ''}` : null
    const { data: body, error, mutate } = useSWR(url, fetcher)
    const days: Day[] | null = body ? body.data?.days ?? [] : null
    const daysTruncated: boolean = !!body?.data?.truncated
    const rules: Rules | null = body?.data?.rules ?? null
    const { data: session } = useSession()
    const me = session?.user?.id
    // One person's month — one's own, or the person picked — gets its summary (§13.3).
    const onePerson = !seesOthers || !!who
    const oneself = !seesOthers || who === me
    const { data: balanceBody, mutate: refreshBalance } = useSWR(oneself && me && !companyId ? `/api/attendance/permissions/balance?month=${month}` : null, fetcher)
    const [asking, setAsking] = useState<Parameters<typeof AskPermissionModal>[0]['initial'] | null>(null)
    const [reporting, setReporting] = useState<string | null>(null)

    const recompute = async () => {
        setBusy(true)
        try {
            const r = await send('/api/attendance/recompute', json('POST', { ...(companyId ? { companyId } : {}), month }), t('punch_failed'))
            if (!r.ok) return showToast(r.error, 'error')
            showToast(r.body?.locked ? t('day_recompute_locked') : t('day_recomputed'), r.body?.locked ? 'info' : 'success')
            mutate()
        } finally { setBusy(false) }
    }

    const ruleNote = (label: TranslationKey, r: RuleOutcome) => {
        if (!r.note || r.note === 'CHARGED' || r.note === 'OFF') return null
        const key = ({ WITHIN_GRACE: 'day_note_grace', FREE_OCCURRENCE: 'day_note_free', ESCALATED: 'day_note_escalated', CAPPED: 'day_note_capped' } as Record<string, TranslationKey>)[r.note]
        return key ? `${t(label)}: ${t(key).replace('{n}', String(r.occurrence))}` : null
    }
    const notes = (d: Day) => [
        d.breakdown.holiday,
        ruleNote('day_late', d.breakdown.lateness),
        ruleNote('day_early', d.breakdown.earlyLeave),
        d.breakdown.unpriced ? t(({ INCOMPLETE: 'day_unpriced_incomplete', NO_POLICY: 'day_unpriced_no_policy', NO_SALARY: 'day_unpriced_no_salary' } as Record<string, TranslationKey>)[d.breakdown.unpriced] ?? 'day_unpriced_no_policy') : null,
        d.overtimeStatus === 'PENDING' ? t('day_overtime_pending') : d.overtimeStatus === 'REJECTED' ? t('day_overtime_rejected') : d.overtimeStatus === 'NOT_COUNTED' ? t('day_overtime_short') : null,
        d.excusedMinutes > 0 ? t('day_excused').replace('{n}', String(d.excusedMinutes)) : null,
        d.breakdown.excusedAbsence ? t('day_absence_excused') : null,
    ].filter(Boolean).join(' · ')
    const totalMinor = (days ?? []).reduce((sum, d) => sum + (d.deductionMinor ?? 0), 0)
    const showsMoney = (days ?? []).some(d => d.deductionMinor !== null)
    const mins = (n: number) => (n > 0 ? String(n) : '—')
    const hhmm = (minutes: number) => `${pad(Math.floor(minutes / 60) % 24)}:${pad(minutes % 60)}`
    const askFor = (d: Day) => d.status === 'PRESENT' && d.expectedStartMinutes !== null && d.expectedEndMinutes !== null && (
        d.lateMinutes > 0 && d.firstIn ? { date: d.date, type: 'LATE_ARRIVAL' as const, start: hhmm(d.expectedStartMinutes), end: d.firstIn.slice(11, 16) }
            : d.earlyLeaveMinutes > 0 && d.lastOut ? { date: d.date, type: 'EARLY_LEAVE' as const, start: d.lastOut.slice(11, 16), end: hhmm(d.expectedEndMinutes) }
                : null
    )

    return (
        <section className="glass" style={{ padding: '1.25rem', borderRadius: '1rem', display: 'grid', gap: '1rem' }}>
            <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
                <label style={{ display: 'grid', gap: '0.25rem' }}>
                    <span className="label">{t('day_month')}</span>
                    <input className="input" type="month" value={month} onChange={e => setMonth(e.target.value)} />
                </label>
                {seesOthers && (
                    <label style={{ display: 'grid', gap: '0.25rem', minWidth: '12rem' }}>
                        <span className="label">{t('punch_person')}</span>
                        <select className="input" value={who} onChange={e => setWho(e.target.value)}>
                            <option value="">{t('punch_everyone')}</option>
                            {people.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}
                        </select>
                    </label>
                )}
                <div style={{ flex: 1 }} />
                {correctsCompany && <button className="btn btn-secondary" disabled={busy || !month} onClick={recompute}>{t('day_recompute')}</button>}
            </div>
            <p style={{ margin: 0, fontSize: '0.82rem', color: 'var(--text-soft)' }}>{t('day_hint')}</p>
            {daysTruncated && <p role="status" style={{ margin: 0, color: 'var(--warn-fg)', fontSize: '0.86rem' }}>{t('day_truncated').replace('{n}', String(body?.data?.limit ?? ''))}</p>}
            {onePerson && days && days.length > 0 && !daysTruncated && <MonthSummary days={days} rules={rules} balance={oneself ? balanceBody?.data ?? null : null} />}

            {error ? <p style={{ color: 'var(--danger-fg)' }}>{t('punch_failed')}</p>
                : days === null ? <LoadingSpinner />
                    : days.length === 0 ? <p style={{ margin: 0, color: 'var(--text-soft)' }}>{t('day_none')}</p>
                        : (
                            <div style={{ overflowX: 'auto' }}>
                                <table className="table" style={{ width: '100%', fontSize: '0.84rem' }}>
                                    <thead>
                                        <tr>
                                            <th>{t('punch_date')}</th>
                                            {seesOthers && <th>{t('punch_person')}</th>}
                                            <th>{t('day_status')}</th>
                                            <th>{t('punch_in')}</th>
                                            <th>{t('punch_out')}</th>
                                            <th>{t('day_late')}</th>
                                            <th>{t('day_early')}</th>
                                            <th>{t('day_overtime')}</th>
                                            {showsMoney && <th>{t('day_deduction')}</th>}
                                            {oneself && <th />}
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {days.map(d => (
                                            <tr key={d.id}>
                                                <td style={{ whiteSpace: 'nowrap' }}><bdi>{d.date}</bdi></td>
                                                {seesOthers && <td>{d.name}</td>}
                                                <td>
                                                    <span style={{ color: STATUS_COLOR[d.status] ?? 'var(--text-soft)', fontWeight: 600 }}>{t(`audit_value_${d.status}` as TranslationKey)}</span>
                                                    {notes(d) && <div style={{ color: 'var(--text-soft)', fontSize: '0.75rem' }}>{notes(d)}</div>}
                                                </td>
                                                <td><bdi>{d.firstIn ? d.firstIn.slice(11, 16) : '—'}</bdi></td>
                                                <td><bdi>{d.lastOut ? d.lastOut.slice(11, 16) : '—'}</bdi></td>
                                                <td>{mins(d.lateMinutes)}</td>
                                                <td>{mins(d.earlyLeaveMinutes)}</td>
                                                <td>{mins(d.overtimeMinutes)}</td>
                                                {showsMoney && <td>{d.deductionMinor ? <bdi>{money(d.deductionMinor)}</bdi> : '—'}{d.deductionDays > 0 && <div style={{ color: 'var(--text-soft)', fontSize: '0.75rem' }}>{t('day_days').replace('{n}', String(d.deductionDays))}</div>}</td>}
                                                {oneself && (
                                                    <td style={{ textAlign: 'end' }}>
                                                        {d.userId === me && askFor(d) && <button type="button" className="btn btn-secondary" style={{ fontSize: '0.75rem', padding: '0.2rem 0.5rem', whiteSpace: 'nowrap' }} onClick={() => setAsking(askFor(d) || null)}>{t('req_ask_permission')}</button>}
                                                        {d.userId === me && d.status === 'INCOMPLETE' && <button type="button" className="btn btn-secondary" style={{ fontSize: '0.75rem', padding: '0.2rem 0.5rem', whiteSpace: 'nowrap' }} onClick={() => setReporting(checkoutDate(d.date, d.expectedEndMinutes))}>{t('req_report_missing')}</button>}
                                                    </td>
                                                )}
                                            </tr>
                                        ))}
                                    </tbody>
                                    {showsMoney && !daysTruncated && (
                                        <tfoot>
                                            <tr>
                                                <td colSpan={seesOthers ? 8 : 7} style={{ textAlign: 'end', fontWeight: 600 }}>{t('day_total')}</td>
                                                <td style={{ fontWeight: 600 }}><bdi>{money(totalMinor)}</bdi></td>
                                                {oneself && <td />}
                                            </tr>
                                        </tfoot>
                                    )}
                                </table>
                            </div>
                        )}
            {asking && <AskPermissionModal today={today} initial={asking} onClose={() => setAsking(null)} onDone={() => { setAsking(null); refreshBalance() }} />}
            {reporting && <ReportMissingModal today={today} initial={{ date: reporting, direction: 'OUT' }} onClose={() => setReporting(null)} onDone={() => setReporting(null)} />}
        </section>
    )
}

type Rules = { lateness: { enabled: boolean; freePerMonth: number }; earlyLeave: { enabled: boolean; freePerMonth: number } }
type Balance = { enabled: boolean; remainingMinutes: number; allowanceMinutes: number; carriedMinutes: number }
const COUNTED = new Set(['FREE_OCCURRENCE', 'CHARGED', 'ESCALATED', 'CAPPED'])

/**
 * One person's month so far (§13.3): deductions to date, lateness and early
 * leave against the free allowance, absences, overtime pay, and — for one's
 * own — the permission hours left.
 */
function MonthSummary({ days, rules, balance }: { days: Day[]; rules: Rules | null; balance: Balance | null }) {
    const { t } = useLanguage()
    const deducted = days.reduce((s, d) => s + (d.deductionMinor ?? 0), 0)
    const deductedDays = Math.round(days.reduce((s, d) => s + d.deductionDays, 0) * 10_000) / 10_000
    const overtimeMinor = days.reduce((s, d) => s + (d.overtimeMinor ?? 0), 0)
    const hidesMoney = days.every(d => d.deductionMinor === null)
    const lates = days.filter(d => COUNTED.has(d.breakdown.lateness.note ?? ''))
    const earlies = days.filter(d => COUNTED.has(d.breakdown.earlyLeave.note ?? ''))
    const absences = days.filter(d => d.status === 'ABSENT' && !d.breakdown.excusedAbsence).length
    const freeLine = (used: number, rule: { enabled: boolean; freePerMonth: number } | undefined) =>
        rule?.enabled && rule.freePerMonth > 0 ? t('sum_free_used').replace('{used}', String(Math.min(used, rule.freePerMonth))).replace('{free}', String(rule.freePerMonth)) : null
    const tile = (label: TranslationKey, value: string, note?: string | null) => (
        <div style={{ border: '1px solid var(--border)', borderRadius: '0.75rem', padding: '0.6rem 0.8rem', minWidth: '9rem', flex: '1 1 9rem' }}>
            <div className="label" style={{ fontSize: '0.75rem' }}>{t(label)}</div>
            <div style={{ fontSize: '1.1rem', fontWeight: 600 }}><bdi>{value}</bdi></div>
            {note && <div style={{ color: 'var(--text-soft)', fontSize: '0.75rem' }}>{note}</div>}
        </div>
    )
    return (
        <div role="group" aria-label={t('sum_title')} style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap' }}>
            {tile('sum_deductions', hidesMoney ? t('day_days').replace('{n}', String(deductedDays)) : money(deducted), hidesMoney ? null : t('day_days').replace('{n}', String(deductedDays)))}
            {tile('sum_lates', String(lates.length), freeLine(lates.filter(d => d.breakdown.lateness.note === 'FREE_OCCURRENCE').length, rules?.lateness))}
            {tile('sum_early', String(earlies.length), freeLine(earlies.filter(d => d.breakdown.earlyLeave.note === 'FREE_OCCURRENCE').length, rules?.earlyLeave))}
            {tile('sum_absences', String(absences))}
            {!hidesMoney && overtimeMinor > 0 && tile('sum_overtime', money(overtimeMinor))}
            {balance?.enabled && tile('sum_permission_left', t('req_minutes').replace('{n}', String(balance.remainingMinutes)), t('sum_of_total').replace('{n}', String(balance.allowanceMinutes + balance.carriedMinutes)))}
        </div>
    )
}

// --- Punches -------------------------------------------------------------------

function PunchesTab({ q, companyId, today }: { q: string; companyId: string | null; today: string }) {
    const { t } = useLanguage()
    const { showToast } = useToast()
    const p = useCan()
    const { data: session } = useSession()
    const me = session?.user?.id
    const seesOthers = p.can('attendance.view_team')
    const correctsCompany = p.companyWide('attendance.correct')

    const [from, setFrom] = useState(() => monthStart(today))
    const [to, setTo] = useState(today)
    const [who, setWho] = useState('')
    const [waiting, setWaiting] = useState(false)
    const [adding, setAdding] = useState(false)
    const [withdrawing, setWithdrawing] = useState<Punch | null>(null)

    const { data: peopleBody } = useSWR(seesOthers || p.can('attendance.correct') ? `/api/attendance/people?${q}` : null, fetcher)
    const people: Person[] = useMemo(() => peopleBody?.data?.people ?? [], [peopleBody])
    const listUrl = `/api/attendance/punches?${q}from=${from}&to=${to}${waiting ? '&unmatched=1' : who ? `&userId=${encodeURIComponent(who)}` : ''}`
    const { data: body, error, mutate } = useSWR(from && to && from <= to ? listUrl : null, fetcher)
    const punches: Punch[] | null = body ? body.data?.punches ?? [] : null
    const truncated: boolean = !!body?.data?.truncated

    const leaderOf = useMemo(() => new Map(people.map(x => [x.id, x.teamLeaderId])), [people])
    const mayCorrect = (punch: Punch) => !punch.voidedAt && (punch.userId
        ? p.canFor('attendance.correct', punch.userId, leaderOf.get(punch.userId) ?? null)
        : correctsCompany)

    const withdraw = async (reason?: string) => {
        if (!withdrawing) return
        const r = await send(`/api/attendance/punches/${withdrawing.id}/void`, json('POST', { reason }), t('punch_failed'))
        setWithdrawing(null)
        if (!r.ok) return showToast(r.error, 'error')
        showToast(t('punch_withdrawn'), 'success')
        mutate()
    }

    return (
        <section className="glass" style={{ padding: '1.25rem', borderRadius: '1rem', display: 'grid', gap: '1rem' }}>
            <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
                <label style={{ display: 'grid', gap: '0.25rem' }}>
                    <span className="label">{t('punch_from')}</span>
                    <input className="input" type="date" value={from} onChange={e => setFrom(e.target.value)} />
                </label>
                <label style={{ display: 'grid', gap: '0.25rem' }}>
                    <span className="label">{t('punch_to')}</span>
                    <input className="input" type="date" value={to} onChange={e => setTo(e.target.value)} />
                </label>
                {seesOthers && (
                    <label style={{ display: 'grid', gap: '0.25rem', minWidth: '12rem' }}>
                        <span className="label">{t('punch_person')}</span>
                        <select className="input" value={waiting ? '' : who} disabled={waiting} onChange={e => setWho(e.target.value)}>
                            <option value="">{t('punch_everyone')}</option>
                            {people.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}
                        </select>
                    </label>
                )}
                {correctsCompany && (
                    <label style={{ display: 'flex', gap: '0.4rem', alignItems: 'center', fontSize: '0.86rem' }}>
                        <input type="checkbox" checked={waiting} onChange={e => setWaiting(e.target.checked)} />
                        {t('punch_only_unmatched')}
                    </label>
                )}
                <div style={{ flex: 1 }} />
                {p.can('attendance.correct') && (
                    <button className="btn btn-primary" onClick={() => setAdding(true)}>{t('punch_add')}</button>
                )}
            </div>

            {truncated && <p role="status" style={{ margin: 0, color: 'var(--warn-fg)', fontSize: '0.86rem' }}>{t('punch_truncated').replace('{n}', String(body?.data?.limit ?? ''))}</p>}
            {error ? <p style={{ color: 'var(--danger-fg)' }}>{t('punch_failed')}</p>
                : punches === null ? <LoadingSpinner />
                    : punches.length === 0 ? <p style={{ margin: 0, color: 'var(--text-soft)' }}>{t('punch_none')}</p>
                        : (
                            <div style={{ overflowX: 'auto' }}>
                                <table className="table" style={{ width: '100%', fontSize: '0.86rem' }}>
                                    <thead>
                                        <tr>
                                            <th>{t('punch_time')}</th>
                                            {(seesOthers || waiting) && <th>{t('punch_person')}</th>}
                                            <th>{t('punch_direction')}</th>
                                            <th>{t('punch_source')}</th>
                                            <th />
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {punches.map(x => (
                                            <tr key={x.id} style={{ opacity: x.voidedAt ? 0.5 : 1 }}>
                                                <td style={{ whiteSpace: 'nowrap', textDecoration: x.voidedAt ? 'line-through' : 'none' }}>
                                                    <bdi>{x.at.slice(0, 10)} {x.at.slice(11, 16)}</bdi>
                                                </td>
                                                {(seesOthers || waiting) && (
                                                    <td>{x.name ?? <span style={{ color: 'var(--text-soft)' }}>{t('punch_number').replace('{code}', x.hardwareUserId ?? '')}</span>}</td>
                                                )}
                                                <td>{x.direction === 'IN' ? t('punch_in') : x.direction === 'OUT' ? t('punch_out') : '—'}</td>
                                                <td>
                                                    {x.source === 'AGENT' ? t('punch_source_terminal').replace('{name}', x.deviceName ?? '—')
                                                        : x.source === 'MOBILE' ? t('punch_source_app').replace('{place}', x.placeName ?? '—')
                                                        : t(x.source === 'MANUAL' ? 'punch_source_manual' : 'punch_source_import')}
                                                    {/* A check-in that doesn't count yet, or won't: why (§9.6). */}
                                                    {x.status && x.status !== 'ACCEPTED' && (
                                                        <div style={{ color: x.status === 'REJECTED' ? 'var(--danger-fg)' : 'var(--warn-fg)', fontSize: '0.78rem' }}>
                                                            {t(`punch_status_${x.status}` as TranslationKey)}
                                                            {(x.flagReasons ?? []).length > 0 && ` · ${(x.flagReasons ?? []).map(r => t(`att_flag_${r}` as TranslationKey)).join(', ')}`}
                                                        </div>
                                                    )}
                                                    {x.note && <div style={{ color: 'var(--text-soft)', fontSize: '0.78rem' }}>{x.note}</div>}
                                                    {x.voidedAt && <div style={{ color: 'var(--text-soft)', fontSize: '0.78rem' }}>{t('punch_withdrawn_because').replace('{reason}', x.voidReason ?? '')}</div>}
                                                </td>
                                                <td style={{ textAlign: 'end' }}>
                                                    {mayCorrect(x) && x.userId !== me && (
                                                        <button type="button" className="btn btn-secondary" style={{ fontSize: '0.78rem', padding: '0.25rem 0.6rem' }} onClick={() => setWithdrawing(x)}>
                                                            {t('punch_withdraw')}
                                                        </button>
                                                    )}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        )}

            {adding && (
                <AddPunchModal
                    today={today}
                    companyId={companyId}
                    people={people.filter(x => x.id !== me && p.canFor('attendance.correct', x.id, x.teamLeaderId))}
                    onClose={() => setAdding(false)}
                    onAdded={() => { setAdding(false); mutate() }}
                />
            )}
            <ConfirmModal
                isOpen={!!withdrawing}
                title={t('punch_withdraw')}
                message={t('punch_withdraw_hint')}
                confirmText={t('punch_withdraw')}
                variant="danger"
                reason={{ label: t('punch_reason') }}
                onConfirm={withdraw}
                onCancel={() => setWithdrawing(null)}
            />
        </section>
    )
}

// --- Import ---------------------------------------------------------------------

const PROBLEM_KEYS: Record<string, TranslationKey> = {
    NO_CODE: 'punch_problem_NO_CODE', NO_DATE: 'punch_problem_NO_DATE', BAD_DATE: 'punch_problem_BAD_DATE',
    NO_TIME: 'punch_problem_NO_TIME', BAD_TIME: 'punch_problem_BAD_TIME',
}

function ImportTab({ q, companyId }: { q: string; companyId: string | null }) {
    const { t } = useLanguage()
    const { showToast } = useToast()
    const [file, setFile] = useState<File | null>(null)
    const [dateOrder, setDateOrder] = useState<'DMY' | 'MDY'>('DMY')
    const [columns, setColumns] = useState<Report['columns']>(null)
    // The report on screen, with the exact file and settings it was made from:
    // importing sends those, never whatever the controls hold now (review on #12).
    const [report, setReport] = useState<(Report & { made: { file: File; dateOrder: 'DMY' | 'MDY'; columns: Report['columns'] } }) | null>(null)
    const [busy, setBusy] = useState(false)
    const [withdrawing, setWithdrawing] = useState<ImportRow | null>(null)
    const { data: history, mutate } = useSWR(`/api/attendance/imports?${q}`, fetcher)
    const imports: ImportRow[] = history?.data?.imports ?? []
    // Bumped by every change of file or settings and by every request, so a
    // reply to an older request is dropped rather than shown over a newer one.
    const generation = useRef(0)
    const invalidate = () => { generation.current += 1; setReport(null) }

    const run = async (commit: boolean, chosen: Report['columns'] = columns) => {
        const made = commit && report ? report.made : file ? { file, dateOrder, columns: chosen } : null
        if (!made) return
        const mine = ++generation.current
        setBusy(true)
        try {
            const form = new FormData()
            form.append('file', made.file)
            form.append('dateOrder', made.dateOrder)
            if (companyId) form.append('companyId', companyId)
            if (made.columns) form.append('columns', JSON.stringify(made.columns))
            if (commit) form.append('commit', 'true')
            const r = await send('/api/attendance/imports', { method: 'POST', body: form }, t('punch_failed'))
            if (mine !== generation.current) return
            if (!r.ok) return showToast(r.error, 'error')
            if (commit) {
                showToast(t('punch_imported').replace('{n}', String(r.body.added ?? 0)), 'success')
                setFile(null); setReport(null); setColumns(null)
                mutate()
            } else {
                setReport({ ...r.body, made: { ...made, columns: r.body.columns } })
                setColumns(r.body.columns)
            }
        } finally { if (mine === generation.current) setBusy(false) }
    }

    const withdraw = async (reason?: string) => {
        if (!withdrawing) return
        const r = await send(`/api/attendance/imports/${withdrawing.id}/void`, json('POST', { reason }), t('punch_failed'))
        setWithdrawing(null)
        if (!r.ok) return showToast(r.error, 'error')
        showToast(t('punch_import_withdrawn'), 'success')
        mutate()
    }

    const pick = (field: 'code' | 'date' | 'time' | 'direction', value: string) => {
        const base = columns ?? { code: 0, date: 1, time: null, direction: null }
        const next = { ...base, [field]: value === '' ? null : Number(value) }
        setColumns(next)
        // run() starts a new generation, so a reply for the previous columns is dropped.
        run(false, next)
    }

    return (
        <div style={{ display: 'grid', gap: '1rem' }}>
            <section className="glass" style={{ padding: '1.25rem', borderRadius: '1rem', display: 'grid', gap: '0.85rem' }}>
                <p style={{ margin: 0, fontSize: '0.86rem', color: 'var(--text-soft)' }}>{t('punch_import_hint')}</p>
                <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
                    <label style={{ display: 'grid', gap: '0.25rem' }}>
                        <span className="label">{t('punch_file')}</span>
                        <input className="input" type="file" accept=".xlsx,.csv,.txt" disabled={busy} onChange={e => { setFile(e.target.files?.[0] ?? null); setColumns(null); invalidate() }} />
                    </label>
                    <label style={{ display: 'grid', gap: '0.25rem' }}>
                        <span className="label">{t('punch_date_order')}</span>
                        <select className="input" value={dateOrder} disabled={busy} onChange={e => { setDateOrder(e.target.value as 'DMY' | 'MDY'); invalidate() }}>
                            <option value="DMY">{t('punch_date_order_dmy')}</option>
                            <option value="MDY">{t('punch_date_order_mdy')}</option>
                        </select>
                    </label>
                    <button className="btn btn-secondary" disabled={!file || busy} onClick={() => run(false)}>{t('punch_check_file')}</button>
                </div>

                {report && <ImportReportView report={report} onPick={pick} busy={busy} />}

                {report && (
                    <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                        <button className="btn btn-primary" disabled={busy || report.ready - report.duplicates <= 0} onClick={() => run(true)}>
                            {t('punch_import_n').replace('{n}', String(Math.max(0, report.ready - report.duplicates)))}
                        </button>
                    </div>
                )}
            </section>

            <section className="glass" style={{ padding: '1.25rem', borderRadius: '1rem' }}>
                <h3 style={{ margin: '0 0 0.75rem', fontSize: '1rem' }}>{t('punch_import_history')}</h3>
                {imports.length === 0 ? <p style={{ margin: 0, color: 'var(--text-soft)', fontSize: '0.86rem' }}>{t('punch_no_imports')}</p> : (
                    <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: '0.5rem' }}>
                        {imports.map(i => (
                            <li key={i.id} style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center', fontSize: '0.86rem', opacity: i.voidedAt ? 0.55 : 1 }}>
                                <strong><bdi>{i.fileName}</bdi></strong>
                                <span style={{ color: 'var(--text-soft)' }}><bdi>{i.createdAt.slice(0, 10)}</bdi></span>
                                <span>{t('punch_import_counts').replace('{added}', String(i.addedCount)).replace('{dup}', String(i.duplicateCount)).replace('{refused}', String(i.refusedCount))}</span>
                                {i.voidedAt
                                    ? <span style={{ color: 'var(--text-soft)' }}>{t('punch_withdrawn_because').replace('{reason}', i.voidReason ?? '')}</span>
                                    : <button type="button" className="btn btn-secondary" style={{ fontSize: '0.78rem', padding: '0.25rem 0.6rem' }} onClick={() => setWithdrawing(i)}>{t('punch_withdraw_import')}</button>}
                            </li>
                        ))}
                    </ul>
                )}
            </section>

            <ConfirmModal
                isOpen={!!withdrawing}
                title={t('punch_withdraw_import')}
                message={t('punch_withdraw_import_hint')}
                confirmText={t('punch_withdraw_import')}
                variant="danger"
                reason={{ label: t('punch_reason') }}
                onConfirm={withdraw}
                onCancel={() => setWithdrawing(null)}
            />
        </div>
    )
}

function ImportReportView({ report, onPick, busy }: { report: Report; onPick: (field: 'code' | 'date' | 'time' | 'direction', value: string) => void; busy: boolean }) {
    const { t } = useLanguage()
    const columnSelect = (field: 'code' | 'date' | 'time' | 'direction', labelKey: TranslationKey, optional: boolean) => (
        <label style={{ display: 'grid', gap: '0.25rem' }}>
            <span className="label">{t(labelKey)}</span>
            <select className="input" value={report.columns?.[field] ?? ''} disabled={busy} onChange={e => onPick(field, e.target.value)}>
                {(optional || !report.columns) && <option value="">{optional ? t('punch_column_none') : t('punch_column_choose')}</option>}
                {report.headers.map((h, i) => <option key={i} value={i}>{h || `#${i + 1}`}</option>)}
            </select>
        </label>
    )
    const unmatched = report.codes.filter(c => !c.userId)

    return (
        <div style={{ display: 'grid', gap: '0.85rem' }}>
            {!report.columns && <p style={{ margin: 0, color: 'var(--warn-fg)' }}>{t('punch_columns_not_found')}</p>}
            <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
                {columnSelect('code', 'punch_column_code', false)}
                {columnSelect('date', 'punch_column_date', false)}
                {columnSelect('time', 'punch_column_time', true)}
                {columnSelect('direction', 'punch_column_direction', true)}
            </div>
            {report.columns && (
                <ul style={{ margin: 0, paddingInlineStart: '1.2rem', fontSize: '0.86rem', display: 'grid', gap: '0.2rem' }}>
                    <li>{t('punch_report_rows').replace('{n}', String(report.rowCount)).replace('{from}', report.from ?? '—').replace('{to}', report.to ?? '—')}</li>
                    <li>{t('punch_report_new').replace('{n}', String(report.ready - report.duplicates))}</li>
                    {report.duplicates > 0 && <li>{t('punch_report_duplicates').replace('{n}', String(report.duplicates))}</li>}
                    {report.locked > 0 && <li style={{ color: 'var(--warn-fg)' }}>{t('punch_report_locked').replace('{n}', String(report.locked))}</li>}
                    {report.problemCount > 0 && <li style={{ color: 'var(--danger-fg)' }}>{t('punch_report_problems').replace('{n}', String(report.problemCount))}</li>}
                    {unmatched.length > 0 && <li style={{ color: 'var(--warn-fg)' }}>{t('punch_report_unmatched').replace('{codes}', unmatched.map(c => c.code).join(', '))}</li>}
                </ul>
            )}
            {report.problems.length > 0 && (
                <details>
                    <summary style={{ cursor: 'pointer', fontSize: '0.86rem' }}>{t('punch_report_show_problems')}</summary>
                    <ul style={{ margin: '0.5rem 0 0', paddingInlineStart: '1.2rem', fontSize: '0.82rem' }}>
                        {report.problems.map(x => (
                            <li key={x.row}>{t('punch_problem_row').replace('{row}', String(x.row))}: {t(PROBLEM_KEYS[x.error] ?? 'punch_failed')}</li>
                        ))}
                    </ul>
                </details>
            )}
        </div>
    )
}

// --- Employee numbers ------------------------------------------------------------

function NumbersTab({ q, companyId }: { q: string; companyId: string | null }) {
    const { t } = useLanguage()
    const { showToast } = useToast()
    const { data: session } = useSession()
    const { data: body, mutate } = useSWR(`/api/attendance/codes?${q}`, fetcher)
    const { data: peopleBody } = useSWR(`/api/attendance/people?${q}`, fetcher)
    const codes: Codes | null = body?.data ?? null
    const people: Person[] = (peopleBody?.data?.people ?? []).filter((x: Person) => x.id !== session?.user?.id)
    const [choice, setChoice] = useState<Record<string, string>>({})
    const [newCode, setNewCode] = useState('')
    const [newPerson, setNewPerson] = useState('')
    const action = useBusyAction()
    const [removing, setRemoving] = useState<Codes['mapped'][number] | null>(null)

    const map = async (code: string, userId: string) => {
        const r = await send('/api/attendance/codes', json('POST', { ...(companyId ? { companyId } : {}), code, userId }), t('punch_failed'))
        if (!r.ok) return showToast(r.error, 'error')
        showToast(t('punch_number_mapped').replace('{n}', String(r.body?.filled ?? 0)), 'success')
        setNewCode(''); setNewPerson('')
        mutate()
    }
    const unmap = async () => {
        if (!removing) return
        const r = await send(`/api/attendance/codes/${removing.id}`, { method: 'DELETE' }, t('punch_failed'))
        setRemoving(null)
        if (!r.ok) return showToast(r.error, 'error')
        showToast(t('punch_number_removed'), 'success')
        mutate()
    }

    if (!codes) return <LoadingSpinner />
    return (
        <div style={{ display: 'grid', gap: '1rem' }}>
            <section className="glass" style={{ padding: '1.25rem', borderRadius: '1rem', display: 'grid', gap: '0.75rem' }}>
                <h3 style={{ margin: 0, fontSize: '1rem' }}>{t('punch_numbers_waiting')}</h3>
                <p style={{ margin: 0, fontSize: '0.86rem', color: 'var(--text-soft)' }}>{t('punch_numbers_waiting_hint')}</p>
                {codes.unmatched.length === 0 ? <p style={{ margin: 0, fontSize: '0.86rem' }}>{t('punch_numbers_none_waiting')}</p> : codes.unmatched.map(u => (
                    <div key={u.code} style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center', fontSize: '0.86rem' }}>
                        <strong style={{ minWidth: '4rem' }}><bdi>{u.code}</bdi></strong>
                        <span style={{ color: 'var(--text-soft)' }}>{t('punch_numbers_seen').replace('{n}', String(u.punches)).replace('{from}', u.from).replace('{to}', u.to)}</span>
                        <select className="input" aria-label={t('punch_person')} style={{ width: 'auto' }} value={choice[u.code] ?? ''} onChange={e => setChoice({ ...choice, [u.code]: e.target.value })}>
                            <option value="">{t('punch_choose_person')}</option>
                            {people.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}
                        </select>
                        <button className="btn btn-primary" style={{ fontSize: '0.8rem', padding: '0.3rem 0.7rem' }} disabled={!choice[u.code] || action.running} aria-busy={action.is(`map-${u.code}`)} onClick={() => action.run(`map-${u.code}`, () => map(u.code, choice[u.code]))}>{t('punch_map')}</button>
                    </div>
                ))}
            </section>

            <section className="glass" style={{ padding: '1.25rem', borderRadius: '1rem', display: 'grid', gap: '0.75rem' }}>
                <h3 style={{ margin: 0, fontSize: '1rem' }}>{t('punch_numbers_mapped')}</h3>
                <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
                    <label style={{ display: 'grid', gap: '0.25rem' }}>
                        <span className="label">{t('punch_column_code')}</span>
                        <input className="input" value={newCode} onChange={e => setNewCode(e.target.value)} style={{ width: '8rem' }} />
                    </label>
                    <label style={{ display: 'grid', gap: '0.25rem' }}>
                        <span className="label">{t('punch_person')}</span>
                        <select className="input" value={newPerson} onChange={e => setNewPerson(e.target.value)}>
                            <option value="">{t('punch_choose_person')}</option>
                            {people.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}
                        </select>
                    </label>
                    <button className="btn btn-secondary" disabled={!newCode.trim() || !newPerson || action.running} aria-busy={action.is('map-new')} onClick={() => action.run('map-new', () => map(newCode.trim(), newPerson))}>{t('punch_map')}</button>
                </div>
                {codes.mapped.length === 0 ? <p style={{ margin: 0, fontSize: '0.86rem', color: 'var(--text-soft)' }}>{t('punch_numbers_none_mapped')}</p> : (
                    <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: '0.4rem' }}>
                        {codes.mapped.map(m => (
                            <li key={m.id} style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', fontSize: '0.86rem' }}>
                                <strong style={{ minWidth: '4rem' }}><bdi>{m.code}</bdi></strong>
                                <span style={{ flex: 1 }}>{m.name}</span>
                                {m.userId !== session?.user?.id && (
                                    <button type="button" style={{ background: 'none', border: 'none', color: 'var(--danger-fg)', cursor: 'pointer', fontSize: '0.8rem' }} onClick={() => setRemoving(m)}>{t('punch_number_remove')}</button>
                                )}
                            </li>
                        ))}
                    </ul>
                )}
            </section>

            <ConfirmModal
                isOpen={!!removing}
                title={t('punch_number_remove')}
                message={t('punch_number_remove_hint')}
                confirmText={t('punch_number_remove')}
                variant="danger"
                onConfirm={unmap}
                onCancel={() => setRemoving(null)}
            />
        </div>
    )
}

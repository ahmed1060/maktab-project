'use client'

import { useMemo, useState } from 'react'
import { useSession } from 'next-auth/react'
import useSWR from 'swr'
import { fetcher } from '@/lib/swr-fetcher'
import { useCan } from '@/lib/useCan'
import { useLanguage } from '@/context/LanguageContext'
import { useToast } from '@/context/ToastContext'
import LoadingSpinner from '@/components/LoadingSpinner'
import ConfirmModal from '@/components/ConfirmModal'
import type { TranslationKey } from '@/lib/translations'
import AddPunchModal from './AddPunchModal'
import { checkoutDate } from '@/lib/attendance/checkout-date'
import { send, json } from './send'

/**
 * Daily exceptions (ATTENDANCE_PLAN.md §13.1): only what needs a decision,
 * with a count per kind, for the people the viewer sees. Lateness and early
 * leave that count, and absences, are excused (not charged, with a reason)
 * or accepted (the charge stands); a missing punch is added; overtime is
 * approved or rejected. What waits on the Requests and Employee numbers tabs
 * is counted and opens there. Every decision is audited and can be undone.
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
    counts: { late: number; early: number; absent: number; incomplete: number; overtime: number; permissions: number | null; missing: number | null; unmatched: number | null }
    /** Kinds with more than the list shows. */
    capped?: Record<string, boolean>
}
type Kind = 'lateEarly' | 'absent' | 'incomplete' | 'overtime' | 'decided'
type Person = { id: string; name: string; teamLeaderId: string | null }

const money = (minor: number) => (minor / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const small = { fontSize: '0.78rem', padding: '0.25rem 0.6rem' } as const
const soft = { color: 'var(--text-soft)', fontSize: '0.78rem' } as const
const NOTE_KEY: Record<string, TranslationKey> = { FREE_OCCURRENCE: 'day_note_free', ESCALATED: 'day_note_escalated', CAPPED: 'day_note_capped' }

export default function ExceptionsTab({ q, companyId, today, onOpen }: { q: string; companyId: string | null; today: string; onOpen: (tab: 'requests' | 'numbers') => void }) {
    const { t } = useLanguage()
    const { showToast } = useToast()
    const p = useCan()
    const { data: session } = useSession()
    const me = session?.user?.id
    const yesterday = useMemo(() => {
        const d = new Date(`${today}T00:00:00Z`)
        d.setUTCDate(d.getUTCDate() - 1)
        return d.toISOString().slice(0, 10)
    }, [today])
    const [from, setFrom] = useState(() => `${yesterday.slice(0, 8)}01`)
    const [to, setTo] = useState(yesterday)
    const [kind, setKind] = useState<Kind>('lateEarly')
    const [excusing, setExcusing] = useState<{ row: { userId: string; date: string }; subject: Subject } | null>(null)
    const [rejecting, setRejecting] = useState<Row | null>(null)
    const [adding, setAdding] = useState<Row | null>(null)
    const [busy, setBusy] = useState(false)

    const { data: body, error, mutate } = useSWR(from && to && from <= to ? `/api/attendance/exceptions?${q}from=${from}&to=${to}` : null, fetcher)
    const { data: peopleBody } = useSWR(`/api/attendance/people?${q}`, fetcher)
    const people: Person[] = useMemo(() => peopleBody?.data?.people ?? [], [peopleBody])
    const data: Data | undefined = body?.data
    const companyField = companyId ? { companyId } : {}

    const act = async (url: string, init: RequestInit, done: TranslationKey) => {
        setBusy(true)
        try {
            const r = await send(url, init, t('punch_failed'))
            if (!r.ok) return showToast(r.error, 'error')
            showToast(t(done), 'success')
            mutate()
        } finally { setBusy(false) }
    }
    const decide = (row: { userId: string; date: string }, subject: Subject, outcome: 'EXCUSED' | 'ACCEPTED', reason?: string) =>
        act('/api/attendance/decisions', json('POST', { ...companyField, userId: row.userId, date: row.date, subject, outcome, reason: reason ?? null }), outcome === 'EXCUSED' ? 'exc_excused' : 'exc_accepted')
    const overtime = (row: Row, status: 'APPROVED' | 'REJECTED', note?: string) =>
        act('/api/attendance/overtime', json('POST', { ...companyField, userId: row.userId, date: row.date, status, note: note ?? null }), status === 'APPROVED' ? 'req_approved' : 'req_rejected')
    const corrects = (row: { userId: string; teamLeaderId: string | null }) => row.userId !== me && p.canFor('attendance.correct', row.userId, row.teamLeaderId)
    const approvesOvertime = (row: Row) => row.userId !== me && p.canFor('attendance.approve_overtime', row.userId, row.teamLeaderId)

    const c = data?.counts
    const cap = data?.capped ?? {}
    const kinds: { key: Kind; label: TranslationKey; count: number | undefined; more?: boolean }[] = [
        { key: 'lateEarly', label: 'exc_tab_late', count: c ? c.late + c.early : undefined, more: cap.late || cap.early },
        { key: 'absent', label: 'exc_tab_absent', count: c?.absent, more: cap.absent },
        { key: 'incomplete', label: 'exc_tab_incomplete', count: c?.incomplete, more: cap.incomplete },
        { key: 'overtime', label: 'exc_tab_overtime', count: c?.overtime, more: cap.overtime },
        { key: 'decided', label: 'exc_tab_decided', count: data?.decided.length },
    ]
    const waitingRequests = (c?.permissions ?? 0) + (c?.missing ?? 0)

    const note = (r: RuleOutcome) => r.note && NOTE_KEY[r.note] ? t(NOTE_KEY[r.note]).replace('{n}', String(r.occurrence)) : null
    const buttons = (row: { userId: string; date: string; teamLeaderId: string | null }, subject: Subject) => corrects(row) && (
        <div style={{ display: 'flex', gap: '0.35rem', justifyContent: 'flex-end', flexWrap: 'wrap' }}>
            <button className="btn btn-primary" style={small} disabled={busy} onClick={() => setExcusing({ row, subject })}>{t('exc_excuse')}</button>
            <button className="btn btn-secondary" style={small} disabled={busy} onClick={() => decide(row, subject, 'ACCEPTED')}>{t('exc_accept')}</button>
        </div>
    )

    const lateEarly = data ? [
        ...data.late.map(r => ({ r, subject: 'LATENESS' as const, minutes: r.lateMinutes, rule: r.breakdown.lateness })),
        ...data.early.map(r => ({ r, subject: 'EARLY_LEAVE' as const, minutes: r.earlyLeaveMinutes, rule: r.breakdown.earlyLeave })),
    ].sort((a, b) => b.r.date.localeCompare(a.r.date) || a.r.name.localeCompare(b.r.name)) : []

    return (
        <section className="glass" style={{ padding: '1.25rem', borderRadius: '1rem', display: 'grid', gap: '1rem' }}>
            <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
                <label style={{ display: 'grid', gap: '0.25rem' }}>
                    <span className="label">{t('punch_from')}</span>
                    <input className="input" type="date" value={from} max={yesterday} onChange={e => setFrom(e.target.value)} />
                </label>
                <label style={{ display: 'grid', gap: '0.25rem' }}>
                    <span className="label">{t('punch_to')}</span>
                    <input className="input" type="date" value={to} max={yesterday} onChange={e => setTo(e.target.value)} />
                </label>
                <div style={{ flex: 1 }} />
                {waitingRequests > 0 && <button className="btn btn-secondary" onClick={() => onOpen('requests')}>{t('exc_requests_waiting').replace('{n}', String(waitingRequests))}</button>}
                {(c?.unmatched ?? 0) > 0 && <button className="btn btn-secondary" onClick={() => onOpen('numbers')}>{t('exc_unmatched_waiting').replace('{n}', String(c!.unmatched))}</button>}
            </div>
            <p style={{ margin: 0, ...soft, fontSize: '0.82rem' }}>{t('exc_hint')}</p>

            <div role="tablist" style={{ display: 'flex', gap: '0.4rem', overflowX: 'auto' }}>
                {kinds.map(k => (
                    <button key={k.key} role="tab" aria-selected={kind === k.key} className={kind === k.key ? 'btn btn-primary' : 'btn btn-secondary'} style={{ whiteSpace: 'nowrap' }} onClick={() => setKind(k.key)}>
                        {t(k.label)}{k.count !== undefined && <span style={{ marginInlineStart: '0.4rem', opacity: 0.8 }}>({k.count}{k.more ? '+' : ''})</span>}
                    </button>
                ))}
            </div>

            {error ? <p style={{ color: 'var(--danger-fg)' }}>{t('punch_failed')}</p> : !data ? <LoadingSpinner /> : (
                <div style={{ overflowX: 'auto' }}>
                    {kind === 'lateEarly' && (lateEarly.length === 0 ? <None /> : (
                        <table className="table" style={{ width: '100%', fontSize: '0.84rem' }}>
                            <thead><tr><th>{t('punch_date')}</th><th>{t('punch_person')}</th><th>{t('exc_what')}</th><th>{t('day_deduction')}</th><th /></tr></thead>
                            <tbody>
                                {lateEarly.map(({ r, subject, minutes, rule }) => (
                                    <tr key={`${r.id}:${subject}`}>
                                        <td style={{ whiteSpace: 'nowrap' }}><bdi>{r.date}</bdi></td>
                                        <td>{r.name}</td>
                                        <td>
                                            {t(subject === 'LATENESS' ? 'exc_late_n' : 'exc_early_n').replace('{n}', String(minutes))}
                                            <div style={soft}><bdi>{r.firstIn?.slice(11, 16) ?? '—'}–{r.lastOut?.slice(11, 16) ?? '—'}</bdi>{note(rule) && <> · {note(rule)}</>}</div>
                                        </td>
                                        <td>{rule.days > 0 ? <>{t('day_days').replace('{n}', String(rule.days))}</> : '—'}</td>
                                        <td>{buttons(r, subject)}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    ))}

                    {kind === 'absent' && (data.absent.length === 0 ? <None /> : (
                        <table className="table" style={{ width: '100%', fontSize: '0.84rem' }}>
                            <thead><tr><th>{t('punch_date')}</th><th>{t('punch_person')}</th><th>{t('day_deduction')}</th><th /></tr></thead>
                            <tbody>
                                {data.absent.map(r => (
                                    <tr key={r.id}>
                                        <td style={{ whiteSpace: 'nowrap' }}><bdi>{r.date}</bdi></td>
                                        <td>{r.name}</td>
                                        <td>{r.deductionMinor ? <bdi>{money(r.deductionMinor)}</bdi> : '—'}</td>
                                        <td>{buttons(r, 'ABSENCE')}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    ))}

                    {kind === 'incomplete' && (data.incomplete.length === 0 ? <None /> : (
                        <table className="table" style={{ width: '100%', fontSize: '0.84rem' }}>
                            <thead><tr><th>{t('punch_date')}</th><th>{t('punch_person')}</th><th>{t('exc_punched')}</th><th /></tr></thead>
                            <tbody>
                                {data.incomplete.map(r => (
                                    <tr key={r.id}>
                                        <td style={{ whiteSpace: 'nowrap' }}><bdi>{r.date}</bdi></td>
                                        <td>{r.name}</td>
                                        <td><bdi>{r.firstIn?.slice(11, 16) ?? '—'}</bdi><div style={soft}>{t('day_unpriced_incomplete')}</div></td>
                                        <td style={{ textAlign: 'end' }}>{corrects(r) && <button className="btn btn-primary" style={small} onClick={() => setAdding(r)}>{t('punch_add')}</button>}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    ))}

                    {kind === 'overtime' && (data.overtime.length === 0 ? <None /> : (
                        <table className="table" style={{ width: '100%', fontSize: '0.84rem' }}>
                            <thead><tr><th>{t('punch_date')}</th><th>{t('punch_person')}</th><th>{t('day_overtime')}</th><th /></tr></thead>
                            <tbody>
                                {data.overtime.map(r => (
                                    <tr key={r.id}>
                                        <td style={{ whiteSpace: 'nowrap' }}><bdi>{r.date}</bdi></td>
                                        <td>{r.name}</td>
                                        <td>{t('req_minutes').replace('{n}', String(r.overtimeMinutes))}<div style={soft}><bdi>{r.firstIn?.slice(11, 16) ?? '—'}–{r.lastOut?.slice(11, 16) ?? '—'}</bdi></div></td>
                                        <td>{approvesOvertime(r) && (
                                            <div style={{ display: 'flex', gap: '0.35rem', justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                                                <button className="btn btn-primary" style={small} disabled={busy} onClick={() => overtime(r, 'APPROVED')}>{t('req_approve')}</button>
                                                <button className="btn btn-secondary" style={small} disabled={busy} onClick={() => setRejecting(r)}>{t('req_reject')}</button>
                                            </div>
                                        )}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    ))}

                    {kind === 'decided' && (data.decided.length === 0 ? <None /> : (
                        <table className="table" style={{ width: '100%', fontSize: '0.84rem' }}>
                            <thead><tr><th>{t('punch_date')}</th><th>{t('punch_person')}</th><th>{t('exc_what')}</th><th>{t('req_decision')}</th><th /></tr></thead>
                            <tbody>
                                {data.decided.map(d => (
                                    <tr key={d.id}>
                                        <td style={{ whiteSpace: 'nowrap' }}><bdi>{d.date}</bdi></td>
                                        <td>{d.name}</td>
                                        <td>{t(`audit_value_${d.subject}` as TranslationKey)}</td>
                                        <td>
                                            <span style={{ fontWeight: 600, color: d.outcome === 'EXCUSED' ? 'var(--ok-fg)' : 'var(--text-soft)' }}>{t(d.outcome === 'EXCUSED' ? 'exc_outcome_excused' : 'exc_outcome_accepted')}</span>
                                            {d.reason && <div style={soft}>{d.reason}</div>}
                                        </td>
                                        <td style={{ textAlign: 'end' }}>{corrects(d) && (
                                            <button className="btn btn-secondary" style={small} disabled={busy} onClick={() => act(`/api/attendance/decisions/${d.id}`, { method: 'DELETE' }, 'exc_undone')}>{t('exc_undo')}</button>
                                        )}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    ))}
                </div>
            )}

            {adding && (
                <AddPunchModal
                    today={today}
                    companyId={companyId}
                    people={people.filter(x => x.id === adding.userId)}
                    initial={{ userId: adding.userId, date: checkoutDate(adding.date, adding.expectedEndMinutes), direction: 'OUT' }}
                    onClose={() => setAdding(null)}
                    onAdded={() => { setAdding(null); mutate() }}
                />
            )}
            <ConfirmModal
                isOpen={!!excusing}
                title={t('exc_excuse')}
                message={t('exc_excuse_hint')}
                confirmText={t('exc_excuse')}
                reason={{ label: t('punch_reason') }}
                onConfirm={reason => { const x = excusing; setExcusing(null); if (x) decide(x.row, x.subject, 'EXCUSED', reason) }}
                onCancel={() => setExcusing(null)}
            />
            <ConfirmModal
                isOpen={!!rejecting}
                title={t('req_reject')}
                message={t('req_reject_hint')}
                confirmText={t('req_reject')}
                variant="danger"
                reason={{ label: t('punch_reason'), minLength: 0 }}
                onConfirm={reason => { const r = rejecting; setRejecting(null); if (r) overtime(r, 'REJECTED', reason) }}
                onCancel={() => setRejecting(null)}
            />
        </section>
    )
}

function None() {
    const { t } = useLanguage()
    return <p style={{ margin: 0, color: 'var(--text-soft)' }}>{t('exc_none')}</p>
}

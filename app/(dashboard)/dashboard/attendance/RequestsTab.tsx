'use client'

import { useMemo, useState } from 'react'
import { useSession } from 'next-auth/react'
import useSWR from 'swr'
import { fetcher } from '@/lib/swr-fetcher'
import { useCan } from '@/lib/useCan'
import { useLanguage } from '@/context/LanguageContext'
import { useToast } from '@/context/ToastContext'
import LoadingSpinner from '@/components/LoadingSpinner'
import Modal from '@/components/Modal'
import ConfirmModal from '@/components/ConfirmModal'
import type { TranslationKey } from '@/lib/translations'
import { send, json } from './send'

/**
 * Requests (P0.6): permission hours (إذن) and reports of a missing punch,
 * asked for by everyone for themselves; and, for whoever decides them, the
 * ones waiting — with overtime that waits for approval.
 *
 * attendance.approve_permissions decides permission hours,
 * attendance.approve_overtime overtime, attendance.correct missing punches —
 * each at its scope, and never one's own.
 */

type Status = 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED'
type PermissionRow = { id: string; userId: string; name?: string; teamLeaderId?: string | null; date: string; type: string; start: string; end: string; minutes: number; reason: string; status: Status; rejectionReason: string | null }
type MissingRow = { id: string; userId: string; name?: string; teamLeaderId?: string | null; at: string; direction: 'IN' | 'OUT' | null; reason: string; status: Status; rejectionReason: string | null }
type Waiting = { userId: string; name: string; teamLeaderId: string | null; date: string; overtimeMinutes: number; firstIn: string | null; lastOut: string | null }
type Decision = { id: string; userId: string; name: string; teamLeaderId: string | null; date: string; status: 'APPROVED' | 'REJECTED'; approvedMinutes: number; note: string | null }
type Balance = { enabled: boolean; types: string[]; allowanceMinutes: number; carriedMinutes: number; approvedMinutes: number; pendingMinutes: number; remainingMinutes: number; requests: number; maxRequests: number | null; minPerRequestMinutes: number; maxPerRequestMinutes: number }
type Person = { id: string; name: string; teamLeaderId: string | null }

const STATUS_COLOR: Record<Status, string> = { PENDING: 'var(--warn-fg)', APPROVED: 'var(--ok-fg)', REJECTED: 'var(--danger-fg)', CANCELLED: 'var(--text-soft)' }
const TYPE_KEY: Record<string, TranslationKey> = { LATE_ARRIVAL: 'audit_value_LATE_ARRIVAL', EARLY_LEAVE: 'audit_value_EARLY_LEAVE', MIDDAY: 'audit_value_MIDDAY' }
const lastDayOf = (month: string) => { const [y, m] = month.split('-').map(Number); return `${month}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}` }
const box = { padding: '1.25rem', borderRadius: '1rem', display: 'grid', gap: '1rem' } as const
const small = { fontSize: '0.78rem', padding: '0.25rem 0.6rem' } as const
const soft = { color: 'var(--text-soft)', fontSize: '0.78rem' } as const

export default function RequestsTab({ q, companyId, today }: { q: string; companyId: string | null; today: string }) {
    const { data: session } = useSession()
    const asks = session?.user?.role !== 'SUPER_ADMIN'
    return (
        <div style={{ display: 'grid', gap: '1rem' }}>
            {asks && <MyRequests today={today} />}
            <ToDecide q={q} companyId={companyId} today={today} />
        </div>
    )
}

// --- one's own -----------------------------------------------------------------

function MyRequests({ today }: { today: string }) {
    const { t } = useLanguage()
    const { showToast } = useToast()
    const [asking, setAsking] = useState(false)
    const [reporting, setReporting] = useState(false)
    const [withdrawing, setWithdrawing] = useState<{ kind: 'permission' | 'missing'; id: string } | null>(null)
    const { data: balanceBody, mutate: refreshBalance } = useSWR(`/api/attendance/permissions/balance?month=${today.slice(0, 7)}`, fetcher)
    const { data: permBody, mutate: refreshPerms } = useSWR('/api/attendance/permissions?mine=1', fetcher)
    const { data: missBody, mutate: refreshMissing } = useSWR('/api/attendance/missing-punches?mine=1', fetcher)
    const balance: Balance | undefined = balanceBody?.data
    const permissions: PermissionRow[] | null = permBody ? permBody.data?.requests ?? [] : null
    const missing: MissingRow[] | null = missBody ? missBody.data?.requests ?? [] : null
    const refresh = () => { refreshBalance(); refreshPerms(); refreshMissing() }

    const withdraw = async () => {
        if (!withdrawing) return
        const url = withdrawing.kind === 'permission' ? `/api/attendance/permissions/${withdrawing.id}` : `/api/attendance/missing-punches/${withdrawing.id}`
        const r = await send(url, { method: 'DELETE' }, t('punch_failed'))
        setWithdrawing(null)
        if (!r.ok) return showToast(r.error, 'error')
        showToast(t('req_withdrawn'), 'success')
        refresh()
    }

    return (
        <section className="glass" style={box}>
            <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center' }}>
                <h2 style={{ margin: 0, fontSize: '1.05rem' }}>{t('req_mine')}</h2>
                <div style={{ flex: 1 }} />
                {balance?.enabled && <button className="btn btn-primary" onClick={() => setAsking(true)}>{t('req_ask_permission')}</button>}
                <button className="btn btn-secondary" onClick={() => setReporting(true)}>{t('req_report_missing')}</button>
            </div>
            {balance && (
                <p style={{ margin: 0, fontSize: '0.88rem' }}>
                    {balance.enabled
                        ? t('req_balance')
                            .replace('{left}', String(balance.remainingMinutes))
                            .replace('{total}', String(balance.allowanceMinutes + balance.carriedMinutes))
                            .replace('{pending}', String(balance.pendingMinutes))
                        : t('req_permissions_off')}
                    {balance.enabled && balance.carriedMinutes > 0 && <span style={soft}> · {t('req_carried').replace('{n}', String(balance.carriedMinutes))}</span>}
                </p>
            )}

            <h3 style={{ margin: 0, fontSize: '0.95rem' }}>{t('req_permissions')}</h3>
            {permissions === null ? <LoadingSpinner /> : permissions.length === 0 ? <p style={{ margin: 0, ...soft }}>{t('req_none')}</p> : (
                <div style={{ overflowX: 'auto' }}>
                    <table className="table" style={{ width: '100%', fontSize: '0.84rem' }}>
                        <thead><tr><th>{t('punch_date')}</th><th>{t('req_type')}</th><th>{t('req_time')}</th><th>{t('req_status')}</th><th /></tr></thead>
                        <tbody>
                            {permissions.map(r => (
                                <tr key={r.id}>
                                    <td style={{ whiteSpace: 'nowrap' }}><bdi>{r.date}</bdi></td>
                                    <td>{t(TYPE_KEY[r.type])}<div style={soft}>{r.reason}</div></td>
                                    <td style={{ whiteSpace: 'nowrap' }}><bdi>{r.start}–{r.end}</bdi><div style={soft}>{t('req_minutes').replace('{n}', String(r.minutes))}</div></td>
                                    <td><StatusText status={r.status} why={r.rejectionReason} /></td>
                                    <td style={{ textAlign: 'end' }}>
                                        {(r.status === 'PENDING' || (r.status === 'APPROVED' && r.date > today)) && (
                                            <button className="btn btn-secondary" style={small} onClick={() => setWithdrawing({ kind: 'permission', id: r.id })}>{t('req_withdraw')}</button>
                                        )}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}

            <h3 style={{ margin: 0, fontSize: '0.95rem' }}>{t('req_missing')}</h3>
            {missing === null ? <LoadingSpinner /> : missing.length === 0 ? <p style={{ margin: 0, ...soft }}>{t('req_none')}</p> : (
                <div style={{ overflowX: 'auto' }}>
                    <table className="table" style={{ width: '100%', fontSize: '0.84rem' }}>
                        <thead><tr><th>{t('punch_time')}</th><th>{t('punch_direction')}</th><th>{t('req_status')}</th><th /></tr></thead>
                        <tbody>
                            {missing.map(r => (
                                <tr key={r.id}>
                                    <td style={{ whiteSpace: 'nowrap' }}><bdi>{r.at.replace('T', ' ')}</bdi><div style={soft}>{r.reason}</div></td>
                                    <td>{r.direction === 'IN' ? t('punch_in') : r.direction === 'OUT' ? t('punch_out') : '—'}</td>
                                    <td><StatusText status={r.status} why={r.rejectionReason} /></td>
                                    <td style={{ textAlign: 'end' }}>
                                        {r.status === 'PENDING' && <button className="btn btn-secondary" style={small} onClick={() => setWithdrawing({ kind: 'missing', id: r.id })}>{t('req_withdraw')}</button>}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}

            {asking && balance && <AskPermissionModal today={today} balance={balance} onClose={() => setAsking(false)} onDone={() => { setAsking(false); refresh() }} />}
            {reporting && <ReportMissingModal today={today} onClose={() => setReporting(false)} onDone={() => { setReporting(false); refresh() }} />}
            <ConfirmModal
                isOpen={!!withdrawing}
                title={t('req_withdraw')}
                message={t('req_withdraw_hint')}
                confirmText={t('req_withdraw')}
                variant="danger"
                onConfirm={withdraw}
                onCancel={() => setWithdrawing(null)}
            />
        </section>
    )
}

function StatusText({ status, why }: { status: Status; why: string | null }) {
    const { t } = useLanguage()
    return (
        <>
            <span style={{ color: STATUS_COLOR[status], fontWeight: 600 }}>{t(`audit_value_${status}` as TranslationKey)}</span>
            {why && <div style={soft}>{why}</div>}
        </>
    )
}

function AskPermissionModal({ today, balance, onClose, onDone }: { today: string; balance: Balance; onClose: () => void; onDone: () => void }) {
    const { t } = useLanguage()
    const { showToast } = useToast()
    const [date, setDate] = useState(today)
    const [type, setType] = useState(balance.types[0] ?? 'LATE_ARRIVAL')
    const [start, setStart] = useState('')
    const [end, setEnd] = useState('')
    const [reason, setReason] = useState('')
    const [busy, setBusy] = useState(false)

    const save = async () => {
        setBusy(true)
        try {
            const r = await send('/api/attendance/permissions', json('POST', { date, type, start, end, reason }), t('punch_failed'))
            if (!r.ok) return showToast(r.error, 'error')
            showToast(t('req_asked'), 'success')
            onDone()
        } finally { setBusy(false) }
    }

    return (
        <Modal isOpen onClose={onClose} title={t('req_ask_permission')}>
            <div style={{ display: 'grid', gap: '0.75rem' }}>
                <p style={{ margin: 0, ...soft }}>
                    {t('req_limits').replace('{min}', String(balance.minPerRequestMinutes)).replace('{max}', String(balance.maxPerRequestMinutes)).replace('{left}', String(balance.remainingMinutes))}
                </p>
                <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
                    <label style={{ display: 'grid', gap: '0.25rem' }}>
                        <span className="label">{t('punch_date')}</span>
                        <input className="input" type="date" value={date} onChange={e => setDate(e.target.value)} />
                    </label>
                    <label style={{ display: 'grid', gap: '0.25rem' }}>
                        <span className="label">{t('req_type')}</span>
                        <select className="input" value={type} onChange={e => setType(e.target.value)}>
                            {balance.types.map(x => <option key={x} value={x}>{t(TYPE_KEY[x])}</option>)}
                        </select>
                    </label>
                    <label style={{ display: 'grid', gap: '0.25rem' }}>
                        <span className="label">{t('req_from')}</span>
                        <input className="input" type="time" value={start} onChange={e => setStart(e.target.value)} />
                    </label>
                    <label style={{ display: 'grid', gap: '0.25rem' }}>
                        <span className="label">{t('req_to')}</span>
                        <input className="input" type="time" value={end} onChange={e => setEnd(e.target.value)} />
                    </label>
                </div>
                <label style={{ display: 'grid', gap: '0.25rem' }}>
                    <span className="label">{t('punch_reason')}</span>
                    <textarea className="input" rows={2} value={reason} onChange={e => setReason(e.target.value)} />
                </label>
                <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
                    <button className="btn btn-secondary" onClick={onClose}>{t('cancel')}</button>
                    <button className="btn btn-primary" disabled={busy || !date || !start || !end || !reason.trim()} onClick={save}>{t('req_send')}</button>
                </div>
            </div>
        </Modal>
    )
}

function ReportMissingModal({ today, onClose, onDone }: { today: string; onClose: () => void; onDone: () => void }) {
    const { t } = useLanguage()
    const { showToast } = useToast()
    const [date, setDate] = useState(today)
    const [time, setTime] = useState('')
    const [direction, setDirection] = useState<'' | 'IN' | 'OUT'>('')
    const [reason, setReason] = useState('')
    const [busy, setBusy] = useState(false)

    const save = async () => {
        setBusy(true)
        try {
            const r = await send('/api/attendance/missing-punches', json('POST', { at: `${date}T${time}`, direction: direction || null, reason }), t('punch_failed'))
            if (!r.ok) return showToast(r.error, 'error')
            showToast(t('req_reported'), 'success')
            onDone()
        } finally { setBusy(false) }
    }

    return (
        <Modal isOpen onClose={onClose} title={t('req_report_missing')}>
            <div style={{ display: 'grid', gap: '0.75rem' }}>
                <p style={{ margin: 0, ...soft }}>{t('req_missing_hint')}</p>
                <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
                    <label style={{ display: 'grid', gap: '0.25rem' }}>
                        <span className="label">{t('punch_date')}</span>
                        <input className="input" type="date" value={date} max={today} onChange={e => setDate(e.target.value)} />
                    </label>
                    <label style={{ display: 'grid', gap: '0.25rem' }}>
                        <span className="label">{t('punch_time')}</span>
                        <input className="input" type="time" value={time} onChange={e => setTime(e.target.value)} />
                    </label>
                    <label style={{ display: 'grid', gap: '0.25rem' }}>
                        <span className="label">{t('punch_direction')}</span>
                        <select className="input" value={direction} onChange={e => setDirection(e.target.value as '' | 'IN' | 'OUT')}>
                            <option value="">{t('punch_direction_unknown')}</option>
                            <option value="IN">{t('punch_in')}</option>
                            <option value="OUT">{t('punch_out')}</option>
                        </select>
                    </label>
                </div>
                <label style={{ display: 'grid', gap: '0.25rem' }}>
                    <span className="label">{t('punch_reason')}</span>
                    <textarea className="input" rows={2} value={reason} onChange={e => setReason(e.target.value)} placeholder={t('req_missing_example')} />
                </label>
                <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
                    <button className="btn btn-secondary" onClick={onClose}>{t('cancel')}</button>
                    <button className="btn btn-primary" disabled={busy || !date || !time || !reason.trim()} onClick={save}>{t('req_send')}</button>
                </div>
            </div>
        </Modal>
    )
}

// --- to decide -------------------------------------------------------------------

type Rejecting = { kind: 'permission' | 'missing'; id: string } | { kind: 'overtime'; userId: string; date: string }

function ToDecide({ q, companyId, today }: { q: string; companyId: string | null; today: string }) {
    const { t } = useLanguage()
    const { showToast } = useToast()
    const p = useCan()
    const { data: session } = useSession()
    const me = session?.user?.id
    const decidesPermissions = p.can('attendance.approve_permissions')
    const decidesOvertime = p.can('attendance.approve_overtime')
    const decidesMissing = p.can('attendance.correct')
    const [month, setMonth] = useState(() => today.slice(0, 7))
    const [rejecting, setRejecting] = useState<Rejecting | null>(null)
    const [approvingAhead, setApprovingAhead] = useState(false)
    const [busy, setBusy] = useState(false)

    const { data: permBody, mutate: refreshPerms } = useSWR(decidesPermissions ? `/api/attendance/permissions?${q}status=PENDING` : null, fetcher)
    const { data: missBody, mutate: refreshMissing } = useSWR(decidesMissing ? `/api/attendance/missing-punches?${q}status=PENDING` : null, fetcher)
    const { data: otBody, mutate: refreshOvertime } = useSWR(decidesOvertime && month ? `/api/attendance/overtime?${q}from=${month}-01&to=${lastDayOf(month)}` : null, fetcher)
    const { data: peopleBody } = useSWR(decidesOvertime ? `/api/attendance/people?${q}` : null, fetcher)
    const people: Person[] = useMemo(() => peopleBody?.data?.people ?? [], [peopleBody])
    const permissions: PermissionRow[] | null = permBody ? permBody.data?.requests ?? [] : null
    const missing: MissingRow[] | null = missBody ? missBody.data?.requests ?? [] : null
    const waiting: Waiting[] | null = otBody ? otBody.data?.waiting ?? [] : null
    const decisions: Decision[] = otBody?.data?.decisions ?? []

    if (!decidesPermissions && !decidesOvertime && !decidesMissing) return null
    const companyField = companyId ? { companyId } : {}

    const act = async (url: string, init: RequestInit, done: TranslationKey, refresh: () => void) => {
        setBusy(true)
        try {
            const r = await send(url, init, t('punch_failed'))
            if (!r.ok) return showToast(r.error, 'error')
            showToast(t(done), 'success')
            refresh()
        } finally { setBusy(false) }
    }
    const decide = (kind: 'permission' | 'missing', id: string, approve: boolean, reason?: string) => act(
        kind === 'permission' ? `/api/attendance/permissions/${id}/decide` : `/api/attendance/missing-punches/${id}/decide`,
        json('POST', { approve, reason: reason ?? null }),
        approve ? 'req_approved' : 'req_rejected',
        kind === 'permission' ? refreshPerms : refreshMissing,
    )
    const decideOvertime = (userId: string, date: string, status: 'APPROVED' | 'REJECTED', note?: string) =>
        act('/api/attendance/overtime', json('POST', { ...companyField, userId, date, status, note: note ?? null }), status === 'APPROVED' ? 'req_approved' : 'req_rejected', refreshOvertime)

    const reject = async (reason?: string) => {
        const r = rejecting
        setRejecting(null)
        if (!r) return
        if (r.kind === 'overtime') return decideOvertime(r.userId, r.date, 'REJECTED', reason)
        return decide(r.kind, r.id, false, reason)
    }
    const approveReject = (onApprove: () => void, onReject: () => void) => (
        <div style={{ display: 'flex', gap: '0.35rem', justifyContent: 'flex-end', flexWrap: 'wrap' }}>
            <button className="btn btn-primary" style={small} disabled={busy} onClick={onApprove}>{t('req_approve')}</button>
            <button className="btn btn-secondary" style={small} disabled={busy} onClick={onReject}>{t('req_reject')}</button>
        </div>
    )
    const mine = (userId: string) => userId === me

    return (
        <section className="glass" style={box}>
            <h2 style={{ margin: 0, fontSize: '1.05rem' }}>{t('req_to_decide')}</h2>

            {decidesPermissions && (
                <>
                    <h3 style={{ margin: 0, fontSize: '0.95rem' }}>{t('req_permissions')}</h3>
                    {permissions === null ? <LoadingSpinner /> : permissions.length === 0 ? <p style={{ margin: 0, ...soft }}>{t('req_none_waiting')}</p> : (
                        <div style={{ overflowX: 'auto' }}>
                            <table className="table" style={{ width: '100%', fontSize: '0.84rem' }}>
                                <thead><tr><th>{t('punch_person')}</th><th>{t('punch_date')}</th><th>{t('req_type')}</th><th>{t('req_time')}</th><th /></tr></thead>
                                <tbody>
                                    {permissions.map(r => (
                                        <tr key={r.id}>
                                            <td>{r.name}</td>
                                            <td style={{ whiteSpace: 'nowrap' }}><bdi>{r.date}</bdi></td>
                                            <td>{t(TYPE_KEY[r.type])}<div style={soft}>{r.reason}</div></td>
                                            <td style={{ whiteSpace: 'nowrap' }}><bdi>{r.start}–{r.end}</bdi><div style={soft}>{t('req_minutes').replace('{n}', String(r.minutes))}</div></td>
                                            <td>{!mine(r.userId) && p.canFor('attendance.approve_permissions', r.userId, r.teamLeaderId) && (
                                                approveReject(() => decide('permission', r.id, true), () => setRejecting({ kind: 'permission', id: r.id }))
                                            )}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </>
            )}

            {decidesMissing && (
                <>
                    <h3 style={{ margin: 0, fontSize: '0.95rem' }}>{t('req_missing')}</h3>
                    {missing === null ? <LoadingSpinner /> : missing.length === 0 ? <p style={{ margin: 0, ...soft }}>{t('req_none_waiting')}</p> : (
                        <div style={{ overflowX: 'auto' }}>
                            <table className="table" style={{ width: '100%', fontSize: '0.84rem' }}>
                                <thead><tr><th>{t('punch_person')}</th><th>{t('punch_time')}</th><th>{t('punch_direction')}</th><th /></tr></thead>
                                <tbody>
                                    {missing.map(r => (
                                        <tr key={r.id}>
                                            <td>{r.name}</td>
                                            <td style={{ whiteSpace: 'nowrap' }}><bdi>{r.at.replace('T', ' ')}</bdi><div style={soft}>{r.reason}</div></td>
                                            <td>{r.direction === 'IN' ? t('punch_in') : r.direction === 'OUT' ? t('punch_out') : '—'}</td>
                                            <td>{!mine(r.userId) && p.canFor('attendance.correct', r.userId, r.teamLeaderId) && (
                                                approveReject(() => decide('missing', r.id, true), () => setRejecting({ kind: 'missing', id: r.id }))
                                            )}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </>
            )}

            {decidesOvertime && (
                <>
                    <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
                        <h3 style={{ margin: 0, fontSize: '0.95rem' }}>{t('req_overtime')}</h3>
                        <input className="input" type="month" aria-label={t('day_month')} value={month} onChange={e => setMonth(e.target.value)} style={{ maxWidth: '11rem' }} />
                        <div style={{ flex: 1 }} />
                        <button className="btn btn-secondary" onClick={() => setApprovingAhead(true)}>{t('req_overtime_ahead')}</button>
                    </div>
                    {waiting === null ? <LoadingSpinner /> : (
                        <>
                            {waiting.length === 0 ? <p style={{ margin: 0, ...soft }}>{t('req_none_waiting')}</p> : (
                                <div style={{ overflowX: 'auto' }}>
                                    <table className="table" style={{ width: '100%', fontSize: '0.84rem' }}>
                                        <thead><tr><th>{t('punch_person')}</th><th>{t('punch_date')}</th><th>{t('day_overtime')}</th><th /></tr></thead>
                                        <tbody>
                                            {waiting.map(w => (
                                                <tr key={`${w.userId}:${w.date}`}>
                                                    <td>{w.name}</td>
                                                    <td style={{ whiteSpace: 'nowrap' }}><bdi>{w.date}</bdi><div style={soft}><bdi>{w.firstIn?.slice(11, 16) ?? '—'}–{w.lastOut?.slice(11, 16) ?? '—'}</bdi></div></td>
                                                    <td>{t('req_minutes').replace('{n}', String(w.overtimeMinutes))}</td>
                                                    <td>{!mine(w.userId) && p.canFor('attendance.approve_overtime', w.userId, w.teamLeaderId) && (
                                                        approveReject(() => decideOvertime(w.userId, w.date, 'APPROVED'), () => setRejecting({ kind: 'overtime', userId: w.userId, date: w.date }))
                                                    )}</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            )}
                            {decisions.length > 0 && (
                                <div style={{ overflowX: 'auto' }}>
                                    <table className="table" style={{ width: '100%', fontSize: '0.84rem' }}>
                                        <thead><tr><th>{t('punch_person')}</th><th>{t('punch_date')}</th><th>{t('req_decision')}</th><th /></tr></thead>
                                        <tbody>
                                            {decisions.map(d => (
                                                <tr key={d.id}>
                                                    <td>{d.name}</td>
                                                    <td style={{ whiteSpace: 'nowrap' }}><bdi>{d.date}</bdi></td>
                                                    <td>
                                                        <StatusText status={d.status} why={d.note} />
                                                        {d.status === 'APPROVED' && <div style={soft}>{t('req_minutes').replace('{n}', String(d.approvedMinutes))}</div>}
                                                    </td>
                                                    <td style={{ textAlign: 'end' }}>
                                                        {!mine(d.userId) && p.canFor('attendance.approve_overtime', d.userId, d.teamLeaderId) && (
                                                            <button className="btn btn-secondary" style={small} disabled={busy} onClick={() => act(`/api/attendance/overtime/${d.id}`, { method: 'DELETE' }, 'req_withdrawn', refreshOvertime)}>{t('req_withdraw')}</button>
                                                        )}
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            )}
                        </>
                    )}
                </>
            )}

            {approvingAhead && (
                <OvertimeAheadModal
                    today={today}
                    companyId={companyId}
                    people={people.filter(x => x.id !== me && p.canFor('attendance.approve_overtime', x.id, x.teamLeaderId))}
                    onClose={() => setApprovingAhead(false)}
                    onDone={() => { setApprovingAhead(false); refreshOvertime() }}
                />
            )}
            <ConfirmModal
                isOpen={!!rejecting}
                title={t('req_reject')}
                message={t('req_reject_hint')}
                confirmText={t('req_reject')}
                variant="danger"
                reason={{ label: t('punch_reason'), minLength: 0 }}
                onConfirm={reject}
                onCancel={() => setRejecting(null)}
            />
        </section>
    )
}

function OvertimeAheadModal({ today, companyId, people, onClose, onDone }: { today: string; companyId: string | null; people: Person[]; onClose: () => void; onDone: () => void }) {
    const { t } = useLanguage()
    const { showToast } = useToast()
    const [userId, setUserId] = useState('')
    const [date, setDate] = useState(today)
    const [hours, setHours] = useState('')
    const [note, setNote] = useState('')
    const [busy, setBusy] = useState(false)
    const minutes = Math.round(Number(hours) * 60)

    const save = async () => {
        setBusy(true)
        try {
            const r = await send('/api/attendance/overtime', json('POST', { ...(companyId ? { companyId } : {}), userId, date, status: 'APPROVED', minutes, note: note || null }), t('punch_failed'))
            if (!r.ok) return showToast(r.error, 'error')
            showToast(t('req_approved'), 'success')
            onDone()
        } finally { setBusy(false) }
    }

    return (
        <Modal isOpen onClose={onClose} title={t('req_overtime_ahead')}>
            <div style={{ display: 'grid', gap: '0.75rem' }}>
                <p style={{ margin: 0, ...soft }}>{t('req_overtime_ahead_hint')}</p>
                <label style={{ display: 'grid', gap: '0.25rem' }}>
                    <span className="label">{t('punch_person')}</span>
                    <select className="input" value={userId} onChange={e => setUserId(e.target.value)}>
                        <option value="">{t('punch_choose_person')}</option>
                        {people.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}
                    </select>
                </label>
                <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
                    <label style={{ display: 'grid', gap: '0.25rem' }}>
                        <span className="label">{t('punch_date')}</span>
                        <input className="input" type="date" value={date} onChange={e => setDate(e.target.value)} />
                    </label>
                    <label style={{ display: 'grid', gap: '0.25rem' }}>
                        <span className="label">{t('req_hours')}</span>
                        <input className="input" type="number" min="0.5" max="24" step="0.5" value={hours} onChange={e => setHours(e.target.value)} />
                    </label>
                </div>
                <label style={{ display: 'grid', gap: '0.25rem' }}>
                    <span className="label">{t('req_note')}</span>
                    <input className="input" value={note} onChange={e => setNote(e.target.value)} />
                </label>
                <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
                    <button className="btn btn-secondary" onClick={onClose}>{t('cancel')}</button>
                    <button className="btn btn-primary" disabled={busy || !userId || !date || !(minutes >= 1 && minutes <= 1440)} onClick={save}>{t('req_approve')}</button>
                </div>
            </div>
        </Modal>
    )
}

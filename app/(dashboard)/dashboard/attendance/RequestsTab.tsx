'use client'

import { useMemo, useState } from 'react'
import { useSession } from 'next-auth/react'
import useSWR from 'swr'
import { fetcher } from '@/lib/swr-fetcher'
import { useCan } from '@/lib/useCan'
import { FlaggedFaceModal } from '@/components/FacePhoto'
import { useLanguage } from '@/context/LanguageContext'
import { useToast } from '@/context/ToastContext'
import LoadingSpinner from '@/components/LoadingSpinner'
import Modal from '@/components/Modal'
import ConfirmModal from '@/components/ConfirmModal'
import type { TranslationKey } from '@/lib/translations'
import { send, json } from './send'
import { googleMapsLink } from '@/lib/attendance/geo'

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
type FlaggedRow = {
    id: string; userId: string; name: string; teamLeaderId: string | null; at: string; flagReasons: string[]
    checkIn: { latitude?: number; longitude?: number; distanceMeters?: number; accuracyMeters?: number; ip?: string | null } | null
    workLocation: { name: string } | null; phone: { model: string | null; platform: string } | null
}
type PhoneRow = { id: string; userId: string; name: string; teamLeaderId: string | null; platform: 'ANDROID' | 'IOS'; model: string | null; appVersion: string | null; attested: boolean; status: 'PENDING' | 'ACTIVE'; requestedAt: string; decidedAt: string | null; held: number }

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
            {asks && <MyPhone />}
            {asks && <MyRequests today={today} />}
            <ToDecide q={q} companyId={companyId} today={today} />
        </div>
    )
}

// --- one's own -----------------------------------------------------------------

/**
 * The phone one checks in from (ATTENDANCE_PLAN.md §9.2, §9.3): registered in
 * the app; seen here, and a new one waiting can be cancelled. Not there for a
 * company without the Mobile App add-on.
 */
function MyPhone() {
    const { t } = useLanguage()
    const { showToast } = useToast()
    const [cancelling, setCancelling] = useState(false)
    const { data, error, mutate } = useSWR('/api/attendance/phone', fetcher)
    if (error || !data?.data) return null
    const { active, pending } = data.data as { active: { model: string | null; platform: string } | null; pending: { model: string | null; platform: string } | null }
    const label = (ph: { model: string | null; platform: string }) => ph.model || t(`audit_value_${ph.platform}` as TranslationKey)
    const withdraw = async () => {
        try {
            const r = await send('/api/attendance/phone', { method: 'DELETE' }, t('punch_failed'))
            if (!r.ok) return showToast(r.error, 'error')
            showToast(t('req_my_phone_withdrawn'), 'success')
            mutate()
        } finally { setCancelling(false) }
    }
    return (
        <section className="glass" style={{ ...box, gap: '0.5rem' }}>
            <h2 style={{ margin: 0, fontSize: '1.05rem' }}>{t('req_my_phone')}</h2>
            {!active && !pending && <p style={{ margin: 0, ...soft }}>{t('req_my_phone_none')}</p>}
            {active && <p style={{ margin: 0, fontSize: '0.88rem' }}>{t('req_my_phone_in_use').replace('{model}', label(active))}</p>}
            {pending && (
                <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center' }}>
                    <p style={{ margin: 0, fontSize: '0.88rem', flex: '1 1 16rem' }}>{t('req_my_phone_waiting').replace('{model}', label(pending))}</p>
                    <button className="btn btn-secondary" style={small} onClick={() => setCancelling(true)}>{t('req_my_phone_withdraw')}</button>
                </div>
            )}
            <ConfirmModal
                isOpen={cancelling}
                title={t('req_my_phone_withdraw')}
                message={t('req_my_phone_withdraw_confirm')}
                confirmText={t('req_my_phone_withdraw')}
                variant="danger"
                onConfirm={withdraw}
                onCancel={() => setCancelling(false)}
            />
        </section>
    )
}

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
                {/* Always offered: a later month's policy may allow what this one doesn't (review on #14). */}
                <button className="btn btn-primary" onClick={() => setAsking(true)}>{t('req_ask_permission')}</button>
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

            {asking && <AskPermissionModal today={today} onClose={() => setAsking(false)} onDone={() => { setAsking(false); refresh() }} />}
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

/** Asks for permission hours; from a day on the Days tab, with its times filled in (§13.3). */
export function AskPermissionModal({ today, initial, onClose, onDone }: {
    today: string
    initial?: { date: string; type: 'LATE_ARRIVAL' | 'EARLY_LEAVE'; start: string; end: string }
    onClose: () => void
    onDone: () => void
}) {
    const { t } = useLanguage()
    const { showToast } = useToast()
    const [date, setDate] = useState(initial?.date ?? today)
    // The rules and balance of the chosen day's month, under the policy in force that day (review on #14).
    const { data: balanceBody } = useSWR(/^\d{4}-\d{2}-\d{2}$/.test(date) ? `/api/attendance/permissions/balance?date=${date}` : null, fetcher)
    const balance: Balance | undefined = balanceBody?.data
    const [picked, setType] = useState<string>(initial?.type ?? '')
    const type = balance?.types.includes(picked) ? picked : balance?.types[0] ?? ''
    const [start, setStart] = useState(initial?.start ?? '')
    const [end, setEnd] = useState(initial?.end ?? '')
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
                    {!balance ? '…' : balance.enabled
                        ? t('req_limits').replace('{min}', String(balance.minPerRequestMinutes)).replace('{max}', String(balance.maxPerRequestMinutes)).replace('{left}', String(balance.remainingMinutes))
                        : t('req_permissions_off_on_day')}
                </p>
                <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
                    <label style={{ display: 'grid', gap: '0.25rem' }}>
                        <span className="label">{t('punch_date')}</span>
                        <input className="input" type="date" value={date} onChange={e => setDate(e.target.value)} />
                    </label>
                    <label style={{ display: 'grid', gap: '0.25rem' }}>
                        <span className="label">{t('req_type')}</span>
                        <select className="input" value={type} onChange={e => setType(e.target.value)}>
                            {(balance?.types ?? []).map(x => <option key={x} value={x}>{t(TYPE_KEY[x])}</option>)}
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
                    <button className="btn btn-primary" disabled={busy || !balance?.enabled || !type || !date || !start || !end || !reason.trim()} onClick={save}>{t('req_send')}</button>
                </div>
            </div>
        </Modal>
    )
}

/** Reports a punch one forgot; from a day on the Days tab, for that day (§13.3). */
export function ReportMissingModal({ today, initial, onClose, onDone }: {
    today: string
    initial?: { date: string; direction?: 'IN' | 'OUT' }
    onClose: () => void
    onDone: () => void
}) {
    const { t } = useLanguage()
    const { showToast } = useToast()
    const [date, setDate] = useState(initial?.date ?? today)
    const [time, setTime] = useState('')
    const [direction, setDirection] = useState<'' | 'IN' | 'OUT'>(initial?.direction ?? '')
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

type Rejecting = { kind: 'permission' | 'missing' | 'phone' | 'checkin'; id: string } | { kind: 'overtime'; userId: string; date: string }

function ToDecide({ q, companyId, today }: { q: string; companyId: string | null; today: string }) {
    const { t } = useLanguage()
    const { showToast } = useToast()
    const p = useCan()
    // A flagged check-in whose face check failed, open beside the reference photo (§13.8).
    const [faceOf, setFaceOf] = useState<{ id: string; name: string } | null>(null)
    const { data: session } = useSession()
    const me = session?.user?.id
    const decidesPermissions = p.can('attendance.approve_permissions')
    const decidesOvertime = p.can('attendance.approve_overtime')
    const decidesMissing = p.can('attendance.correct')
    const decidesPhones = p.can('attendance.approve_devices')
    const [month, setMonth] = useState(() => today.slice(0, 7))
    const [rejecting, setRejecting] = useState<Rejecting | null>(null)
    const [approvingAhead, setApprovingAhead] = useState(false)
    const [revoking, setRevoking] = useState<PhoneRow | null>(null)
    const [busy, setBusy] = useState(false)

    const { data: permBody, mutate: refreshPerms } = useSWR(decidesPermissions ? `/api/attendance/permissions?${q}status=PENDING` : null, fetcher)
    const { data: missBody, mutate: refreshMissing } = useSWR(decidesMissing ? `/api/attendance/missing-punches?${q}status=PENDING` : null, fetcher)
    const { data: otBody, mutate: refreshOvertime } = useSWR(decidesOvertime && month ? `/api/attendance/overtime?${q}from=${month}-01&to=${lastDayOf(month)}` : null, fetcher)
    const { data: flagBody, error: flagError, mutate: refreshFlagged } = useSWR(decidesMissing ? `/api/attendance/flagged?${q}` : null, fetcher)
    const { data: phoneBody, error: phoneError, mutate: refreshPhones } = useSWR(decidesPhones ? `/api/attendance/phones?${q}` : null, fetcher)
    const { data: peopleBody } = useSWR(decidesOvertime ? `/api/attendance/people?${q}` : null, fetcher)
    const people: Person[] = useMemo(() => peopleBody?.data?.people ?? [], [peopleBody])
    const permissions: PermissionRow[] | null = permBody ? permBody.data?.requests ?? [] : null
    const missing: MissingRow[] | null = missBody ? missBody.data?.requests ?? [] : null
    const waiting: Waiting[] | null = otBody ? otBody.data?.waiting ?? [] : null
    const decisions: Decision[] = otBody?.data?.decisions ?? []
    const phones: PhoneRow[] = phoneBody?.data?.phones ?? []
    const flagged: FlaggedRow[] = flagBody?.data?.checkIns ?? []

    if (!decidesPermissions && !decidesOvertime && !decidesMissing && !decidesPhones) return null
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
    const decideCheckIn = (id: string, accept: boolean, reason?: string) =>
        act(`/api/attendance/flagged/${id}/decide`, json('POST', { accept, reason: reason ?? null }), accept ? 'req_approved' : 'req_rejected', refreshFlagged)
    const decidePhone = (id: string, approve: boolean, reason?: string) =>
        act(`/api/attendance/phones/${id}/decide`, json('POST', { approve, reason: reason ?? null }), approve ? 'req_approved' : 'req_rejected', refreshPhones)
    const decideOvertime = (userId: string, date: string, status: 'APPROVED' | 'REJECTED', note?: string) =>
        act('/api/attendance/overtime', json('POST', { ...companyField, userId, date, status, note: note ?? null }), status === 'APPROVED' ? 'req_approved' : 'req_rejected', refreshOvertime)

    const reject = async (reason?: string) => {
        const r = rejecting
        if (!r) return
        try {
            if (r.kind === 'overtime') return await decideOvertime(r.userId, r.date, 'REJECTED', reason)
            if (r.kind === 'phone') return await decidePhone(r.id, false, reason)
            if (r.kind === 'checkin') return await decideCheckIn(r.id, false, reason)
            return await decide(r.kind, r.id, false, reason)
        } finally { setRejecting(null) }
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

            {/* Check-ins the app flagged for the company to decide (§9.6): shown while
                loading or failing, and once loaded only when there is one. */}
            {decidesMissing && (!flagBody || flagged.length > 0) && (
                <>
                    <h3 style={{ margin: 0, fontSize: '0.95rem' }}>{t('req_flagged')}</h3>
                    <p style={{ margin: 0, ...soft }}>{t('req_flagged_hint')}</p>
                    {!flagBody ? (flagError ? <p style={{ margin: 0, ...soft, color: 'var(--danger-fg)' }}>{t('error_generic')}</p> : <LoadingSpinner />) : (
                        <div style={{ overflowX: 'auto' }}>
                            <table className="table" style={{ width: '100%', fontSize: '0.84rem' }}>
                                <thead><tr><th>{t('punch_person')}</th><th>{t('punch_time')}</th><th>{t('req_flagged_why')}</th><th /></tr></thead>
                                <tbody>
                                    {flagged.map(f => (
                                        <tr key={f.id}>
                                            <td>{f.name}</td>
                                            <td style={{ whiteSpace: 'nowrap' }}>
                                                <bdi>{f.at.slice(0, 10)} {f.at.slice(11, 16)}</bdi>
                                                <div style={soft}>{f.workLocation?.name ?? '—'}</div>
                                            </td>
                                            <td>
                                                {f.flagReasons.map(r => t(`att_flag_${r}` as TranslationKey)).join(', ')}
                                                {f.flagReasons.includes('FACE_UNVERIFIED') && !mine(f.userId) && p.companyWide('attendance.approve_face') && (
                                                    <> · <button type="button" style={{ background: 'none', border: 'none', padding: 0, color: 'var(--brand-primary-text)', cursor: 'pointer' }} onClick={() => setFaceOf({ id: f.id, name: f.name })}>{t('face_flag_see')}</button></>
                                                )}
                                                <div style={soft}>{[
                                                    f.checkIn?.distanceMeters !== undefined && t('req_flagged_distance').replace('{n}', String(f.checkIn.distanceMeters)),
                                                    f.checkIn?.accuracyMeters !== undefined && t('req_flagged_accuracy').replace('{n}', String(Math.round(f.checkIn.accuracyMeters))),
                                                    f.checkIn?.ip,
                                                ].filter(Boolean).join(' · ')}
                                                    {f.checkIn?.latitude !== undefined && f.checkIn?.longitude !== undefined && (
                                                        <> · <a href={googleMapsLink(f.checkIn.latitude, f.checkIn.longitude)} target="_blank" rel="noopener noreferrer">{t('att_loc_map')}</a></>
                                                    )}
                                                </div>
                                            </td>
                                            <td>{!mine(f.userId) && p.canFor('attendance.correct', f.userId, f.teamLeaderId) && (
                                                approveReject(() => decideCheckIn(f.id, true), () => setRejecting({ kind: 'checkin', id: f.id }))
                                            )}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                    {faceOf && <FlaggedFaceModal punchId={faceOf.id} name={faceOf.name} onClose={() => setFaceOf(null)} />}
                </>
            )}

            {/* While loading, or failing to, it says so; loaded, only once somebody has a phone: a company without the app has nothing here (§9.3). */}
            {decidesPhones && !phoneBody && (
                <>
                    <h3 style={{ margin: 0, fontSize: '0.95rem' }}>{t('req_phones')}</h3>
                    {phoneError ? <p style={{ margin: 0, ...soft, color: 'var(--danger-fg)' }}>{t('error_generic')}</p> : <LoadingSpinner />}
                </>
            )}
            {/* Loaded empty before, and failing now: no list to show, but somebody may have a phone waiting since (review on #49). */}
            {decidesPhones && phoneBody && phones.length === 0 && phoneError && (
                <>
                    <h3 style={{ margin: 0, fontSize: '0.95rem' }}>{t('req_phones')}</h3>
                    <p role="alert" style={{ margin: 0, ...soft, color: 'var(--danger-fg)' }}>{t('error_generic')}</p>
                </>
            )}
            {decidesPhones && phones.length > 0 && (
                <>
                    <h3 style={{ margin: 0, fontSize: '0.95rem' }}>{t('req_phones')}</h3>
                    <p style={{ margin: 0, ...soft }}>{t('req_phones_hint')}</p>
                    {/* Loaded before, and failing now: the list below may be out of date, so it says so (review on #21). */}
                    {phoneError && <p role="alert" style={{ margin: 0, ...soft, color: 'var(--danger-fg)' }}>{t('error_generic')}</p>}
                    <div style={{ overflowX: 'auto' }}>
                        <table className="table" style={{ width: '100%', fontSize: '0.84rem' }}>
                            <thead><tr><th>{t('punch_person')}</th><th>{t('req_phone')}</th><th>{t('req_phone_state')}</th><th /></tr></thead>
                            <tbody>
                                {phones.map(ph => (
                                    <tr key={ph.id}>
                                        <td>{ph.name}</td>
                                        <td>
                                            {ph.model || t(`audit_value_${ph.platform}` as TranslationKey)}
                                            <div style={soft}>{[t(`audit_value_${ph.platform}` as TranslationKey), ph.appVersion && `v${ph.appVersion}`].filter(Boolean).join(' · ')}</div>
                                            {!ph.attested && <div style={{ ...soft, color: 'var(--warn-fg)' }}>{t('req_phone_unverified')}</div>}
                                        </td>
                                        <td>
                                            {ph.status === 'PENDING' ? <span style={{ color: 'var(--warn-fg)' }}>{t('req_phone_waiting')}</span> : <span style={{ color: 'var(--ok-fg)' }}>{t('req_phone_in_use')}</span>}
                                            {ph.status === 'PENDING' && ph.held > 0 && <div style={soft}>{t('req_phone_held').replace('{n}', String(ph.held))}</div>}
                                        </td>
                                        <td>{!mine(ph.userId) && p.canFor('attendance.approve_devices', ph.userId, ph.teamLeaderId) && (
                                            ph.status === 'PENDING'
                                                ? approveReject(() => decidePhone(ph.id, true), () => setRejecting({ kind: 'phone', id: ph.id }))
                                                : <div style={{ textAlign: 'end' }}><button className="btn btn-secondary" style={{ ...small, color: 'var(--danger-fg)' }} disabled={busy} onClick={() => setRevoking(ph)}>{t('req_phone_revoke')}</button></div>
                                        )}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
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
                isOpen={!!revoking}
                title={t('req_phone_revoke')}
                message={t('req_phone_revoke_confirm').replace('{name}', revoking?.name ?? '')}
                confirmText={t('req_phone_revoke')}
                variant="danger"
                reason={{ label: t('punch_reason'), minLength: 0 }}
                onConfirm={async (reason?: string) => { const ph = revoking; if (ph) await act(`/api/attendance/phones/${ph.id}/revoke`, json('POST', { reason: reason ?? null }), 'req_phone_revoked', refreshPhones); setRevoking(null) }}
                onCancel={() => setRevoking(null)}
            />
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

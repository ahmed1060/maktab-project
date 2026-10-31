'use client'

import { useMemo, useState } from 'react'
import { Button, ButtonLink } from '@/components/ui'
import { useSession } from 'next-auth/react'
import useSWR from 'swr'
import { fetcher } from '@/lib/swr-fetcher'
import { useCan } from '@/lib/useCan'
import { useLanguage } from '@/context/LanguageContext'
import { useToast } from '@/context/ToastContext'
import Modal from '@/components/Modal'
import ConfirmModal from '@/components/ConfirmModal'
import type { TranslationKey } from '@/lib/translations'
import { send, json } from './send'

/**
 * Requests (P0.6): one's own phone, and a pointer to the one Requests page
 * (UI_PLAN.md §2.3, parts 3c and 4d), where one's own requests are, and what
 * waits on whoever decides permission hours, missing punches, overtime,
 * check-in phones and flagged check-ins. Asking from a day still opens the
 * forms here, and approving overtime ahead stays here.
 */

type Balance = { enabled: boolean; types: string[]; allowanceMinutes: number; carriedMinutes: number; approvedMinutes: number; pendingMinutes: number; remainingMinutes: number; requests: number; maxRequests: number | null; minPerRequestMinutes: number; maxPerRequestMinutes: number }
type Person = { id: string; name: string; teamLeaderId: string | null }

const TYPE_KEY: Record<string, TranslationKey> = { LATE_ARRIVAL: 'audit_value_LATE_ARRIVAL', EARLY_LEAVE: 'audit_value_EARLY_LEAVE', MIDDAY: 'audit_value_MIDDAY' }
const box = { padding: '1.25rem', borderRadius: '1rem', display: 'grid', gap: '1rem' } as const
const small = { fontSize: '0.78rem', padding: '0.25rem 0.6rem' } as const
const soft = { color: 'var(--text-soft)', fontSize: '0.78rem' } as const

export default function RequestsTab({ q, companyId, today }: { q: string; companyId: string | null; today: string }) {
    const { data: session } = useSession()
    const asks = session?.user?.role !== 'SUPER_ADMIN'
    return (
        <div style={{ display: 'grid', gap: '1rem' }}>
            {asks && <MyPhone />}
            {asks && <MyRequests />}
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

/**
 * One's own permission hours and missing punches are asked for, followed and
 * withdrawn on the one Requests page (UI_PLAN.md §2.3, part 3c): this points
 * there. Asking from a day on the Days tab still opens the forms below.
 */
function MyRequests() {
    const { t } = useLanguage()
    return (
        <section className="glass" style={box}>
            <h2 style={{ margin: 0, fontSize: '1.05rem' }}>{t('req_mine')}</h2>
            <p style={{ margin: 0, fontSize: '0.88rem' }}>{t('requests_moved_mine')}</p>
            <div><ButtonLink href="/dashboard/requests?tab=mine">{t('requests_open_mine')}</ButtonLink></div>
        </section>
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

/**
 * What waits on this person is decided on the one Requests page, under To
 * review (UI_PLAN.md §2.3, parts 3c and 4d): permission hours, missing
 * punches, overtime, check-in phones and flagged check-ins. This points
 * there. Approving overtime ahead of its day stays here: it isn't a request
 * (decided on 2026-10-31).
 */
function ToDecide({ q, companyId, today }: { q: string; companyId: string | null; today: string }) {
    const { t } = useLanguage()
    const p = useCan()
    const { data: session } = useSession()
    const me = session?.user?.id
    const decidesPermissions = p.can('attendance.approve_permissions')
    const decidesOvertime = p.can('attendance.approve_overtime')
    const decidesMissing = p.can('attendance.correct')
    const decidesPhones = p.can('attendance.approve_devices')
    const [approvingAhead, setApprovingAhead] = useState(false)
    const { data: peopleBody } = useSWR(decidesOvertime ? `/api/attendance/people?${q}` : null, fetcher)
    const people: Person[] = useMemo(() => peopleBody?.data?.people ?? [], [peopleBody])

    if (!decidesPermissions && !decidesOvertime && !decidesMissing && !decidesPhones) return null

    return (
        <section className="glass" style={box}>
            <h2 style={{ margin: 0, fontSize: '1.05rem' }}>{t('req_to_decide')}</h2>
            <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center' }}>
                <p style={{ margin: 0, fontSize: '0.88rem', flex: '1 1 16rem' }}>{t('requests_moved_review')}</p>
                <ButtonLink href="/dashboard/requests?tab=review">{t('requests_open_review')}</ButtonLink>
            </div>
            {decidesOvertime && (
                <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center' }}>
                    <p style={{ margin: 0, fontSize: '0.88rem', flex: '1 1 16rem' }}>{t('requests_overtime_ahead_line')}</p>
                    {/* The building blocks' button, as the link beside it is (found in the browser). */}
                    <Button onClick={() => setApprovingAhead(true)}>{t('req_overtime_ahead')}</Button>
                </div>
            )}
            {approvingAhead && (
                <OvertimeAheadModal
                    today={today}
                    companyId={companyId}
                    people={people.filter(x => x.id !== me && p.canFor('attendance.approve_overtime', x.id, x.teamLeaderId))}
                    onClose={() => setApprovingAhead(false)}
                    onDone={() => setApprovingAhead(false)}
                />
            )}
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

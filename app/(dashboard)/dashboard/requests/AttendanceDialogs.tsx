'use client'
import { useState } from 'react'
import useSWR from 'swr'
import { fetcher } from '@/lib/swr-fetcher'
import { useLanguage } from '@/context/LanguageContext'
import { useToast } from '@/context/ToastContext'
import { useBusyAction } from '@/lib/useBusyAction'
import type { TranslationKey } from '@/lib/translations'
import type { FeedRow, RequestKind } from '@/lib/requests/kinds'
import DatePickerSingle from '@/components/DatePickerSingle'
import { Button, Dialog, DialogActions, Field, Select, TextArea, TextInput } from '@/components/ui'

/**
 * Attendance requests on the one Requests page (UI_PLAN.md §2.3, part 3):
 * asking for permission hours (part 3a) and reporting a missing punch (part
 * 3b), and rejecting and withdrawing either, as the Attendance page's
 * Requests tab did.
 */

/** The attendance kinds, and each one's API (app/api/attendance). */
export type AttendanceKind = Extract<RequestKind, 'permission' | 'missingPunch'>
export const ATTENDANCE_API: Record<AttendanceKind, string> = {
    permission: '/api/attendance/permissions',
    missingPunch: '/api/attendance/missing-punches',
}

/** The server's own check (lib/validations/attendance-request.schema.ts): a reason, and a reason to refuse. */
const REASON_MAX = 500

/** A permission's type, by name. */
export const PERMISSION_TYPE_LABEL: Record<string, TranslationKey> = {
    LATE_ARRIVAL: 'audit_value_LATE_ARRIVAL',
    EARLY_LEAVE: 'audit_value_EARLY_LEAVE',
    MIDDAY: 'audit_value_MIDDAY',
}

/** Why the server refused, by its code (lib/api-errors.ts), in the person's language. */
const REFUSED: Record<string, TranslationKey> = {
    PERMISSION_HOURS_OFF: 'req_permissions_off_on_day',
    PERMISSION_TYPE_NOT_ALLOWED: 'requests_permission_type_refused',
    PERMISSION_TOO_SHORT: 'requests_permission_too_short',
    PERMISSION_TOO_LONG: 'requests_permission_too_long',
    PERMISSION_TOO_MANY_REQUESTS: 'requests_permission_too_many',
    PERMISSION_OVER_ALLOWANCE: 'requests_permission_over',
    PERMISSION_TOO_LATE: 'requests_permission_too_late',
    PERMISSION_OVERLAPS: 'requests_permission_overlap',
    PAYROLL_MONTH_LOCKED: 'requests_month_locked',
    REQUEST_ALREADY_DECIDED: 'requests_already_decided',
    REQUEST_ALREADY_STARTED: 'requests_permission_started',
    PUNCH_IN_FUTURE: 'requests_missing_future',
    MISSING_PUNCH_ALREADY_REPORTED: 'requests_missing_already',
}

const dateLocale = (locale: string) => locale === 'ar' ? 'ar-EG' : 'en-GB'
const digits = (locale: string) => (n: number) => n.toLocaleString(dateLocale(locale))

/** A permission's day, a calendar day: read as such wherever the screen is. */
export function permissionDay(date: string, locale: string) {
    return new Date(`${date}T00:00:00Z`).toLocaleDateString(dateLocale(locale), { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
}

/** A wall-clock time, "2026-10-28T17:05": its day, as permissionDay, and its time, as clockText. */
export const punchDay = (at: string, locale: string) => permissionDay(at.slice(0, 10), locale)
export const punchTime = (at: string, locale: string) => clockText(at.slice(11, 16), locale)

/** A time of day, "16:00", as the language writes it. */
export function clockText(hhmm: string, locale: string) {
    const [h, m] = hhmm.split(':').map(Number)
    return new Date(Date.UTC(2000, 0, 1, h, m)).toLocaleTimeString(dateLocale(locale), { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' })
}

/** What a refusal says, from the response: the server's reason, or the fallback. */
async function refusal(res: Response, fallback: TranslationKey): Promise<TranslationKey> {
    const body = await res.json().catch(() => ({}))
    return REFUSED[body?.code] ?? fallback
}

/** Approves or rejects somebody's permission hours or missing punch. Null once done; otherwise what to say. */
export async function decideAttendance(request: Pick<FeedRow, 'id' | 'kind'>, approve: boolean, reason: string | null): Promise<TranslationKey | null> {
    try {
        const res = await fetch(`${ATTENDANCE_API[request.kind as AttendanceKind]}/${request.id}/decide`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ approve, reason }),
        })
        return res.ok ? null : await refusal(res, 'error_generic')
    } catch {
        return 'error_generic'
    }
}

/** Rejecting permission hours or a missing punch, with a reason if there is one. */
export function RejectAttendance({ request, question, placeholder, onClose, onDecided }: {
    request: FeedRow
    /** What's being refused, in a sentence: whose, and which. */
    question: string
    placeholder: string
    onClose: () => void
    onDecided: () => void
}) {
    const { t, locale } = useLanguage()
    const { showToast } = useToast()
    const action = useBusyAction()
    const num = digits(locale)
    const [reason, setReason] = useState('')

    const reject = () => void action.run('decide', async () => {
        // The schema takes an empty reason as none given.
        const refused = await decideAttendance(request, false, reason.trim() || null)
        if (refused) {
            showToast(t(refused), 'error')
            return
        }
        showToast(t('request_action_success'), 'success')
        onDecided()
    })

    return (
        <Dialog
            open
            onClose={onClose}
            title={t('confirm_rejection_title')}
            actions={<>
                <Button onClick={onClose}>{t('cancel')}</Button>
                <Button variant="danger" onClick={reject} disabled={action.running} busy={action.is('decide')}>{t('reject_button')}</Button>
            </>}
        >
            <p>{question}</p>
            <Field label={t('rejection_reason_label')} hint={t('ui_characters_used').replace('{used}', num(reason.length)).replace('{max}', num(REASON_MAX))}>{p => (
                <TextArea {...p} name="rejection-reason" dir="auto" placeholder={placeholder} value={reason} onChange={e => setReason(e.target.value)} maxLength={500} />
            )}</Field>
        </Dialog>
    )
}

/** Withdrawing one's own permission hours or report of a missing punch. */
export function WithdrawAttendance({ request, hint, onClose, onWithdrawn }: { request: FeedRow; hint: string; onClose: () => void; onWithdrawn: () => void }) {
    const { t } = useLanguage()
    const { showToast } = useToast()
    const action = useBusyAction()

    const withdraw = () => void action.run('withdraw', async () => {
        try {
            const res = await fetch(`${ATTENDANCE_API[request.kind as AttendanceKind]}/${request.id}`, { method: 'DELETE' })
            if (!res.ok) {
                showToast(t(await refusal(res, 'error_generic')), 'error')
                return
            }
            showToast(t('req_withdrawn'), 'success')
            onWithdrawn()
        } catch {
            showToast(t('error_generic'), 'error')
        }
    })

    return (
        <Dialog
            open
            onClose={onClose}
            title={t('requests_withdraw_title')}
            actions={<>
                <Button onClick={onClose}>{t('cancel')}</Button>
                <Button variant="danger" onClick={withdraw} disabled={action.running} busy={action.is('withdraw')}>{t('req_withdraw')}</Button>
            </>}
        >
            <p>{hint}</p>
        </Dialog>
    )
}

/** The chosen day's rules and what's left of its month's (GET /api/attendance/permissions/balance). */
type Balance = { enabled: boolean; types: string[]; remainingMinutes: number; minPerRequestMinutes: number; maxPerRequestMinutes: number }

type Errors = { date?: string; start?: string; end?: string; reason?: string }

/**
 * Asking for permission hours: the day, under the policy in force that day,
 * whose limits and what's left of its month's show once it's picked; the
 * type the policy allows; the hours; and why.
 */
export function AskPermission({ today, onCancel, onAsked }: {
    /** Today, as the company's calendar has it (found by Codex on PR 131). */
    today: string
    onCancel: () => void
    onAsked: () => void
}) {
    const { t, locale } = useLanguage()
    const { showToast } = useToast()
    const action = useBusyAction()
    const num = digits(locale)
    const [date, setDate] = useState(today)
    const [picked, setPicked] = useState('')
    const [start, setStart] = useState('')
    const [end, setEnd] = useState('')
    const [reason, setReason] = useState('')
    const [errors, setErrors] = useState<Errors>({})
    const { data } = useSWR(date ? `/api/attendance/permissions/balance?date=${date}` : null, fetcher)
    const balance: Balance | undefined = data?.data
    const types = balance?.enabled ? balance.types : []
    // The one picked while the day allows it, else the day's first.
    const type = types.includes(picked) ? picked : types[0] ?? ''

    const limits = !balance ? null : balance.enabled
        ? t('req_limits').replace('{min}', num(balance.minPerRequestMinutes)).replace('{max}', num(balance.maxPerRequestMinutes)).replace('{left}', num(balance.remainingMinutes))
        : t('req_permissions_off_on_day')

    const submit = (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault()
        const form = e.currentTarget
        const found: Errors = {
            date: !date ? t('requests_permission_date_missing') : balance && !balance.enabled ? t('req_permissions_off_on_day') : undefined,
            start: !start ? t('requests_permission_time_missing') : undefined,
            end: !end ? t('requests_permission_time_missing') : undefined,
            reason: !reason.trim() ? t('requests_permission_reason_missing') : undefined,
        }
        setErrors(found)
        if (found.date || found.start || found.end || found.reason) {
            // To the first field that needs fixing, once it's marked: the day's picker is a button.
            requestAnimationFrame(() => form.querySelector<HTMLElement>(found.date ? '.ui-date-trigger' : '[aria-invalid="true"]')?.focus())
            return
        }
        void action.run('ask', async () => {
            try {
                const res = await fetch('/api/attendance/permissions', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ date, type, start, end, reason: reason.trim() }),
                })
                if (!res.ok) {
                    showToast(t(await refusal(res, 'failed_submit_request')), 'error')
                    return
                }
                showToast(t('req_asked'), 'success')
                onAsked()
            } catch {
                showToast(t('error_generic'), 'error')
            }
        })
    }

    return (
        <form className="ui-form" noValidate onSubmit={submit}>
            <DatePickerSingle asField label={t('date_label')} value={date} error={errors.date}
                onChange={day => { setDate(day); setErrors(x => ({ ...x, date: undefined })) }} />
            {limits && <p className="ui-hint" aria-live="polite">{limits}</p>}
            <Field label={t('requests_permission_type')}>{p => (
                <Select {...p} name="type" value={type} disabled={types.length === 0} onChange={e => setPicked(e.target.value)}
                    options={types.map(v => ({ value: v, label: t(PERMISSION_TYPE_LABEL[v] ?? 'audit_value_MIDDAY') }))} />
            )}</Field>
            <Field label={t('req_from')} error={errors.start}>{p => (
                <TextInput {...p} name="start" type="time" autoComplete="off" value={start} onChange={e => { setStart(e.target.value); setErrors(x => ({ ...x, start: undefined })) }} />
            )}</Field>
            <Field label={t('req_to')} error={errors.end}>{p => (
                <TextInput {...p} name="end" type="time" autoComplete="off" value={end} onChange={e => { setEnd(e.target.value); setErrors(x => ({ ...x, end: undefined })) }} />
            )}</Field>
            <Field label={t('reason_label')} hint={t('ui_characters_used').replace('{used}', num(reason.length)).replace('{max}', num(REASON_MAX))} error={errors.reason}>{p => (
                <TextArea {...p} name="reason" dir="auto" placeholder={t('requests_permission_reason_placeholder')} value={reason} maxLength={500}
                    onChange={e => { setReason(e.target.value); setErrors(x => ({ ...x, reason: undefined })) }} />
            )}</Field>
            <DialogActions>
                <Button onClick={onCancel}>{t('cancel')}</Button>
                <Button type="submit" variant="primary" disabled={action.running} busy={action.is('ask')}>{t('send_request')}</Button>
            </DialogActions>
        </form>
    )
}

type ReportErrors = { date?: string; time?: string; reason?: string }

/**
 * Reporting a punch the terminal didn't record: the day, today at the
 * latest, the time, whether in or out if they know, and why. Once approved
 * it's added as a punch, and the day is worked out again.
 */
export function ReportMissingPunch({ today, onCancel, onReported }: {
    /** Today, as the company's calendar has it: the browser's can be a day behind (found by Codex on PR 131). */
    today: string
    onCancel: () => void
    onReported: () => void
}) {
    const { t, locale } = useLanguage()
    const { showToast } = useToast()
    const action = useBusyAction()
    const num = digits(locale)
    const [date, setDate] = useState(today)
    const [time, setTime] = useState('')
    const [direction, setDirection] = useState<'' | 'IN' | 'OUT'>('')
    const [reason, setReason] = useState('')
    const [errors, setErrors] = useState<ReportErrors>({})

    const submit = (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault()
        const form = e.currentTarget
        const found: ReportErrors = {
            date: !date ? t('requests_missing_date_missing') : undefined,
            time: !time ? t('requests_missing_time_missing') : undefined,
            reason: !reason.trim() ? t('requests_missing_reason_missing') : undefined,
        }
        setErrors(found)
        if (found.date || found.time || found.reason) {
            requestAnimationFrame(() => form.querySelector<HTMLElement>(found.date ? '.ui-date-trigger' : '[aria-invalid="true"]')?.focus())
            return
        }
        void action.run('report', async () => {
            try {
                const res = await fetch('/api/attendance/missing-punches', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ at: `${date}T${time}`, direction: direction || null, reason: reason.trim() }),
                })
                if (!res.ok) {
                    showToast(t(await refusal(res, 'failed_submit_request')), 'error')
                    return
                }
                showToast(t('req_reported'), 'success')
                onReported()
            } catch {
                showToast(t('error_generic'), 'error')
            }
        })
    }

    return (
        <form className="ui-form" noValidate onSubmit={submit}>
            <p className="ui-hint">{t('req_missing_hint')}</p>
            <DatePickerSingle asField label={t('date_label')} value={date} maxDate={today} error={errors.date}
                onChange={day => { setDate(day); setErrors(x => ({ ...x, date: undefined })) }} />
            <Field label={t('punch_time')} error={errors.time}>{p => (
                <TextInput {...p} name="time" type="time" autoComplete="off" value={time} onChange={e => { setTime(e.target.value); setErrors(x => ({ ...x, time: undefined })) }} />
            )}</Field>
            <Field label={t('punch_direction')}>{p => (
                <Select {...p} name="direction" value={direction} onChange={e => setDirection(e.target.value as '' | 'IN' | 'OUT')}
                    options={[{ value: '', label: t('punch_direction_unknown') }, { value: 'IN', label: t('punch_in') }, { value: 'OUT', label: t('punch_out') }]} />
            )}</Field>
            <Field label={t('reason_label')} hint={t('ui_characters_used').replace('{used}', num(reason.length)).replace('{max}', num(REASON_MAX))} error={errors.reason}>{p => (
                <TextArea {...p} name="reason" dir="auto" placeholder={t('requests_missing_reason_placeholder')} value={reason} maxLength={500}
                    onChange={e => { setReason(e.target.value); setErrors(x => ({ ...x, reason: undefined })) }} />
            )}</Field>
            <DialogActions>
                <Button onClick={onCancel}>{t('cancel')}</Button>
                <Button type="submit" variant="primary" disabled={action.running} busy={action.is('report')}>{t('send_request')}</Button>
            </DialogActions>
        </form>
    )
}

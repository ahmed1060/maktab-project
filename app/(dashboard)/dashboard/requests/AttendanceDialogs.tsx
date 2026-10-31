'use client'
import { useState } from 'react'
import useSWR from 'swr'
import { fetcher } from '@/lib/swr-fetcher'
import { useLanguage } from '@/context/LanguageContext'
import { useToast } from '@/context/ToastContext'
import { useBusyAction } from '@/lib/useBusyAction'
import type { TranslationKey } from '@/lib/translations'
import type { FeedRow } from '@/lib/requests/kinds'
import DatePickerSingle from '@/components/DatePickerSingle'
import { Button, Dialog, DialogActions, Field, Select, TextArea, TextInput } from '@/components/ui'

/**
 * Permission hours on the one Requests page (UI_PLAN.md §2.3, part 3a):
 * asking for them, rejecting them and withdrawing them, as the Attendance
 * page's Requests tab did.
 */

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
}

const dateLocale = (locale: string) => locale === 'ar' ? 'ar-EG' : 'en-GB'
const digits = (locale: string) => (n: number) => n.toLocaleString(dateLocale(locale))

/** A permission's day, a calendar day: read as such wherever the screen is. */
export function permissionDay(date: string, locale: string) {
    return new Date(`${date}T00:00:00Z`).toLocaleDateString(dateLocale(locale), { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
}

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

/** Approves or rejects somebody's permission hours. Null once done; otherwise what to say. */
export async function decidePermission(request: Pick<FeedRow, 'id'>, approve: boolean, reason: string | null): Promise<TranslationKey | null> {
    try {
        const res = await fetch(`/api/attendance/permissions/${request.id}/decide`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ approve, reason }),
        })
        return res.ok ? null : await refusal(res, 'error_generic')
    } catch {
        return 'error_generic'
    }
}

/** Rejecting permission hours, with a reason if there is one. */
export function RejectPermission({ request, onClose, onDecided }: { request: FeedRow; onClose: () => void; onDecided: () => void }) {
    const { t, locale } = useLanguage()
    const { showToast } = useToast()
    const action = useBusyAction()
    const num = digits(locale)
    const [reason, setReason] = useState('')

    const reject = () => void action.run('decide', async () => {
        // The schema takes an empty reason as none given.
        const refused = await decidePermission(request, false, reason.trim() || null)
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
            <p>{t('requests_permission_reject_question').replace('{name}', request.who.name).replace('{date}', permissionDay(request.permission!.date, locale))}</p>
            <Field label={t('rejection_reason_label')} hint={t('ui_characters_used').replace('{used}', num(reason.length)).replace('{max}', num(REASON_MAX))}>{p => (
                <TextArea {...p} name="rejection-reason" dir="auto" placeholder={t('requests_permission_reject_placeholder')} value={reason} onChange={e => setReason(e.target.value)} maxLength={500} />
            )}</Field>
        </Dialog>
    )
}

/** Withdrawing one's own permission hours: its minutes go back to the month's. */
export function WithdrawPermission({ request, onClose, onWithdrawn }: { request: FeedRow; onClose: () => void; onWithdrawn: () => void }) {
    const { t } = useLanguage()
    const { showToast } = useToast()
    const action = useBusyAction()

    const withdraw = () => void action.run('withdraw', async () => {
        try {
            const res = await fetch(`/api/attendance/permissions/${request.id}`, { method: 'DELETE' })
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
            <p>{t('req_withdraw_hint')}</p>
        </Dialog>
    )
}

/** Today, as the calendar day the picker takes. */
function today() {
    const d = new Date()
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** The chosen day's rules and what's left of its month's (GET /api/attendance/permissions/balance). */
type Balance = { enabled: boolean; types: string[]; remainingMinutes: number; minPerRequestMinutes: number; maxPerRequestMinutes: number }

type Errors = { date?: string; start?: string; end?: string; reason?: string }

/**
 * Asking for permission hours: the day, under the policy in force that day,
 * whose limits and what's left of its month's show once it's picked; the
 * type the policy allows; the hours; and why.
 */
export function AskPermission({ onCancel, onAsked }: { onCancel: () => void; onAsked: () => void }) {
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

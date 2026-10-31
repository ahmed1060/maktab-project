'use client'
import { useState } from 'react'
import { useLanguage } from '@/context/LanguageContext'
import { useToast } from '@/context/ToastContext'
import { useBusyAction } from '@/lib/useBusyAction'
import { countOf } from '@/lib/plural'
import { workDays } from '@/lib/day-off-range'
import { ASKED_DAY_OFF_TYPES, DAY_OFF_TYPE_LABEL, type AskedDayOffType } from '@/lib/day-off-types'
import type { TranslationKey } from '@/lib/translations'
import type { FeedRow } from '@/lib/requests/kinds'
import DateRangePicker from '@/components/DateRangePicker'
import DatePickerSingle from '@/components/DatePickerSingle'
import { Button, Choice, Dialog, DialogActions, Field, Select, TextArea, TextInput } from '@/components/ui'

/**
 * Day off on the one Requests page (UI_PLAN.md §2.3, part 2c): deciding a
 * request, and asking for one, as the Day off page did.
 */

/** The server's own checks (lib/validations/day-off.schema.ts). */
const REASON_MAX = 100
const REJECTION_MAX = 300

/** Why the server refused a day off, by its code (lib/api-errors.ts), in the person's language. */
const REFUSED: Record<string, TranslationKey> = {
    DATE_IN_PAST: 'requests_day_off_passed',
    OVERLAPPING_REQUEST: 'requests_day_off_overlap',
}

const digits = (locale: string) => (n: number) => n.toLocaleString(locale === 'ar' ? 'ar-EG' : 'en-GB')

/**
 * Approving a day off, with the days to take and whether from the asker's
 * balance or their salary, or rejecting it, with a reason if there is one.
 * When the balance can't cover the days, they come out of the salary,
 * whatever was picked.
 */
export function DecideDayOff({ request, decision, onClose, onDecided }: {
    request: FeedRow
    decision: 'APPROVED' | 'REJECTED'
    onClose: () => void
    onDecided: () => void
}) {
    const { t, locale } = useLanguage()
    const { showToast } = useToast()
    const action = useBusyAction()
    const num = digits(locale)
    const facts = request.dayOff!
    const credit = facts.credit ?? 0
    const [days, setDays] = useState(String(workDays(facts.from, facts.to)))
    const [chosen, setChosen] = useState<'CREDIT' | 'SALARY'>('CREDIT')
    const [reason, setReason] = useState('')
    const [daysError, setDaysError] = useState<string>()
    const asked = parseFloat(days)
    // Derived each time rather than written back, so CREDIT is never sent for a pass.
    const creditShort = (Number.isFinite(asked) ? asked : 0) > credit
    const from = creditShort ? 'SALARY' : chosen
    const approving = decision === 'APPROVED'

    const decide = () => {
        if (approving && !(Number.isFinite(asked) && asked >= 0)) {
            setDaysError(t('requests_day_off_days_invalid'))
            return
        }
        void action.run('decide', async () => {
            try {
                const res = await fetch(`/api/admin/day-off-requests/${request.id}`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(approving
                        ? { status: 'APPROVED', daysToDeduct: asked, deductionType: from }
                        // The schema takes an empty reason as none given.
                        : { status: 'REJECTED', rejectionReason: reason.trim() }),
                })
                if (!res.ok) {
                    showToast(t('error_generic'), 'error')
                    return
                }
                showToast(t('request_action_success'), 'success')
                onDecided()
            } catch {
                showToast(t('error_generic'), 'error')
            }
        })
    }

    return (
        <Dialog
            open
            onClose={onClose}
            title={t(approving ? 'approve_deduction_title' : 'confirm_rejection_title')}
            actions={<>
                <Button onClick={onClose}>{t('cancel')}</Button>
                <Button variant={approving ? 'primary' : 'danger'} onClick={decide} disabled={action.running} busy={action.is('decide')}>
                    {t(approving ? 'approve_button' : 'reject_button')}
                </Button>
            </>}
        >
            {approving ? (
                <>
                    <p>{t('approve_dayoff_balance').replace('{name}', request.who.name).replace('{days}', countOf(t, locale, credit, 'days'))}</p>
                    <Field label={t('days_to_deduct_label')} error={daysError}>{p => (
                        <TextInput {...p} type="number" autoComplete="off" inputMode="decimal" min="0" step="0.5" value={days}
                            onChange={e => { setDays(e.target.value); setDaysError(undefined) }} />
                    )}</Field>
                    <Choice
                        legend={t('deduct_from_label')}
                        name="deduct-from"
                        value={from}
                        onChange={setChosen}
                        options={[
                            { value: 'CREDIT', label: t('deduct_from_credit'), disabled: creditShort },
                            { value: 'SALARY', label: t('deduct_from_salary') },
                        ]}
                        warning={creditShort ? t('insufficient_credit') : undefined}
                    />
                </>
            ) : (
                <>
                    <p>{t('reject_dayoff_question').replace('{name}', request.who.name)}</p>
                    <Field label={t('rejection_reason_label')} hint={t('ui_characters_used').replace('{used}', num(reason.length)).replace('{max}', num(REJECTION_MAX))}>{p => (
                        <TextArea {...p} dir="auto" placeholder={t('rejection_reason_placeholder')} value={reason} onChange={e => setReason(e.target.value)} maxLength={300} />
                    )}</Field>
                </>
            )}
        </Dialog>
    )
}

/** Today, as the calendar day the pickers take: no day before it can be asked for. */
function today() {
    const d = new Date()
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/**
 * Asking for a day off: its type, the day or days, and why. A regular day
 * off may run over several days; the others are one day each.
 */
export function AskDayOff({ onCancel, onAsked }: { onCancel: () => void; onAsked: () => void }) {
    const { t, locale } = useLanguage()
    const { showToast } = useToast()
    const action = useBusyAction()
    const num = digits(locale)
    const [type, setType] = useState<AskedDayOffType>('REGULAR')
    const [from, setFrom] = useState('')
    const [to, setTo] = useState('')
    const [reason, setReason] = useState('')
    const [dateError, setDateError] = useState<string>()
    const regular = type === 'REGULAR'

    const submit = (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault()
        const form = e.currentTarget
        if (!from) {
            setDateError(t('requests_day_off_date_missing'))
            // To the picker, once its error is under it.
            requestAnimationFrame(() => form.querySelector<HTMLElement>('.ui-date-trigger')?.focus())
            return
        }
        void action.run('ask', async () => {
            try {
                const res = await fetch('/api/day-off-requests', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    // A one-day type has no end; undefined leaves it out of the body.
                    body: JSON.stringify({ date: from, endDate: regular && to ? to : undefined, type, reason: reason.trim() || undefined }),
                })
                if (!res.ok) {
                    const body = await res.json().catch(() => ({}))
                    showToast(t(REFUSED[body.code] ?? 'failed_submit_request'), 'error')
                    return
                }
                showToast(t('request_submitted_success'), 'success')
                onAsked()
            } catch {
                showToast(t('error_generic'), 'error')
            }
        })
    }

    return (
        <form className="ui-form" noValidate onSubmit={submit}>
            <Field label={t('day_off_type')}>{p => (
                <Select {...p} value={type} onChange={e => { setType(e.target.value as AskedDayOffType); setFrom(''); setTo(''); setDateError(undefined) }}
                    options={ASKED_DAY_OFF_TYPES.map(v => ({ value: v, label: t(DAY_OFF_TYPE_LABEL[v]) }))} />
            )}</Field>
            {regular
                ? <DateRangePicker asField label={t('dates_label')} dateFrom={from} dateTo={to} minDate={today()} error={dateError}
                    onChange={(start, end) => { setFrom(start); setTo(end); setDateError(undefined) }} />
                : <DatePickerSingle asField label={t('date_label')} value={from} minDate={today()} error={dateError}
                    onChange={day => { setFrom(day); setTo(day); setDateError(undefined) }} />}
            <Field label={t('reason_label')} hint={t('ui_characters_used').replace('{used}', num(reason.length)).replace('{max}', num(REASON_MAX))}>{p => (
                <TextArea {...p} dir="auto" placeholder={t('reason_placeholder')} value={reason} onChange={e => setReason(e.target.value)} maxLength={100} />
            )}</Field>
            <DialogActions>
                <Button onClick={onCancel}>{t('cancel')}</Button>
                <Button type="submit" variant="primary" disabled={action.running} busy={action.is('ask')}>{t('send_request')}</Button>
            </DialogActions>
        </form>
    )
}

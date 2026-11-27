'use client'

import { useState } from 'react'
import { useLanguage } from '@/context/LanguageContext'
import { useToast } from '@/context/ToastContext'
import DatePickerSingle from '@/components/DatePickerSingle'
import { Button, Dialog } from '@/components/ui'
import { addDays } from '@/lib/attendance/calendar'
import { useBusyAction } from '@/lib/useBusyAction'
import type { TranslationKey } from '@/lib/translations'

/**
 * Change this month's payday (LATER_CHANGES_PLAN.md §7.10, 10f, PR 430;
 * DESIGN.md §5.5, Payday and when payroll closes): a one-off, such as paying
 * before Eid. While the month is a draft, its attendance may end sooner, the
 * day before the new payday unless changed; the days after go to next
 * month's payroll. Once approved, only payday changes.
 */

/** What the server's refusal says, in the page's language, under the field it's about. */
export const PAYDAY_REFUSAL: Record<string, { key: TranslationKey; field: 'payday' | 'until' }> = {
    PAYDAY_NOT_AFTER_PERIOD: { key: 'payday_change_not_after', field: 'payday' },
    PAYDAY_TOO_LATE: { key: 'payday_change_too_late', field: 'payday' },
    ATTENDANCE_OUT_OF_RANGE: { key: 'payday_change_until_range', field: 'until' },
    PERIOD_FROZEN: { key: 'payday_change_frozen', field: 'until' },
    RUN_PAID: { key: 'payday_change_paid', field: 'payday' },
}

/** Each field's control, by its name: where a refusal said under it takes the focus. */
const FIELD_NAME = { payday: 'payday', until: 'attendanceUntil' } as const

/** The attendance's last day to start with: the day before the new payday where that's before the close, otherwise the close. */
export function attendanceUntilFor(payday: string, close: string): string {
    return payday <= close ? addDays(payday, -1) : close
}

export function ChangePaydayDialog({ open, onClose, onDone, year, month, companyId, payday, draft, period, close }: {
    open: boolean
    onClose: () => void
    onDone: () => void
    year: number
    month: number
    companyId: string | null
    /** The month's payday now. */
    payday: string
    /** Whether the month is still a draft, so its attendance can end sooner. */
    draft: boolean
    /** Its attendance period now. */
    period: { from: string; to: string }
    /** When payroll closes by the settings: the latest its attendance can end. */
    close: string
}) {
    const { t } = useLanguage()
    const { showToast } = useToast()
    const action = useBusyAction()
    const [day, setDay] = useState(payday)
    const [until, setUntil] = useState(period.to)
    const [errors, setErrors] = useState<{ payday?: string; until?: string }>({})

    // A new payday brings the attendance's last day with it, as long as it's a draft.
    const pickPayday = (next: string) => {
        setDay(next)
        if (draft) setUntil(attendanceUntilFor(next, close))
        setErrors({})
    }

    const save = async () => {
        const res = await fetch(`/api/payroll/${year}/${month}/payday`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ companyId: companyId || undefined, payday: day, ...(draft ? { attendanceUntil: until } : {}) }),
        }).catch(() => null)
        const body = await res?.json().catch(() => null)
        if (res?.ok) {
            showToast(t('payday_changed'), 'success')
            onDone()
            return
        }
        const why = PAYDAY_REFUSAL[body?.code ?? body?.details?.code]
        if (!why) {
            showToast(body?.error || t('error_generic'), 'error')
            return
        }
        setErrors({ [why.field]: t(why.key) })
        // As a form's first wrong field is: the focus goes where the refusal is said.
        requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-dialog] button[name="${FIELD_NAME[why.field]}"]`)?.focus())
    }

    return (
        <Dialog
            open={open}
            onClose={() => { if (!action.running) onClose() }}
            title={t('payday_change_title')}
            actions={<>
                <Button variant="quiet" onClick={onClose} disabled={action.running}>{t('cancel')}</Button>
                <Button variant="primary" busy={action.is('payday')} disabled={action.running} onClick={() => action.run('payday', save)}>{t('payday_change')}</Button>
            </>}
        >
            <DatePickerSingle name="payday" label={t('payroll_day_label')} value={day} minDate={period.from} onChange={pickPayday} error={errors.payday} disabled={action.running} />
            {draft && (
                <DatePickerSingle name="attendanceUntil" label={t('payday_change_until')} value={until} minDate={period.from} maxDate={close}
                    onChange={next => { setUntil(next); setErrors({}) }} error={errors.until} disabled={action.running} />
            )}
            <p className="ui-hint">{t(draft ? 'payday_change_hint' : 'payday_change_hint_approved')}</p>
        </Dialog>
    )
}

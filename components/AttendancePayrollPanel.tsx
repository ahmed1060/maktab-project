'use client'

import { useRef, useState, type FormEvent } from 'react'
import useSWR from 'swr'
import { WarningCircleIcon } from '@phosphor-icons/react/ssr'
import { fetcher, type SWRError } from '@/lib/swr-fetcher'
import { useLanguage } from '@/context/LanguageContext'
import { useToast } from '@/context/ToastContext'
import { apiErrorText } from '@/lib/api-error-text'
import type { TranslationKey } from '@/lib/translations'
import { Button, Card, Dialog, EmptyState, Field, TextInput } from '@/components/ui'
import { focusFirstWrong } from '@/components/attendance-calendar/focus'

/**
 * Whether attendance reaches payroll, and from which month (ATTENDANCE_PLAN.md
 * §12, §20 Phase 1). Until a month is chosen, attendance is measured and
 * priced, and the payroll register shows what it would cost, but nobody's pay
 * changes — the dry run. The month can be set only after the last approved
 * payroll, so no month already paid changes sides.
 *
 * On the building blocks (UI_PLAN.md §5 step 5, company settings part 3c).
 */

/** What's wrong with the month typed, or null: it's needed, and can't come before the earliest. */
export function monthError(month: string, earliest: string | null): TranslationKey | null {
    if (!month) return 'attpay_month_required'
    if (earliest && month < earliest) return 'attpay_month_too_early'
    return null
}

export default function AttendancePayrollPanel({ companyId, readOnly }: { companyId: string; readOnly: boolean }) {
    const { t, locale } = useLanguage()
    const { showToast } = useToast()
    const { data: body, error, isValidating, mutate } = useSWR(`/api/attendance/payroll-from?companyId=${companyId}`, fetcher)
    const data: { from: string | null; earliest: string | null } | undefined = body?.data
    const [month, setMonth] = useState('')
    const [wrong, setWrong] = useState<TranslationKey | null>(null)
    // The month to start from, or null to stop; undefined while nothing is asked.
    const [confirming, setConfirming] = useState<string | null | undefined>(undefined)
    const [busy, setBusy] = useState(false)
    const formRef = useRef<HTMLFormElement>(null)

    if (error && ((error as SWRError).status === 403 || (error as SWRError).status === 404)) return null
    if (error) return (
        <div className="ui-panel">
            <EmptyState icon={WarningCircleIcon} title={t('attpay_load_failed')} detail={(error as SWRError).info?.error}
                action={<Button busy={isValidating} onClick={() => { void mutate() }}>{t('try_again')}</Button>} />
        </div>
    )
    if (!data) return null
    const monthText = (m: string) => new Date(`${m}-01T00:00:00Z`).toLocaleDateString(locale === 'ar' ? 'ar-EG' : 'en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' })

    const ask = (e: FormEvent) => {
        e.preventDefault()
        const found = monthError(month, data.earliest)
        setWrong(found)
        if (found) { focusFirstWrong(formRef.current); return }
        setConfirming(month)
    }

    /** Saves the choice; the dialog stays open, its button busy, until it's done. */
    const save = async (from: string | null) => {
        setBusy(true)
        try {
            const res = await fetch('/api/attendance/payroll-from', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ companyId, from }) })
            if (!res.ok) {
                showToast(apiErrorText(await res.text(), t('error_generic')), 'error')
                return
            }
            showToast(t('attpay_saved'), 'success')
            setMonth('')
            setConfirming(undefined)
            await mutate()
        } catch {
            showToast(t('error_generic'), 'error')
        } finally {
            setBusy(false)
        }
    }

    return (
        <Card title={t('attpay_title')}>
            <p>{data.from ? t('attpay_on').replace('{month}', monthText(data.from)) : t('attpay_off')}</p>
            <p className="ui-card-note">{t('attpay_hint')}</p>
            {!readOnly && (
                <form ref={formRef} className="ui-card-form" noValidate onSubmit={ask}>
                    <Field
                        label={t('attpay_from')}
                        hint={data.earliest ? t('attpay_earliest').replace('{month}', monthText(data.earliest)) : undefined}
                        error={wrong ? t(wrong).replace('{month}', data.earliest ? monthText(data.earliest) : '') : undefined}
                    >{p => (
                        <TextInput {...p} type="month" name="from" autoComplete="off" value={month} min={data.earliest ?? undefined}
                            onChange={e => { setMonth(e.target.value); setWrong(null) }} />
                    )}</Field>
                    <div className="ui-form-actions">
                        <Button type="submit" variant="primary" disabled={busy}>{t('attpay_set')}</Button>
                        {data.from && <Button disabled={busy} onClick={() => setConfirming(null)}>{t('attpay_stop')}</Button>}
                    </div>
                </form>
            )}

            {/* Pay changes from the month chosen, or stops changing: asked about first. */}
            <Dialog
                open={confirming !== undefined}
                onClose={() => { if (!busy) setConfirming(undefined) }}
                title={confirming ? t('attpay_confirm_on_title').replace('{month}', monthText(confirming)) : t('attpay_confirm_off_title')}
                actions={<>
                    <Button onClick={() => setConfirming(undefined)} disabled={busy}>{t('cancel')}</Button>
                    <Button variant={confirming ? 'danger' : 'primary'} busy={busy} onClick={() => { void save(confirming ?? null) }}>
                        {confirming ? t('attpay_set') : t('attpay_stop')}
                    </Button>
                </>}
            >
                <p>{confirming ? t('attpay_confirm_on').replace('{month}', monthText(confirming)) : t('attpay_confirm_off')}</p>
            </Dialog>
        </Card>
    )
}

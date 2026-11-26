'use client'
import { useState, type FormEvent } from 'react'
import { useLanguage } from '@/context/LanguageContext'
import { useToast } from '@/context/ToastContext'
import DatePickerSingle from '@/components/DatePickerSingle'
import { Button, Dialog, DialogActions } from '@/components/ui'
import { apiErrorText } from '@/lib/api-error-text'
import { contractStartRange, contractStartRefusal } from '@/lib/contract-start'
import { dayLabel } from '@/lib/end-contract'

/** A text with {name} in it, the name kept whole in either direction. */
function Named({ text, name }: { text: string; name: string }) {
    const [before, after] = text.split('{name}')
    return <>{before}<bdi>{name}</bdi>{after}</>
}

/**
 * Changing when someone's contract started (LATER_CHANGES_PLAN.md §7.2,
 * PR 425): the building blocks' dialog, as a form, under their name, with
 * the date, from a year back to a year ahead. What's wrong is said under
 * the date, in the reader's language; anything else above the buttons.
 */
export function ContractStartDialog({ userId, name, current, today, onClose, onDone }: {
    userId: string
    name: string
    /** The date it starts on now. */
    current: string
    /** Today in the company's calendar. */
    today: string
    onClose: () => void
    onDone: (date: string) => void
}) {
    const { t, locale } = useLanguage()
    const { showToast } = useToast()
    const [date, setDate] = useState(current)
    const [dateError, setDateError] = useState<string | null>(null)
    const [error, setError] = useState<string | null>(null)
    const [busy, setBusy] = useState(false)
    const { min, max } = contractStartRange(today)

    const submit = async (e: FormEvent) => {
        e.preventDefault()
        if (busy) return
        if (!date) return setDateError(t('contract_start_needed'))
        if (date === current) return setDateError(t('contract_start_same'))
        setBusy(true)
        setError(null)
        try {
            const res = await fetch(`/api/users/${encodeURIComponent(userId)}/contract-start`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ date }),
            })
            const text = await res.text()
            let body: { success?: boolean; code?: string } | null = null
            try { body = JSON.parse(text) } catch { body = null }
            if (res.ok && body?.success) {
                showToast(t('contract_start_changed').replace('{date}', dayLabel(date, locale)), 'success')
                onDone(date)
                return
            }
            const refused = contractStartRefusal(body?.code)
            if (refused) setDateError(t(refused))
            else setError(apiErrorText(text, t('error_generic')))
        } catch {
            setError(t('error_generic'))
        } finally {
            setBusy(false)
        }
    }

    const cancel = () => { if (!busy) onClose() }

    return (
        <Dialog open onClose={cancel} title={<Named text={t('contract_start_title')} name={name} />}>
            <form className="ui-form" noValidate onSubmit={submit}>
                <DatePickerSingle name="contractStart" label={t('contract_start_label')} hint={t('contract_start_dialog_hint')} error={dateError ?? undefined}
                    value={date} minDate={min} maxDate={max} disabled={busy}
                    onChange={day => { setDate(day); setDateError(null); setError(null) }} />
                {error && <p className="ui-error" role="alert">{error}</p>}
                <DialogActions>
                    <Button onClick={cancel} disabled={busy}>{t('cancel')}</Button>
                    <Button type="submit" variant="primary" busy={busy}>{t('contract_start_confirm')}</Button>
                </DialogActions>
            </form>
        </Dialog>
    )
}

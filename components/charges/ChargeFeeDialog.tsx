'use client'

import { useId, useState } from 'react'
import { useLanguage } from '@/context/LanguageContext'
import { useToast } from '@/context/ToastContext'
import { Button, Details, Dialog, Field, TextInput } from '@/components/ui'
import { feeFor, totalFor } from '@/lib/charges'
import { useAdjustOnChange } from '@/lib/useAdjustOnChange'
import type { ChargeRow } from './types'

/**
 * A charge's service fee (CLIENTS_PLAN.md §6.3): Paid | Service fee | Total.
 * Typing the fee works out the total, and typing the total works out the
 * fee. The server works the total out itself, from the fee.
 */
export default function ChargeFeeDialog({ charge, onClose, onSaved }: {
    charge: ChargeRow | null
    onClose: () => void
    onSaved: () => void
}) {
    const { t, locale } = useLanguage()
    const { showToast } = useToast()
    const [fee, setFee] = useState('')
    const [total, setTotal] = useState('')
    // Which one was typed last, and is sent: the other is worked out.
    const [typed, setTyped] = useState<'fee' | 'total'>('fee')
    const [saving, setSaving] = useState(false)
    const formId = useId()

    const paid = charge?.amount ?? 0
    useAdjustOnChange([charge?.id], () => {
        setFee(charge ? String(charge.serviceFee) : '')
        setTotal(charge ? (paid + charge.serviceFee).toFixed(2) : '')
        setTyped('fee')
    })

    const feeValue = fee.trim() === '' ? NaN : Number(fee)
    const totalValue = total.trim() === '' ? NaN : Number(total)
    const feeError = typed === 'fee' && fee.trim() !== '' && totalFor(paid, feeValue) === null
    const totalError = typed === 'total' && total.trim() !== '' && feeFor(paid, totalValue) === null
    const ready = typed === 'fee' ? totalFor(paid, feeValue) !== null : feeFor(paid, totalValue) !== null

    const onFee = (value: string) => {
        setFee(value)
        setTyped('fee')
        const worked = totalFor(paid, value.trim() === '' ? NaN : Number(value))
        if (worked !== null) setTotal(worked.toFixed(2))
    }
    const onTotal = (value: string) => {
        setTotal(value)
        setTyped('total')
        const worked = feeFor(paid, value.trim() === '' ? NaN : Number(value))
        if (worked !== null) setFee(String(worked))
    }

    const save = async (e?: { preventDefault: () => void }) => {
        e?.preventDefault()
        if (!charge || !ready || saving) return
        setSaving(true)
        try {
            const res = await fetch(`/api/charges/${encodeURIComponent(charge.id)}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(typed === 'fee' ? { serviceFee: feeValue } : { total: totalValue }),
            })
            const answer = await res.json().catch(() => null)
            if (!res.ok) {
                showToast(answer?.error || t('error_generic'), 'error')
                return
            }
            showToast(t('charges_fee_saved'), 'success')
            onSaved()
            onClose()
        } catch {
            showToast(t('error_generic'), 'error')
        } finally {
            setSaving(false)
        }
    }

    const money = (n: number) => `${n.toLocaleString(locale === 'ar' ? 'ar-EG' : 'en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${t('egp')}`

    return (
        <Dialog
            open={!!charge}
            onClose={() => { if (!saving) onClose() }}
            title={t('charges_fee_title').replace('{name}', charge?.description || t('no_description'))}
            actions={<>
                <Button onClick={onClose} disabled={saving}>{t('cancel')}</Button>
                <Button type="submit" form={formId} variant="primary" busy={saving} disabled={!ready}>{t('save')}</Button>
            </>}
        >
            <form id={formId} onSubmit={save} className="ui-dialog-body" noValidate>
                <p className="ui-hint">{t('charges_fee_hint')}</p>
                <Details items={[{ label: t('charges_fee_paid'), value: <span className="ui-num">{money(paid)}</span> }]} />
                <Field label={t('charges_col_fee')} error={feeError ? t('charges_fee_invalid_fee') : undefined}>{p => (
                    <TextInput {...p} name="serviceFee" autoComplete="off" type="number" inputMode="decimal" min={0} step="0.01" value={fee} onChange={e => onFee(e.target.value)} />
                )}</Field>
                <Field label={t('charges_col_total')} error={totalError ? t('charges_fee_invalid_total') : undefined}>{p => (
                    <TextInput {...p} name="total" autoComplete="off" type="number" inputMode="decimal" min={paid} step="0.01" value={total} onChange={e => onTotal(e.target.value)} />
                )}</Field>
            </form>
        </Dialog>
    )
}

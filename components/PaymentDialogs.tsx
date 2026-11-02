'use client'

import { useRef, useState, type FormEvent } from 'react'
import { CurrencyDollarIcon } from '@phosphor-icons/react/ssr'
import { refusalOf } from '@/components/CompanyRolesCard'
import { focusFirstWrong } from '@/components/attendance-calendar/focus'
import { Button, Dialog, DialogActions, Field, Select, TextInput } from '@/components/ui'
import { useLanguage } from '@/context/LanguageContext'
import { useToast } from '@/context/ToastContext'
import { periodIfPaid, SUBSCRIPTION_TYPES, type SubscriptionType } from '@/lib/billing/period'
import { amountError, platformMoney, typedAmount } from '@/lib/subscription-display'
import type { TranslationKey } from '@/lib/translations'

/**
 * Adding a company's payment, and asking before one is marked paid (the
 * Super Admin's pages part 3b, UI_PLAN.md §5 step 5): the building blocks'
 * dialog, each field labelled, what's wrong said under its field. Each stays
 * open, its button busy, until the server has answered.
 */

export type Payment = {
    id: string
    cost: number
    subscriptionType: SubscriptionType
    status: 'PAID' | 'UNPAID'
    paidAt: string | null
    startDate: string | null
    endDate: string | null
    createdAt: string
}

/** What a payment pays for, keyed by the stored value, so a fourth type is a line here. */
export const PERIOD_LABEL_KEY: Record<SubscriptionType, TranslationKey> = {
    MONTHLY: 'payments_month',
    ANNUALLY: 'payments_year',
    LIFETIME: 'payments_lifetime',
}

type T = (key: TranslationKey) => string

/** A payment named by its amount, "the payment of $50.00", for its menu, its buttons and its dialogs. */
export function namedPayment(t: T, locale: string, payment: Pick<Payment, 'cost'>): string {
    return t('payments_the_payment').replace('{amount}', platformMoney(payment.cost, locale))
}

/** A date as the payments say it: "2 Nov 2026". */
export function paymentDay(date: string | Date, locale: string): string {
    return new Date(date).toLocaleDateString(locale === 'ar' ? 'ar-EG' : 'en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

const AMOUNT_ERROR: Record<'missing' | 'wrong' | 'places', TranslationKey> = {
    missing: 'payments_amount_required',
    wrong: 'payments_amount_wrong',
    places: 'amount_two_places',
}

export function AddPaymentDialog({ companyId, onClose, onAdded }: {
    companyId: string
    onClose: () => void
    onAdded: () => void
}) {
    const { t } = useLanguage()
    const { showToast } = useToast()
    const formRef = useRef<HTMLFormElement>(null)
    const [type, setType] = useState<SubscriptionType>('MONTHLY')
    const [cost, setCost] = useState('')
    const [wrong, setWrong] = useState<TranslationKey | null>(null)
    const [busy, setBusy] = useState(false)

    const add = async (e: FormEvent) => {
        e.preventDefault()
        const found = amountError(cost, { zero: false })
        setWrong(found && AMOUNT_ERROR[found])
        if (found) { focusFirstWrong(formRef.current); return }
        setBusy(true)
        try {
            const res = await fetch(`/api/companies/${encodeURIComponent(companyId)}/payments`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ cost: typedAmount(cost), subscriptionType: type }),
            })
            if (!res.ok) return showToast(await refusalOf(res, t('error_generic')), 'error')
            showToast(t('payments_added'), 'success')
            onAdded()
        } catch {
            showToast(t('error_generic'), 'error')
        } finally {
            setBusy(false)
        }
    }

    return (
        <Dialog open onClose={() => { if (!busy) onClose() }} title={t('payments_add')}>
            <form ref={formRef} className="ui-form" noValidate onSubmit={add}>
                <Field label={t('payments_type_label')} hint={t('payments_add_hint')}>{p => (
                    <Select {...p} name="subscriptionType" value={type} onChange={e => setType(e.target.value as SubscriptionType)}
                        options={SUBSCRIPTION_TYPES.map(value => ({ value, label: t(PERIOD_LABEL_KEY[value]) }))} />
                )}</Field>
                <Field label={t('payments_amount')} error={wrong && t(wrong)}>{p => (
                    <TextInput {...p} icon={CurrencyDollarIcon} inputMode="decimal" autoComplete="off" name="cost"
                        value={cost} onChange={e => { setCost(e.target.value); setWrong(null) }} />
                )}</Field>
                <DialogActions>
                    <Button onClick={onClose} disabled={busy}>{t('cancel')}</Button>
                    <Button type="submit" variant="primary" busy={busy}>{t('payments_add_submit')}</Button>
                </DialogActions>
            </form>
        </Dialog>
    )
}

/**
 * Marking a payment paid starts the period it pays for, and a paid payment
 * can't be deleted after: it's asked first, saying the period, worked out as
 * the server will (lib/billing/period.ts). The old page did it on one click.
 */
export function MarkPaidDialog({ payment, payments, busy, onCancel, onConfirm }: {
    payment: Payment
    /** The company's payments, for the period this one would carry on from. */
    payments: Payment[]
    busy: boolean
    onCancel: () => void
    onConfirm: () => void
}) {
    const { t, locale } = useLanguage()
    const paid = payments.filter(p => p.status === 'PAID' && p.id !== payment.id)
    const { start, end } = periodIfPaid(paid, payment.subscriptionType, new Date())
    const from = paymentDay(start, locale)
    const covers = end
        ? t('payments_mark_period').replace('{from}', from).replace('{to}', paymentDay(end, locale))
        : t('payments_mark_lifetime').replace('{from}', from)
    return (
        <Dialog
            open
            onClose={() => { if (!busy) onCancel() }}
            title={t('payments_mark_title').replace('{name}', namedPayment(t, locale, payment))}
            actions={<>
                <Button onClick={onCancel} disabled={busy}>{t('cancel')}</Button>
                <Button variant="primary" busy={busy} onClick={onConfirm}>{t('mark_as_paid')}</Button>
            </>}
        >
            <p>{covers}</p>
            <p>{t('payments_mark_final')}</p>
        </Dialog>
    )
}

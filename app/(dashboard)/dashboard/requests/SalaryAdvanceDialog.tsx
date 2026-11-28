'use client'
import { useState } from 'react'
import useSWR from 'swr'
import { fetcher } from '@/lib/swr-fetcher'
import { useLanguage } from '@/context/LanguageContext'
import { useToast } from '@/context/ToastContext'
import { useBusyAction } from '@/lib/useBusyAction'
import { countOf } from '@/lib/plural'
import { percentOf } from '@/lib/payroll-deductions'
import { closedText, payrollMonthName } from '@/lib/salary-advance-words'
import {
    advanceCheck, consentWords, installmentLimit, installmentsOf, leastMonths, moneyText, mostPayable, payrollMonthKey, payrollMonthOfKey,
    type AdvanceCheck, type AdvanceDraft, type AdvanceOffer,
} from '@/lib/salary-advance'
import { Button, Choice, DialogActions, Field, TextInput } from '@/components/ui'

/**
 * Asking for a salary advance on the one Requests page (LATER_CHANGES_PLAN.md
 * §7.5, step 3a, PR 449; DESIGN.md §5.5, Asking for a salary advance): what
 * may be asked for, as the server works it out; the amount, the months and
 * the first installment, each checked by the rules the server checks again
 * by (lib/salary-advance.ts); each month's installment; and the consent the
 * law asks for in writing.
 */

/** The fields' order, for the first that needs fixing. */
const FIELDS: (keyof AdvanceDraft)[] = ['amount', 'months', 'first']

export function AskSalaryAdvance({ onCancel, onAsked }: { onCancel: () => void; onAsked: () => void }) {
    const { t, locale } = useLanguage()
    const { showToast } = useToast()
    const action = useBusyAction()
    const { data, error, isLoading, mutate } = useSWR('/api/salary-advances', fetcher)
    const offer: AdvanceOffer | null | undefined = data?.data?.offer
    const [amount, setAmount] = useState('')
    const [months, setMonths] = useState('')
    // Next month's unless changed, while there's a choice.
    const [picked, setPicked] = useState<string | null>(null)
    const [errors, setErrors] = useState<AdvanceCheck['errors']>({})
    const [changed, setChanged] = useState(false)

    const num = (n: number) => n.toLocaleString(locale === 'ar' ? 'ar-EG' : 'en-GB', { maximumFractionDigits: 2 })
    const money = (minor: number) => moneyText(minor, locale)

    if (isLoading) return <p className="ui-hint" role="status">{t('loading')}</p>
    if (error || !data?.data) return (
        <>
            <p className="ui-error" role="alert">{t('salary_advance_offer_failed')}</p>
            <DialogActions>
                <Button onClick={onCancel}>{t('close')}</Button>
                <Button variant="primary" onClick={() => void mutate()}>{t('try_again')}</Button>
            </DialogActions>
        </>
    )
    if (!offer || offer.closed) return (
        <>
            <p className="ui-prose">{offer?.closed ? closedText(t, locale, offer.closed) : t('salary_advance_not_offered')}</p>
            <DialogActions><Button onClick={onCancel}>{t('close')}</Button></DialogActions>
        </>
    )

    const firstKeys = offer.firsts.map(payrollMonthKey)
    const first = picked && firstKeys.includes(picked) ? picked : firstKeys[firstKeys.length - 1]
    const draft: AdvanceDraft = { amount, months, first }
    const check = advanceCheck(draft, offer)
    const limit = installmentLimit(offer)
    const least = check.amountMinor > 0 ? leastMonths(check.amountMinor, limit.capMinor) : null
    const installmentCap = percentOf(offer.netMinor, offer.installmentPercent)
    const debtsCap = percentOf(offer.netMinor, offer.debtsPercent)

    const amountHint = t('salary_advance_amount_hint').replace('{amount}', money(offer.maxAmountMinor)).replace('{salary}', countOf(t, locale, offer.maxMonths, 'months_salary'))
    // Which limit decides the least, while the amount is right; with Warn, which limit each installment is over.
    const monthsHint = offer.overLimit === 'WARN' && (check.over.installment || check.over.debts)
        ? (check.over.installment && check.over.debts ? t('salary_advance_over_both') : t(check.over.installment ? 'salary_advance_over_installment' : 'salary_advance_over_debts'))
            .replace('{percent}', num(check.over.installment ? offer.installmentPercent : offer.debtsPercent))
            .replace('{cap}', money(check.over.installment ? installmentCap : debtsCap))
            .replace('{debtsPercent}', num(offer.debtsPercent)).replace('{debtsCap}', money(debtsCap))
        : least !== null
            ? t(limit.by === 'DEBTS' ? 'salary_advance_months_hint_debts' : 'salary_advance_months_hint_installment')
                .replace('{least}', num(least)).replace('{cap}', money(limit.capMinor))
                .replace('{percent}', num(limit.by === 'DEBTS' ? offer.debtsPercent : offer.installmentPercent))
            : t('salary_advance_months_hint')
    // Said under its field as its hint says it: more than the most is the amount's hint, too few months the months'.
    const errorText = (key: NonNullable<AdvanceCheck['errors'][keyof AdvanceDraft]>) =>
        key === 'salary_advance_ask_amount_over' ? amountHint
            : key === 'salary_advance_ask_months_few' ? monthsHint
                : key === 'salary_advance_ask_amount_unpayable' ? t(key).replace('{amount}', money(mostPayable(limit.capMinor)))
                    : t(key)
    // Once the amount and months are right, each month's installment.
    const lines = !check.errors.amount && !check.errors.months && check.amountMinor > 0
        ? installmentsOf(check.amountMinor, check.months, payrollMonthOfKey(first)!) : []
    const consent = lines.length > 0 ? consentWords({ salary_advance_consent: t('salary_advance_consent') }, check.amountMinor, locale) : null

    const focusFirst = (form: HTMLFormElement, found: AdvanceCheck['errors']) => {
        const field = FIELDS.find(f => found[f])
        requestAnimationFrame(() => form.querySelector<HTMLElement>(field === 'first' ? 'input[name="advance-first"]' : `[name="advance-${field}"]`)?.focus())
    }

    const submit = (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault()
        const form = e.currentTarget
        setErrors(check.errors)
        if (Object.keys(check.errors).length > 0) {
            focusFirst(form, check.errors)
            return
        }
        void action.run('ask', async () => {
            try {
                const res = await fetch('/api/salary-advances', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ amount, months, first, locale }),
                })
                if (!res.ok) {
                    const body = await res.json().catch(() => ({}))
                    // Something changed meanwhile: said above the buttons, and what may be asked for read again, keeping what's typed.
                    if (body.code === 'SALARY_ADVANCE_INVALID' || body.code === 'SALARY_ADVANCE_CLOSED') {
                        setChanged(true)
                        const fresh: AdvanceOffer | null | undefined = (await mutate())?.data?.offer
                        if (fresh && !fresh.closed) {
                            const again = advanceCheck({ amount, months, first }, fresh)
                            setErrors(again.errors)
                            if (Object.keys(again.errors).length > 0) focusFirst(form, again.errors)
                        }
                        return
                    }
                    showToast(body.error || t('failed_submit_request'), 'error')
                    return
                }
                showToast(t('req_asked'), 'success')
                onAsked()
            } catch {
                showToast(t('error_generic'), 'error')
            }
        })
    }

    const shown = (field: keyof AdvanceDraft) => (errors[field] ? errorText(errors[field]!) : undefined)

    return (
        <form className="ui-form" noValidate onSubmit={submit}>
            <Field label={t('salary_advance_amount_label')} hint={amountHint} error={shown('amount')}>{p => (
                <TextInput {...p} name="advance-amount" inputMode="decimal" type="text" autoComplete="off" value={amount}
                    onChange={e => { setAmount(e.target.value); setErrors(x => ({ ...x, amount: undefined, months: undefined })) }} />
            )}</Field>
            <Field label={t('salary_advance_months_label')} hint={monthsHint} error={shown('months')}>{p => (
                <TextInput {...p} name="advance-months" inputMode="numeric" type="text" autoComplete="off" value={months}
                    onChange={e => { setMonths(e.target.value); setErrors(x => ({ ...x, months: undefined, amount: undefined })) }} />
            )}</Field>
            {offer.approved
                ? <p className="ui-prose">{t('salary_advance_first_only').replace('{month}', payrollMonthName(locale, offer.firsts[0])).replace('{approved}', payrollMonthName(locale, offer.approved, false))}</p>
                : <Choice legend={t('salary_advance_first_label')} name="advance-first" value={first}
                    onChange={v => { setPicked(v); setErrors(x => ({ ...x, first: undefined })) }}
                    warning={shown('first')}
                    options={offer.firsts.map(m => ({ value: payrollMonthKey(m), label: t('salary_advance_month_payroll').replace('{month}', payrollMonthName(locale, m)) }))} />}
            {lines.length > 0 && (
                <div className="ui-field">
                    <span className="ui-label" id="advance-installments">{t('salary_advance_installments_label')}</span>
                    <ul className="ui-detail-lines" aria-labelledby="advance-installments">
                        {lines.map(l => (
                            <li key={payrollMonthKey(l)}>{t('salary_advance_installment_line').replace('{month}', payrollMonthName(locale, l)).replace('{amount}', money(l.amountMinor))}</li>
                        ))}
                    </ul>
                </div>
            )}
            {consent && <p className="ui-prose">{consent}</p>}
            {changed && <p className="ui-error" role="alert">{t('salary_advance_changed')}</p>}
            <DialogActions>
                <Button onClick={onCancel}>{t('cancel')}</Button>
                <Button type="submit" variant="primary" disabled={action.running} busy={action.is('ask')}>{t('salary_advance_agree_send')}</Button>
            </DialogActions>
        </form>
    )
}

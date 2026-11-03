'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import useSWR from 'swr'
import { MinusCircleIcon, PlusCircleIcon } from '@phosphor-icons/react/ssr'
import AccessDenied from '@/components/AccessDenied'
import { Button, ButtonLink, Card, Field, Page, PageHeader, TextArea, TextInput } from '@/components/ui'
import { useLanguage } from '@/context/LanguageContext'
import { useToast } from '@/context/ToastContext'
import { COPY, MAX_DAYS, daysError, refusedDays, type AdjustmentKind } from '@/lib/adjustment-form'
import { apiErrorText } from '@/lib/api-error-text'
import { fetcher } from '@/lib/swr-fetcher'
import { useCan, useViewer } from '@/lib/useCan'
import { useModules } from '@/lib/useModules'

/**
 * Add a bonus or a deduction to somebody's pay this month, in days of their
 * pay (UI_PLAN.md §5 step 5, the pages left). It was two copies of one
 * form, each a card of its own making with its sides chosen by hand for
 * each language. On the building blocks: the page header, saying whose pay
 * it is; the days checked before sending and said under the field; and a
 * refusal said as the server said it, where every one was "Failed to add
 * bonus".
 */
export default function AddAdjustment({ kind }: { kind: AdjustmentKind }) {
    const { t, locale } = useLanguage()
    const { showToast } = useToast()
    const { can } = useCan()
    const modules = useModules()
    const router = useRouter()
    const { id } = useParams<{ id: string }>()
    // The layout's viewer while the session loads, as can() is: asked of
    // the session alone, their own pay showed the form until it came.
    const viewer = useViewer()
    const intl = locale === 'ar' ? 'ar-EG' : 'en-GB'
    const copy = COPY[kind]

    // Adjusting pay is theirs who may (the list offers it only to them), and
    // nobody's own (ROLES_PLAN.md §4.2, rule 5): said here, where the form
    // let them fill it in and the server refused it.
    const mayAdjust = can('salary_adjustments.manage')
    const own = !!viewer?.id && viewer.id === id
    const person = useSWR<{ data: { firstName: string; lastName: string } }>(mayAdjust && id && !own ? `/api/users?id=${id}` : null, fetcher)
    const name = person.data?.data ? `${person.data.data.firstName} ${person.data.data.lastName}`.trim() : ''

    const [amount, setAmount] = useState('')
    const [reason, setReason] = useState('')
    const [daysWrong, setDaysWrong] = useState('')
    const [error, setError] = useState('')
    const [loading, setLoading] = useState(false)
    // The days take the focus once the form can be used again, as they're
    // off while it's sent; a new request each time, so it's focused again.
    const [focusDays, setFocusDays] = useState<{ n: number } | null>(null)

    // Reloading or closing the tab with something typed asks first; not once it's being sent.
    const started = !!(amount || reason)
    useEffect(() => {
        if (!started || loading) return
        const warn = (e: BeforeUnloadEvent) => { e.preventDefault() }
        window.addEventListener('beforeunload', warn)
        return () => window.removeEventListener('beforeunload', warn)
    }, [started, loading])

    useEffect(() => {
        if (!focusDays || loading) return
        document.querySelector<HTMLElement>('[name="amount"]')?.focus()
    }, [focusDays, loading])

    if (!mayAdjust) return <AccessDenied />

    const max = MAX_DAYS.toLocaleString(intl)
    const wrongDays = (message: string) => {
        setDaysWrong(message)
        setFocusDays(f => ({ n: (f?.n ?? 0) + 1 }))
    }

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        setError('')
        setFocusDays(null)
        const wrong = daysError(amount)
        if (wrong) return wrongDays(t(wrong).replace('{max}', max))
        setDaysWrong('')
        setLoading(true)
        try {
            // The server asks for an authenticator code first, where it's due,
            // and sends this again once it's given (StepUpInterceptor).
            const res = await fetch(`/api/users/${id}/${copy.path}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ amount: Number(amount.trim()), reason: reason.trim() }),
            })
            if (!res.ok) {
                const text = await res.text()
                let answer: { error?: string } | null = null
                try { answer = JSON.parse(text) } catch { /* not JSON: said as it came */ }
                if (refusedDays(answer)) wrongDays(t('adj_new_days_invalid'))
                else setError(apiErrorText(text, t('error_generic')))
                setLoading(false)
                return
            }
            showToast(t(COPY[kind].added), 'success')
            router.push('/dashboard/employees')
            router.refresh()
        } catch {
            setError(t('error_generic'))
            setLoading(false)
        }
    }

    // Whose pay, once it's known; its line kept meanwhile, so the form doesn't move when it comes.
    const [before, after] = t('adj_new_for').split('{name}')
    const subtitle = name ? <>{before}<bdi>{name}</bdi>{after}</> : ' '

    return (
        <Page>
            <PageHeader title={t(copy.title)} subtitle={own ? undefined : subtitle} back={{ href: '/dashboard/employees', label: modules.label('employees') }} />
            <Card>
                {own ? <p className="ui-card-note">{t('adj_new_own_pay')}</p> : (
                    <form onSubmit={handleSubmit} noValidate className="ui-form">
                        <p className="ui-card-note">{t(copy.hint)}</p>
                        <Field label={t('adj_new_days_label')} hint={t('adj_new_days_hint').replace('{max}', max)} error={daysWrong || undefined}>{p => (
                            <TextInput {...p} name="amount" type="number" inputMode="decimal" min={0} max={MAX_DAYS} step="any" autoComplete="off"
                                value={amount} disabled={loading}
                                onChange={e => { setAmount(e.target.value); setDaysWrong('') }} />
                        )}</Field>
                        <Field label={t('adj_new_reason_label')}>{p => (
                            <TextArea {...p} name="reason" dir="auto" autoComplete="off" value={reason} disabled={loading} onChange={e => setReason(e.target.value)} />
                        )}</Field>
                        {error && <p className="ui-error" role="alert">{error}</p>}
                        <div className="ui-form-actions">
                            <Button type="submit" variant="primary" icon={kind === 'BONUS' ? PlusCircleIcon : MinusCircleIcon} busy={loading}>{t(copy.button)}</Button>
                            <ButtonLink href="/dashboard/employees">{t('cancel')}</ButtonLink>
                        </div>
                    </form>
                )}
            </Card>
        </Page>
    )
}

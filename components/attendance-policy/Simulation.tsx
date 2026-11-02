'use client'

import { useState } from 'react'
import { Button, Row } from '@/components/ui'
import { useLanguage } from '@/context/LanguageContext'
import { useToast } from '@/context/ToastContext'
import { apiErrorText } from '@/lib/api-error-text'
import { countOf } from '@/lib/plural'
import type { PolicyBody } from '@/lib/attendance/policy'

type Sum = { deductionDays: number; deductionMinor: number | null; overtimeMinor: number | null; days: number }
/** Money is null for whoever may not see salaries: then the preview is in days. */
type Result = { month: string; moneyHidden?: boolean; people: { userId: string; name: string; current: Sum; draft: Sum; overtimeChanged?: boolean }[]; totals: { current: Sum; draft: Sum; overtimeChanged?: boolean } }

/** A month ("2026-10") as the page's language writes one: "October 2026", "أكتوبر ٢٠٢٦". */
export function monthText(month: string, intl: string): string {
    return new Date(`${month}-01T00:00:00Z`).toLocaleDateString(intl, { month: 'long', year: 'numeric', timeZone: 'UTC' })
}

/**
 * "Under these rules, last month would have been…" (ATTENDANCE_PLAN.md §6.7):
 * the draft replayed over last month's measured days, per person against the
 * policy in force. Nothing is saved. A result for an earlier draft says so.
 *
 * `draft` checks the form first, saying under each field what's wrong, and
 * gives the policy only when it's right; `formKey` is the form as it stands.
 */
export default function Simulation({ companyId, formKey, draft }: { companyId: string; formKey: string; draft: () => PolicyBody | null }) {
    const { t, locale } = useLanguage()
    const { showToast } = useToast()
    const intl = locale === 'ar' ? 'ar-EG' : 'en-GB'
    const [result, setResult] = useState<{ for: string; data: Result } | null>(null)
    const [busy, setBusy] = useState(false)

    const money = (minor: number) => (minor / 100).toLocaleString(intl, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    const signed = (minor: number) => (minor > 0 ? '+' : minor < 0 ? '−' : '') + money(Math.abs(minor))
    // A deduction's days are kept to four places (PR 149).
    const days = (n: number) => countOf(t, locale, n, 'days', 4)
    const signedDays = (n: number) => (n > 0 ? '+' : n < 0 ? '−' : '') + days(Math.abs(n))

    const run = async () => {
        const body = draft()
        if (!body) return
        setBusy(true)
        try {
            const res = await fetch('/api/attendance/policy/simulate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ companyId, body }) })
            const text = await res.text()
            if (!res.ok) {
                showToast(apiErrorText(text, t('error_generic')), 'error')
                return
            }
            setResult({ for: formKey, data: JSON.parse(text).data })
        } catch {
            showToast(t('error_generic'), 'error')
        } finally {
            setBusy(false)
        }
    }

    const data = result?.data
    const hidden = !!data?.moneyHidden
    // Without the money, whether overtime pay changes comes as a flag (review on #15).
    const changed = data?.people.filter(x => x.current.deductionDays !== x.draft.deductionDays || x.current.deductionMinor !== x.draft.deductionMinor || x.current.overtimeMinor !== x.draft.overtimeMinor || !!x.overtimeChanged) ?? []
    const amount = (sum: Sum) => hidden ? days(sum.deductionDays) : `${money(sum.deductionMinor ?? 0)} (${days(sum.deductionDays)})`
    const overtime = (current: Sum, draft: Sum, flagged?: boolean) => hidden
        ? (flagged ? t('sim_overtime_changes') : null)
        : current.overtimeMinor !== draft.overtimeMinor ? t('sim_overtime').replace('{diff}', signed((draft.overtimeMinor ?? 0) - (current.overtimeMinor ?? 0))) : null

    return (
        <fieldset className="ui-fieldset">
            <legend className="ui-subsection-title">{t('sim_title')}</legend>
            <div className="ui-field-group">
                <p className="ui-hint">{t('sim_hint')}</p>
                <div>
                    <Button busy={busy} onClick={() => { void run() }}>{t('sim_run')}</Button>
                </div>
                {data && result && (
                    <>
                        {result.for !== formKey && <p className="ui-hint" role="status">{t('sim_stale')}</p>}
                        <p>
                            {hidden
                                ? t('sim_summary_days')
                                    .replace('{month}', monthText(data.month, intl))
                                    .replace('{now}', days(data.totals.current.deductionDays))
                                    .replace('{then}', days(data.totals.draft.deductionDays))
                                : t('sim_summary')
                                    .replace('{month}', monthText(data.month, intl))
                                    .replace('{now}', money(data.totals.current.deductionMinor ?? 0))
                                    .replace('{then}', money(data.totals.draft.deductionMinor ?? 0))
                                    .replace('{diff}', signed((data.totals.draft.deductionMinor ?? 0) - (data.totals.current.deductionMinor ?? 0)))}
                            {overtime(data.totals.current, data.totals.draft, data.totals.overtimeChanged) && <> {overtime(data.totals.current, data.totals.draft, data.totals.overtimeChanged)}</>}
                        </p>
                        {data.totals.current.days === 0 ? <p className="ui-hint">{t('sim_no_days')}</p>
                            : changed.length === 0 ? <p className="ui-hint">{t('sim_no_change')}</p>
                                : (
                                    <ul className="ui-rows" aria-label={t('sim_title')}>
                                        {changed.map(x => {
                                            const note = overtime(x.current, x.draft, x.overtimeChanged)
                                            return (
                                                <Row
                                                    key={x.userId}
                                                    title={<bdi>{x.name}</bdi>}
                                                    detail={<>{t('sim_row').replace('{now}', amount(x.current)).replace('{then}', amount(x.draft))}{note && <> {note}</>}</>}
                                                    end={<bdi className="ui-sim-difference">{hidden ? signedDays(x.draft.deductionDays - x.current.deductionDays) : signed((x.draft.deductionMinor ?? 0) - (x.current.deductionMinor ?? 0))}</bdi>}
                                                />
                                            )
                                        })}
                                    </ul>
                                )}
                    </>
                )}
            </div>
        </fieldset>
    )
}

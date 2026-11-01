'use client'
import { useState } from 'react'
import { CalendarBlankIcon, HourglassIcon, TagIcon, UmbrellaIcon, WalletIcon, WarningCircleIcon } from '@phosphor-icons/react/ssr'
import { Button, Card, DataList, Details, Dialog, EmptyState, Field, ListCard, Section, TextInput, type Column } from '@/components/ui'
import { useLanguage } from '@/context/LanguageContext'
import { useToast } from '@/context/ToastContext'
import { DAY_OFF_TYPE_LABEL } from '@/lib/day-off-types'
import { RECONSTRUCTED_NOTE } from '@/lib/leave-reset'
import { countOf } from '@/lib/plural'
import type { SWRError } from '@/lib/swr-fetcher'
import { useBusyAction } from '@/lib/useBusyAction'

/**
 * An employee's history, its Day off credit tab (UI_PLAN.md §5 step 5, an
 * employee's history part 2): the credit a year and what's left, then each
 * year's days off, with Reconsider on each one taken from the credit.
 */

export type DayOffRequest = {
    id: string
    type: string
    date: string
    daysDeducted: number
    /** CREDIT or SALARY: what the days came out of. */
    deductionType: string
    reason?: string | null
}

type Snapshot = {
    id: string
    year: number
    baseCredit: number
    remainingCredit: number
    /** Set when the reset had to reconstruct this year rather than measure it. */
    note?: string | null
}

export type DayOffHistory = {
    baseCredit: number
    remainingCredit: number
    history: { year: number; snapshot: Snapshot | null; requests: DayOffRequest[] }[]
}

/** The page's own words and digits for the dates and day counts on this tab and its dialog. */
function useDayOffWords() {
    const { t, locale } = useLanguage()
    const digits = locale === 'ar' ? 'ar-EG' : 'en-GB'
    return {
        t, locale,
        date: (d: string) => new Date(d).toLocaleDateString(digits, { day: 'numeric', month: 'long', year: 'numeric' }),
        days: (n: number) => countOf(t, locale, n, 'days'),
        // "2026", never "2,026", in the page's digits.
        year: (y: number) => new Intl.NumberFormat(digits, { useGrouping: false }).format(y),
        type: (r: DayOffRequest) => (DAY_OFF_TYPE_LABEL[r.type] ? t(DAY_OFF_TYPE_LABEL[r.type]) : r.type),
    }
}

export function DayOffTab({ history, loading, error, retrying, retry, canReconsider, onReconsider }: {
    history: DayOffHistory | null
    loading: boolean
    error: unknown
    retrying: boolean
    retry: () => void
    /** dayoff.approve: the days of a day off taken from the credit can be changed. */
    canReconsider: boolean
    onReconsider: (request: DayOffRequest) => void
}) {
    const { t, date, days, year, type } = useDayOffWords()

    if (!history && loading) return <div className="ui-panel" role="status"><EmptyState icon={HourglassIcon} title={t('loading')} /></div>
    if (!history && error) return (
        <div className="ui-panel">
            <EmptyState icon={WarningCircleIcon} title={t('hist_dayoff_load_failed')} detail={(error as SWRError).info?.error}
                action={<Button busy={retrying} onClick={retry}>{t('try_again')}</Button>} />
        </div>
    )
    if (!history) return null

    const from = (r: DayOffRequest) => t(r.deductionType === 'CREDIT' ? 'deduct_from_credit' : 'deduct_from_salary')
    // Only a day taken from the credit: the old Manage deductions window
    // offered no others, and the server's refusal names only those.
    const reconsider = (r: DayOffRequest) => canReconsider && r.deductionType === 'CREDIT'
        ? <Button size="sm" onClick={() => onReconsider(r)}>{t('reevaluate')}</Button>
        : null
    const reason = (r: DayOffRequest) => (r.reason ? <bdi>{r.reason}</bdi> : null)

    const columns: Column<DayOffRequest>[] = [
        { key: 'date', header: t('hist_dayoff_col_date'), cell: r => <span className="ui-item-title">{date(r.date)}</span> },
        { key: 'type', header: t('hist_dayoff_col_type'), cell: type },
        { key: 'days', header: t('hist_dayoff_col_days'), cell: r => days(r.daysDeducted), align: 'end' },
        { key: 'from', header: t('hist_dayoff_col_from'), cell: from },
        { key: 'reason', header: t('hist_dayoff_col_reason'), cell: reason },
        ...(canReconsider ? [{ key: 'actions', header: t('actions_label'), hideHeader: true, align: 'end' as const, cell: reconsider }] : []),
    ]

    return (
        <>
            <Card>
                <Details items={[
                    { label: t('hist_dayoff_base'), value: days(history.baseCredit) },
                    { label: t('hist_dayoff_left'), value: days(history.remainingCredit) },
                ]} />
            </Card>

            {history.history.length === 0 && <div className="ui-panel"><EmptyState icon={UmbrellaIcon} title={t('hist_dayoff_none')} /></div>}

            {history.history.map(y => (
                <Section key={y.year} title={year(y.year)}>
                    {/* A closed year: its credit, and what was left when it ended. */}
                    {y.snapshot && (
                        <Card>
                            <Details items={[
                                { label: t('hist_dayoff_year_base'), value: days(y.snapshot.baseCredit) },
                                { label: t('hist_dayoff_year_left'), value: days(y.snapshot.remainingCredit) },
                            ]} />
                            {/* A reconstructed year says so: its figures were
                                carried through it, not measured, and somebody
                                reading a leave balance from years ago should be
                                told which kind of number it is. */}
                            {y.snapshot.note && (
                                <p className="ui-card-note">
                                    {y.snapshot.note === RECONSTRUCTED_NOTE ? t('hist_dayoff_reconstructed') : <bdi>{y.snapshot.note}</bdi>}
                                </p>
                            )}
                        </Card>
                    )}
                    <DataList
                        caption={t('hist_dayoff_days_off').replace('{year}', year(y.year))}
                        columns={columns}
                        rows={y.requests}
                        rowKey={r => r.id}
                        empty={<EmptyState icon={CalendarBlankIcon} title={t('hist_dayoff_none_year')} />}
                        card={r => (
                            <ListCard
                                title={date(r.date)}
                                details={[
                                    { icon: TagIcon, text: type(r) },
                                    { icon: CalendarBlankIcon, text: days(r.daysDeducted) },
                                    { icon: WalletIcon, text: <span>{t('hist_dayoff_col_from')}: {from(r)}</span> },
                                ]}
                                foot={reason(r) || reconsider(r)
                                    ? <>{reason(r) && <span className="ui-hint">{reason(r)}</span>}{reconsider(r) && <span className="ui-row-actions">{reconsider(r)}</span>}</>
                                    : undefined}
                            />
                        )}
                    />
                </Section>
            ))}
        </>
    )
}

/**
 * Changing the days a day off took from the credit: the difference goes back
 * to the credit, or comes out of it. Open while `request` is set; it stays
 * open until the change is saved or refused.
 */
export function ReconsiderDayOff({ request, onClose, onDone }: {
    request: DayOffRequest | null
    onClose: () => void
    onDone: () => void
}) {
    const { t, date, type } = useDayOffWords()
    const { showToast } = useToast()
    const action = useBusyAction()
    // Each request starts from its own days: held against the one it was typed for.
    const [typed, setTyped] = useState<{ id: string; value: string }>()
    const [error, setError] = useState<string>()
    const value = request && typed?.id === request.id ? typed.value : String(request?.daysDeducted ?? '')
    const close = () => {
        if (action.running) return
        setTyped(undefined)
        setError(undefined)
        onClose()
    }

    const save = () => {
        if (!request) return
        const days = Number(value)
        // The server takes any number; a day off is taken in halves, from none up.
        if (value.trim() === '' || !Number.isFinite(days) || days < 0 || (days * 2) % 1 !== 0) {
            setError(t('requests_day_off_days_invalid'))
            return
        }
        void action.run('save', async () => {
            try {
                const res = await fetch(`/api/admin/day-off-requests/${request.id}/reevaluate`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ newDays: days }),
                })
                if (!res.ok) {
                    showToast(t('hist_reconsider_failed'), 'error')
                    return
                }
                showToast(t('hist_reconsider_done'), 'success')
                setTyped(undefined)
                onDone()
            } catch {
                showToast(t('hist_reconsider_failed'), 'error')
            }
        })
    }

    return (
        <Dialog
            open={!!request}
            onClose={close}
            title={t('hist_reconsider_title')}
            actions={<>
                <Button onClick={close} disabled={action.running}>{t('cancel')}</Button>
                <Button variant="primary" onClick={save} disabled={action.running} busy={action.is('save')}>{t('save')}</Button>
            </>}
        >
            {request && (
                <>
                    <p>{t('hist_reconsider_what').replace('{type}', type(request)).replace('{date}', date(request.date))}</p>
                    <Field label={t('hist_reconsider_days')} hint={t('hist_reconsider_hint')} error={error}>{p => (
                        <TextInput {...p} type="number" autoComplete="off" inputMode="decimal" min="0" step="0.5" value={value}
                            onChange={e => { setTyped({ id: request.id, value: e.target.value }); setError(undefined) }} />
                    )}</Field>
                </>
            )}
        </Dialog>
    )
}

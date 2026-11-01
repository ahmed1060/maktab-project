'use client'
import Link from 'next/link'
import { CalendarCheckIcon, CoinsIcon, HourglassIcon, MinusCircleIcon, PlusCircleIcon, ReceiptIcon, WarningCircleIcon } from '@phosphor-icons/react/ssr'
import { Button, Card, DataList, Details, EmptyState, ListCard, Row, Rows, Section, StatusBadge, type Column, type StatusTone } from '@/components/ui'
import { useLanguage } from '@/context/LanguageContext'
import { countOf } from '@/lib/plural'
import type { SWRError } from '@/lib/swr-fetcher'
import type { TranslationKey } from '@/lib/translations'

/**
 * An employee's history, its Salary tab (UI_PLAN.md §5 step 5, an
 * employee's history part 1, PR 157): the current base salary, each month,
 * the settlements and the debts, in the page's language, digits too.
 */

export type SalaryRecord = {
    id: string
    month: number
    year: number
    totalDays: number
    /** In days. */
    deductions: number
    baseSalary: number
    /** In days. */
    bonusDays: number
    createdAt: string
    /**
     * Which number this month's total actually is. PAYSLIP means payroll ran
     * and this is what it produced; ESTIMATE means it did not, and the figure
     * is this screen's own approximation of a month it cannot see inside.
     */
    figure?:
    | { source: 'PAYSLIP'; netMinor: number; payslipId: string; status: 'APPROVED' | 'PAID' }
    | { source: 'ESTIMATE'; netMinor: number }
}

export type Settlement = { id: string; lastWorkingDay: string; net: number; status: string }

export type Debt = {
    id: string; amount: number; recovered: number; outstanding: number; writtenOff: number
    status: 'OUTSTANDING' | 'SETTLED' | 'WAIVED'; source: string; reason: string | null
    dueDate: string; settledAt: string | null
}

const DEBT_TONE: Record<Debt['status'], StatusTone> = { OUTSTANDING: 'waiting', SETTLED: 'good', WAIVED: 'neutral' }

export function SalaryTab({ employee, records, loading, error, retrying, retry, settlements, debts }: {
    employee: { salary?: number } | null
    records: SalaryRecord[]
    loading: boolean
    error: unknown
    retrying: boolean
    retry: () => void
    settlements: Settlement[]
    debts: Debt[]
}) {
    const { t, locale } = useLanguage()
    const digits = locale === 'ar' ? 'ar-EG' : 'en-GB'
    const money = (n: number) =>
        new Intl.NumberFormat(locale === 'ar' ? 'ar-EG' : 'en-EG', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)
    const amount = (n: number) => <span className="ui-num">{money(n)}</span>
    const number = (n: number) => n.toLocaleString(digits, { maximumFractionDigits: 2 })
    const date = (d: string) => new Date(d).toLocaleDateString(digits, { day: 'numeric', month: 'long', year: 'numeric' })
    const days = (n: number) => countOf(t, locale, n, 'days')
    // "October 2026", the year in the page's digits too.
    const month = (r: SalaryRecord) => new Date(r.year, r.month - 1).toLocaleString(digits, { month: 'long', year: 'numeric' })

    // H1: the figure comes from the API, which reads the payslip where payroll
    // produced one and falls back to an estimate only for months before it;
    // this screen used to work out a second one inline that disagreed with it.
    const net = (r: SalaryRecord) => (r.figure?.netMinor ?? 0) / 100
    const payslip = (r: SalaryRecord) => (r.figure?.source === 'PAYSLIP' ? r.figure.payslipId : null)
    // The month opens its payslip, as an item's title opens it (DESIGN.md §5.4).
    const monthTitle = (r: SalaryRecord) => {
        const id = payslip(r)
        return id ? <Link className="ui-item-link" href={`/dashboard/documents/payslip/${id}`} prefetch={false}>{month(r)}</Link> : month(r)
    }
    const daysPaid = (r: SalaryRecord) => t('hist_days_of').replace('{n}', number(r.totalDays - r.deductions)).replace('{total}', number(r.totalDays))
    // Said, rather than left to be assumed: an estimate that looked identical
    // to a settled figure is why this screen and the payslip could disagree
    // for months without anybody noticing.
    const figureNote = (r: SalaryRecord) => <span className="ui-item-detail">{t(payslip(r) ? 'salary_figure_payslip' : 'salary_figure_estimate')}</span>

    const columns: Column<SalaryRecord>[] = [
        { key: 'month', header: t('hist_col_month'), cell: r => <span className="ui-item-title">{monthTitle(r)}</span> },
        { key: 'base', header: t('hist_col_base'), cell: r => amount(r.baseSalary || employee?.salary || 0), align: 'end' },
        { key: 'days', header: t('hist_col_days'), cell: daysPaid },
        { key: 'deducted', header: t('hist_col_deducted'), cell: r => (r.deductions > 0 ? days(r.deductions) : '') },
        { key: 'bonus', header: t('hist_col_bonus'), cell: r => (r.bonusDays > 0 ? days(r.bonusDays) : '') },
        { key: 'salary', header: t('hist_col_salary'), cell: r => <>{amount(net(r))}{figureNote(r)}</>, align: 'end' },
        { key: 'recorded', header: t('hist_col_recorded'), cell: r => date(r.createdAt) },
    ]

    const debtColumns: Column<Debt>[] = [
        // What's left of one still owed; the whole of one that's closed.
        { key: 'amount', header: t('hist_debt_col_amount'), cell: d => <span className="ui-item-title">{amount(d.status === 'OUTSTANDING' ? d.outstanding : d.amount)}</span> },
        { key: 'status', header: t('hist_debt_col_status'), cell: d => <StatusBadge tone={DEBT_TONE[d.status]}>{t(`debt_status_${d.status}` as TranslationKey)}</StatusBadge> },
        { key: 'due', header: t('hist_debt_col_due'), cell: d => date(d.dueDate) },
        { key: 'recovered', header: t('hist_debt_col_recovered'), cell: d => (d.recovered > 0 ? amount(d.recovered) : ''), align: 'end' },
        { key: 'writtenOff', header: t('hist_debt_col_written_off'), cell: d => (d.writtenOff > 0 ? amount(d.writtenOff) : ''), align: 'end' },
        { key: 'reason', header: t('hist_debt_col_reason'), cell: d => <DebtReason debt={d} /> },
    ]

    const months = (() => {
        if (records.length === 0 && loading) return <div className="ui-panel" role="status"><EmptyState icon={HourglassIcon} title={t('loading')} /></div>
        if (records.length === 0 && error) return (
            <div className="ui-panel">
                <EmptyState icon={WarningCircleIcon} title={t('hist_load_failed')} detail={(error as SWRError).info?.error}
                    action={<Button busy={retrying} onClick={retry}>{t('try_again')}</Button>} />
            </div>
        )
        return (
            <DataList
                caption={t('hist_months')}
                columns={columns}
                rows={records}
                rowKey={r => r.id}
                empty={<EmptyState icon={ReceiptIcon} title={t('hist_no_months')} />}
                card={r => (
                    <ListCard
                        title={monthTitle(r)}
                        details={[
                            { icon: CalendarCheckIcon, text: daysPaid(r) },
                            ...(r.deductions > 0 ? [{ icon: MinusCircleIcon, text: t('hist_deducted_n').replace('{days}', days(r.deductions)) }] : []),
                            ...(r.bonusDays > 0 ? [{ icon: PlusCircleIcon, text: t('hist_bonus_n').replace('{days}', days(r.bonusDays)) }] : []),
                            { icon: CoinsIcon, text: <>{amount(net(r))}{figureNote(r)}</> },
                        ]}
                    />
                )}
            />
        )
    })()

    return (
        <>
            {employee?.salary !== undefined && (
                <Card><Details items={[{ label: t('hist_base_salary'), value: amount(employee.salary) }]} /></Card>
            )}

            {months}

            {/* The only route to an ended contract's statement: the person it
                is about can't sign in, so if it isn't reachable from their
                page it isn't reachable at all. */}
            {settlements.length > 0 && (
                <Section title={t('doc_settlements')}>
                    <Rows label={t('doc_settlements')}>
                        {settlements.map(s => (
                            <Row key={s.id} href={`/dashboard/documents/settlement/${s.id}`} title={date(s.lastWorkingDay)} detail={t('doc_last_working_day')} />
                        ))}
                    </Rows>
                </Section>
            )}

            {/* Closed debts are listed too. A list of open ones answers what is
                left; this answers what happened, and a written-off debt is the
                entry most worth being able to find a year later. */}
            {debts.length > 0 && (
                <Section title={t('debts_title')}>
                    <DataList
                        caption={t('debts_title')}
                        columns={debtColumns}
                        rows={debts}
                        rowKey={d => d.id}
                        card={d => (
                            <ListCard
                                title={amount(d.status === 'OUTSTANDING' ? d.outstanding : d.amount)}
                                status={<StatusBadge tone={DEBT_TONE[d.status]}>{t(`debt_status_${d.status}` as TranslationKey)}</StatusBadge>}
                                details={[
                                    { icon: CalendarCheckIcon, text: `${t('hist_debt_col_due')}: ${date(d.dueDate)}` },
                                    ...(d.recovered > 0 ? [{ icon: CoinsIcon, text: t('debt_recovered_so_far').replace('{n}', money(d.recovered)) }] : []),
                                    ...(d.writtenOff > 0 ? [{ icon: MinusCircleIcon, text: t('debt_written_off').replace('{n}', money(d.writtenOff)) }] : []),
                                ]}
                                foot={<DebtReason debt={d} />}
                            />
                        )}
                    />
                </Section>
            )}
        </>
    )
}

/**
 * Why the debt arose: what someone still held of a cash advance on leaving
 * (CLIENTS_PLAN.md §7.3), and the reason written for it, each on its line.
 */
function DebtReason({ debt }: { debt: Debt }) {
    const { t } = useLanguage()
    return (
        <>
            {debt.source === 'CASH_ADVANCE' && <span>{t('debt_source_CASH_ADVANCE')}</span>}
            {debt.reason && <span className="ui-item-detail"><bdi>{debt.reason}</bdi></span>}
        </>
    )
}

'use client'

import { useEffect, useState } from 'react'
import useSWR from 'swr'
import { useSearchParams } from 'next/navigation'
import { useSession } from 'next-auth/react'
import {
    CalendarBlankIcon, CalendarCheckIcon, ChatTextIcon, CheckIcon, CircleHalfIcon, TagIcon, UserIcon, WalletIcon, XCircleIcon, XIcon,
} from '@phosphor-icons/react/ssr'
import { useLanguage } from '@/context/LanguageContext'
import { useToast } from '@/context/ToastContext'
import { useCompany } from '@/context/CompanyContext'
import LoadingSpinner from '@/components/LoadingSpinner'
import DateRangePicker from '@/components/DateRangePicker'
import DatePickerSingle from '@/components/DatePickerSingle'
import { DayOffCreditDonut } from '@/components/DayOffCreditDonut'
import {
    Button, Choice, DataList, Dialog, EmptyState, Field, FilterBar, ItemTitle, ListCard, Page, PageHeader, Pager, pageInRange, SearchInput,
    Section, Select, StatusBadge, TextArea, TextInput, visibleRow, type Column, type StatusTone,
} from '@/components/ui'
import { useModules } from '@/lib/useModules'
import { fetcher } from '@/lib/swr-fetcher'
import { useFadingHighlight } from '@/lib/useFadingHighlight'
import { useCan } from '@/lib/useCan'
import { apiErrorText } from '@/lib/api-error-text'
import { useBusyAction } from '@/lib/useBusyAction'
import { countOf } from '@/lib/plural'
import { usedDayOffCredit } from '@/lib/day-off-credit'
import { spansDays } from '@/lib/day-off-range'
import { useAdjustOnChange } from '@/lib/useAdjustOnChange'
import type { TranslationKey } from '@/lib/translations'
import { dayOffListUrl } from './list-query'

// The label per type, keyed once here rather than as a chained ternary.
// REGULAR, CASUAL and SICK can be asked for with the form below; EMERGENCY and
// UNPAID are valid DayOffType values with no form entry yet, kept so an
// existing row of either still reads correctly instead of as "Regular".
const DAY_OFF_TYPE_LABEL: Record<string, TranslationKey> = {
    REGULAR: 'regular_day_off',
    CASUAL: 'casual_day_off',
    SICK: 'sick_day_off',
    EMERGENCY: 'emergency_day_off',
    UNPAID: 'unpaid_day_off',
}

const STATUSES = ['PENDING', 'APPROVED', 'REJECTED'] as const
const STATUS_TONE: Record<string, StatusTone> = { PENDING: 'neutral', APPROVED: 'good', REJECTED: 'problem' }

interface DayOffRequest {
    id: string
    userId: string
    type: 'REGULAR' | 'SICK' | 'EMERGENCY' | 'UNPAID' | 'CASUAL'
    status: 'PENDING' | 'APPROVED' | 'REJECTED'
    reason: string | null
    rejectionReason?: string | null
    date: string
    endDate?: string | null
    daysDeducted: number
    deductionType?: 'CREDIT' | 'SALARY' | null
    createdAt: string
    user?: {
        firstName: string
        lastName: string
        dayOffCredit: number
        teamLeaderId?: string | null
    }
}

/** The work days a request covers: every day but Friday. */
function workDays(start: string, end?: string | null) {
    const from = new Date(start)
    from.setHours(0, 0, 0, 0)
    const to = end ? new Date(end) : new Date(start)
    to.setHours(0, 0, 0, 0)
    let count = 0
    for (const day = new Date(from); day <= to; day.setDate(day.getDate() + 1)) {
        if (day.getDay() !== 5) count++
    }
    return count
}

export default function DayOffRequestsPage() {
    const { t, locale } = useLanguage()
    const { showToast } = useToast()
    const modules = useModules()
    const { data: session, status } = useSession()
    const user = session?.user
    // The manager's view — the company's requests, not one's own — is for
    // those who may see them; deciding one is narrower still.
    const { can, canFor } = useCan()
    const managesRequests = can('dayoff.view')
    const canDecide = can('dayoff.approve')
    const { selectedCompanyId: contextCompanyId } = useCompany()
    const searchParams = useSearchParams()
    const highlightId = searchParams.get('highlight')
    // Shown for six seconds after arriving via ?highlight=. See
    // lib/useFadingHighlight.ts for why this is not an effect any more.
    const visualHighlightId = useFadingHighlight(highlightId, 6000)

    // Filters. A link can open the list on a status, as the dashboard's
    // "Day off requests" tile opens it on the pending ones.
    const [query, setQuery] = useState('')
    const [search, setSearch] = useState('')
    const [statusFilter, setStatusFilter] = useState(() => {
        const asked = searchParams.get('status')
        return asked && (STATUSES as readonly string[]).includes(asked) ? asked : ''
    })
    const [employeeId, setEmployeeId] = useState('')
    const [dateFrom, setDateFrom] = useState('')
    const [dateTo, setDateTo] = useState('')
    const [page, setPage] = useState(1)
    const limit = 10

    // The search is sent once typing pauses, not on every key.
    useEffect(() => {
        if (query.trim() === search) return
        const timer = setTimeout(() => { setSearch(query.trim()); setPage(1) }, 400)
        return () => clearTimeout(timer)
    }, [query, search])

    const requestsQuery = status === 'authenticated' ? dayOffListUrl({
        manages: managesRequests,
        page, limit,
        companyId: contextCompanyId,
        status: statusFilter,
        employeeId,
        from: dateFrom,
        to: dateTo,
        search,
    }) : null
    const { data: requestsResult, isLoading, mutate: fetchRequests } = useSWR(requestsQuery, fetcher, { keepPreviousData: true })
    const requests: DayOffRequest[] = requestsResult?.data?.data || []
    const total: number = requestsResult?.data?.total || 0
    const totalPages: number = requestsResult?.data?.totalPages || 0

    // Another company: its first page, without an employee from the last
    // one. Fewer pages, as when the last request on the last page goes: the
    // last page there is now. An empty page shows no pager to leave it by.
    useAdjustOnChange([contextCompanyId], () => { setPage(1); setEmployeeId('') })
    useAdjustOnChange([totalPages], () => setPage(p => pageInRange(p, totalPages)))

    // The people a manager can pick from: the server keeps a Team Leader's
    // list to their team.
    const peopleQuery = status === 'authenticated' && managesRequests
        ? `/api/users?limit=1000${user?.role === 'SUPER_ADMIN' && contextCompanyId ? `&companyId=${contextCompanyId}` : ''}`
        : null
    const { data: peopleResult } = useSWR(peopleQuery, fetcher)
    const people: { id: string; firstName: string; lastName: string }[] = peopleResult?.data?.data || []

    // One's own credit, for someone looking at their own requests.
    const userCreditQuery = status === 'authenticated' && !managesRequests && user?.id ? `/api/users?id=${user.id}` : null
    const { data: userCreditResult } = useSWR(userCreditQuery, fetcher)
    const foundUser = (() => {
        const data = userCreditResult?.data
        if (!data) return null
        return Array.isArray(data.data) ? data.data[0] : (data?.id ? data : null)
    })()
    const userCredit: number = foundUser?.dayOffCredit || 0
    const baseCredit: number = (foundUser?.baseDayOffCredit !== undefined && foundUser?.baseDayOffCredit !== null) ? foundUser.baseDayOffCredit : (foundUser?.dayOffCredit || 0)
    const usedByCredit = usedDayOffCredit(baseCredit, userCredit)

    // Brought into view when the page opens on one (a notification's link),
    // or when it turns up on a later page: it's when the request is in the
    // list that counts, not how long the list is, as every full page is ten.
    // The list has the request twice, as a table row and as a phone card, so
    // it's the one showing at this width.
    const highlightShown = !!highlightId && requests.some(r => r.id === highlightId)
    useEffect(() => {
        if (!highlightId || !highlightShown) return
        const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
        visibleRow(highlightId)?.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'center' })
    }, [highlightId, highlightShown])

    // Asking for a day off.
    const [isRequestOpen, setIsRequestOpen] = useState(false)
    const [reqDate, setReqDate] = useState('')
    const [reqEndDate, setReqEndDate] = useState('')
    const [reqType, setReqType] = useState<'REGULAR' | 'SICK' | 'CASUAL'>('REGULAR')
    const [reqReason, setReqReason] = useState('')
    const [submitting, setSubmitting] = useState(false)

    // Deciding one.
    const [selectedRequest, setSelectedRequest] = useState<DayOffRequest | null>(null)
    const [isApprovalOpen, setIsApprovalOpen] = useState(false)
    const [isRejectOpen, setIsRejectOpen] = useState(false)
    const [daysToDeduct, setDaysToDeduct] = useState('')
    const [chosenDeduction, setDeductionType] = useState<'CREDIT' | 'SALARY'>('CREDIT')
    const [rejectionReason, setRejectionReason] = useState('')
    const action = useBusyAction()

    // When the credit can't cover the days being deducted, the deduction comes
    // out of salary whatever was picked. Derived on every render rather than
    // written back into state by an effect: the effect version rendered (and
    // could submit) CREDIT for one pass before correcting itself.
    const creditShort = !!selectedRequest && (parseFloat(daysToDeduct) || 0) > (selectedRequest.user?.dayOffCredit || 0)
    const deductionType: 'CREDIT' | 'SALARY' = creditShort ? 'SALARY' : chosenDeduction

    const handleSubmitRequest = async (e: React.FormEvent) => {
        e.preventDefault()
        setSubmitting(true)
        try {
            const res = await fetch('/api/day-off-requests', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    date: reqDate,
                    // undefined, not null — JSON.stringify() drops an undefined
                    // key entirely, satisfying the schema's z.string().optional()
                    // (which accepts undefined but rejects null). CASUAL/SICK/
                    // EMERGENCY/UNPAID requests have no end date at all.
                    endDate: reqType === 'REGULAR' ? reqEndDate : undefined,
                    type: reqType,
                    reason: reqReason,
                }),
            })
            if (res.ok) {
                showToast(t('request_submitted_success'), 'success')
                setIsRequestOpen(false)
                fetchRequests()
                setReqDate('')
                setReqEndDate('')
                setReqReason('')
            } else {
                const err = await res.text()
                showToast(apiErrorText(err, t('failed_submit_request')), 'error')
            }
        } catch {
            showToast(t('error_generic'), 'error')
        } finally {
            setSubmitting(false)
        }
    }

    const openDecision = (req: DayOffRequest, decision: 'APPROVED' | 'REJECTED') => {
        setSelectedRequest(req)
        setDeductionType('CREDIT')
        if (decision === 'APPROVED') {
            setDaysToDeduct(String(workDays(req.date, req.endDate)))
            setIsApprovalOpen(true)
        } else {
            setRejectionReason('')
            setIsRejectOpen(true)
        }
    }

    const processAction = async (requestId: string, decision: 'APPROVED' | 'REJECTED', deduction?: string, type?: 'CREDIT' | 'SALARY') => {
        try {
            const res = await fetch(`/api/admin/day-off-requests/${requestId}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    status: decision,
                    daysToDeduct: deduction,
                    deductionType: type,
                    // Only sent on a rejection; the schema caps it at 300 chars
                    // and treats an empty string as "no reason given".
                    ...(decision === 'REJECTED' ? { rejectionReason: rejectionReason.trim() } : {}),
                }),
            })
            if (res.ok) {
                showToast(t('request_action_success'), 'success')
                setIsApprovalOpen(false)
                setIsRejectOpen(false)
                fetchRequests()
            } else {
                showToast(t('error_generic'), 'error')
            }
        } catch {
            showToast(t('error_generic'), 'error')
        }
    }

    const dateLocale = locale === 'ar' ? 'ar-EG' : 'en-GB'
    const num = (n: number) => n.toLocaleString(dateLocale)
    const day = (iso: string) => new Date(iso).toLocaleDateString(dateLocale, { day: 'numeric', month: 'short', year: 'numeric' })
    const days = (n: number) => countOf(t, locale, n, 'days')
    const nameOf = (r: DayOffRequest) => r.user ? `${r.user.firstName} ${r.user.lastName}` : ''
    const typeLabel = (r: DayOffRequest) => t(DAY_OFF_TYPE_LABEL[r.type] ?? 'regular_day_off')
    // A range shows both ends only when it runs past its first day.
    const range = (r: DayOffRequest) => spansDays(r.date, r.endDate)
        ? `${day(r.date)} – ${day(r.endDate!)}`
        : day(r.date)
    const requestedOn = (r: DayOffRequest) => t('requested_on_date').replace('{date}', day(r.createdAt))
    const statusBadge = (r: DayOffRequest) => <StatusBadge tone={STATUS_TONE[r.status] ?? 'neutral'}>{t(`status_${r.status.toLowerCase()}` as TranslationKey)}</StatusBadge>
    // What came of it: the days taken and where from, or why it was refused.
    const outcome = (r: DayOffRequest) => r.status === 'APPROVED'
        ? t(r.deductionType === 'SALARY' ? 'day_off_deducted_salary' : 'day_off_deducted_credit').replace('{days}', days(r.daysDeducted || 0))
        : r.status === 'REJECTED' && r.rejectionReason ? `${t('rejected_reason_prefix')}: ${r.rejectionReason}` : null
    const decidable = (r: DayOffRequest) => canDecide && r.status === 'PENDING' && canFor('dayoff.approve', r.userId, r.user?.teamLeaderId)
    const decisions = (r: DayOffRequest) => decidable(r) && (
        <span className="ui-row-actions">
            <Button size="sm" icon={CheckIcon} onClick={() => openDecision(r, 'APPROVED')}>{t('approve_button')}</Button>
            <Button size="sm" icon={XIcon} onClick={() => openDecision(r, 'REJECTED')}>{t('reject_button')}</Button>
        </span>
    )

    const columns: Column<DayOffRequest>[] = [
        ...(managesRequests ? [{ key: 'who', header: t('employee'), cell: (r: DayOffRequest) => <ItemTitle title={nameOf(r)} detail={requestedOn(r)} /> }] : []),
        { key: 'type', header: t('type_label'), cell: r => <ItemTitle title={typeLabel(r)} detail={r.reason || t('no_reason_provided')} /> },
        { key: 'dates', header: t('date_label'), cell: r => <ItemTitle title={range(r)} detail={days(workDays(r.date, r.endDate))} /> },
        {
            key: 'status', header: t('status_label'), cell: r => (
                <>
                    {statusBadge(r)}
                    {(outcome(r) || !managesRequests) && <div className="ui-item-detail">{outcome(r) ?? requestedOn(r)}</div>}
                </>
            ),
        },
        ...(canDecide ? [{ key: 'decide', header: t('actions_label'), hideHeader: true, align: 'end' as const, cell: (r: DayOffRequest) => decisions(r) || null }] : []),
    ]

    const filtersOn = [statusFilter, employeeId, dateFrom || dateTo].filter(Boolean).length
    const resetFilters = () => {
        setQuery(''); setSearch(''); setStatusFilter(''); setEmployeeId(''); setDateFrom(''); setDateTo(''); setPage(1)
    }

    return (
        <Page>
            <PageHeader
                title={modules.label('dayOff')}
                subtitle={t('day_off_requests_subtitle')}
                action={!managesRequests && <Button variant="primary" icon={CalendarCheckIcon} onClick={() => setIsRequestOpen(true)}>{t('request_day_off')}</Button>}
            />

            {!managesRequests && (
                <Section title={t('credit_overview')}>
                    <DayOffCreditDonut remaining={userCredit} used={usedByCredit} t={t} locale={locale} loading={!foundUser} />
                </Section>
            )}

            <FilterBar
                search={<Field label={t('dayoff_search')} hideLabel>{p => <SearchInput {...p} autoComplete="off" placeholder={t('dayoff_search')} value={query} onChange={e => setQuery(e.target.value)} />}</Field>}
                activeCount={filtersOn}
                onReset={filtersOn > 0 || query ? resetFilters : undefined}
            >
                <Field label={t('status_label')} hideLabel>{p => (
                    <Select {...p} icon={CircleHalfIcon} value={statusFilter} onChange={e => { setStatusFilter(e.target.value); setPage(1) }}
                        options={[{ value: '', label: t('all_statuses') }, ...STATUSES.map(s => ({ value: s, label: t(`status_${s.toLowerCase()}` as TranslationKey) }))]} />
                )}</Field>
                {managesRequests && (
                    <Field label={t('employee')} hideLabel>{p => (
                        <Select {...p} icon={UserIcon} value={employeeId} onChange={e => { setEmployeeId(e.target.value); setPage(1) }}
                            options={[{ value: '', label: t('all_employees') }, ...people.map(u => ({ value: u.id, label: `${u.firstName} ${u.lastName}` }))]} />
                    )}</Field>
                )}
                <DateRangePicker asField hideLabel dateFrom={dateFrom} dateTo={dateTo} onChange={(from, to) => { setDateFrom(from); setDateTo(to); setPage(1) }} />
            </FilterBar>

            {isLoading && !requestsResult ? <LoadingSpinner message={t('loading_requests')} /> : (
                <DataList
                    caption={modules.label('dayOff')}
                    columns={columns}
                    rows={requests}
                    rowKey={r => r.id}
                    tone={r => visualHighlightId === r.id ? 'selected' : undefined}
                    card={r => (
                        <ListCard
                            title={managesRequests ? nameOf(r) : typeLabel(r)}
                            status={statusBadge(r)}
                            details={[
                                { icon: CalendarBlankIcon, text: `${range(r)} (${days(workDays(r.date, r.endDate))})` },
                                ...(managesRequests ? [{ icon: TagIcon, text: typeLabel(r) }] : []),
                                { icon: ChatTextIcon, text: r.reason || t('no_reason_provided') },
                                ...(outcome(r) ? [{ icon: r.status === 'APPROVED' ? WalletIcon : XCircleIcon, text: outcome(r) }] : []),
                            ]}
                            foot={<><span className="ui-meta">{requestedOn(r)}</span>{decisions(r)}</>}
                        />
                    )}
                    footer={<Pager page={page} pageCount={totalPages} onPage={setPage} summary={countOf(t, locale, total, 'requests')} />}
                    empty={<EmptyState icon={CalendarBlankIcon} title={filtersOn > 0 || search ? t('no_search_results') : t('no_day_off_requests_yet')} action={filtersOn > 0 || search
                        ? <Button variant="quiet" onClick={resetFilters}>{t('ui_reset_filters')}</Button>
                        : !managesRequests && <Button variant="primary" icon={CalendarCheckIcon} onClick={() => setIsRequestOpen(true)}>{t('request_day_off')}</Button>} />}
                />
            )}

            <Dialog
                open={isRequestOpen}
                onClose={() => setIsRequestOpen(false)}
                title={t('request_day_off')}
                actions={<>
                    <Button onClick={() => setIsRequestOpen(false)}>{t('cancel')}</Button>
                    <Button variant="primary" type="submit" form="day-off-request" busy={submitting}>{t('send_request')}</Button>
                </>}
            >
                <form id="day-off-request" onSubmit={handleSubmitRequest} className="ui-dialog-body">
                    <Field label={t('day_off_type')}>{p => (
                        <Select {...p} value={reqType} onChange={e => { setReqType(e.target.value as typeof reqType); setReqDate(''); setReqEndDate('') }}
                            options={(['REGULAR', 'CASUAL', 'SICK'] as const).map(v => ({ value: v, label: t(DAY_OFF_TYPE_LABEL[v]) }))} />
                    )}</Field>
                    {reqType === 'REGULAR'
                        ? <DateRangePicker asField label={t('dates_label')} dateFrom={reqDate} dateTo={reqEndDate} onChange={(from, to) => { setReqDate(from); setReqEndDate(to) }} />
                        : <DatePickerSingle asField label={t('date_label')} value={reqDate} onChange={date => { setReqDate(date); setReqEndDate(date) }} />}
                    <Field label={t('reason_label')} hint={t('ui_characters_used').replace('{used}', num(reqReason.length)).replace('{max}', num(100))}>{p => (
                        <TextArea {...p} placeholder={t('reason_placeholder')} value={reqReason} onChange={e => setReqReason(e.target.value)} maxLength={100} />
                    )}</Field>
                </form>
            </Dialog>

            <Dialog
                open={isApprovalOpen && !!selectedRequest}
                onClose={() => setIsApprovalOpen(false)}
                title={t('approve_deduction_title')}
                actions={<>
                    <Button onClick={() => setIsApprovalOpen(false)}>{t('cancel')}</Button>
                    <Button
                        variant="primary"
                        onClick={() => selectedRequest && action.run('approve', () => processAction(selectedRequest.id, 'APPROVED', daysToDeduct, deductionType))}
                        disabled={action.running}
                        busy={action.is('approve')}
                    >
                        {t('approve_button')}
                    </Button>
                </>}
            >
                {selectedRequest && (
                    <>
                        <p>{t('approve_dayoff_balance').replace('{name}', nameOf(selectedRequest)).replace('{days}', days(selectedRequest.user?.dayOffCredit || 0))}</p>
                        <Field label={t('days_to_deduct_label')}>{p => (
                            <TextInput {...p} type="number" autoComplete="off" inputMode="decimal" min="0" step="0.5" value={daysToDeduct} onChange={e => setDaysToDeduct(e.target.value)} />
                        )}</Field>
                        <Choice
                            legend={t('deduct_from_label')}
                            name="deduct-from"
                            value={deductionType}
                            onChange={setDeductionType}
                            options={[
                                { value: 'CREDIT', label: t('deduct_from_credit'), disabled: creditShort },
                                { value: 'SALARY', label: t('deduct_from_salary') },
                            ]}
                            warning={creditShort ? t('insufficient_credit') : undefined}
                        />
                    </>
                )}
            </Dialog>

            <Dialog
                open={isRejectOpen && !!selectedRequest}
                onClose={() => setIsRejectOpen(false)}
                title={t('confirm_rejection_title')}
                actions={<>
                    <Button onClick={() => setIsRejectOpen(false)}>{t('cancel')}</Button>
                    <Button
                        variant="danger"
                        onClick={() => selectedRequest && action.run('reject', () => processAction(selectedRequest.id, 'REJECTED'))}
                        disabled={action.running}
                        busy={action.is('reject')}
                    >
                        {t('reject_button')}
                    </Button>
                </>}
            >
                {selectedRequest && (
                    <>
                        <p>{t('reject_dayoff_question').replace('{name}', nameOf(selectedRequest))}</p>
                        <Field label={t('rejection_reason_label')} hint={t('ui_characters_used').replace('{used}', num(rejectionReason.length)).replace('{max}', num(300))}>{p => (
                            <TextArea {...p} placeholder={t('rejection_reason_placeholder')} value={rejectionReason} onChange={e => setRejectionReason(e.target.value)} maxLength={300} />
                        )}</Field>
                    </>
                )}
            </Dialog>
        </Page>
    )
}

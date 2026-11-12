'use client'

import { Fragment, useMemo, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useSession } from 'next-auth/react'
import useSWR from 'swr'
import { fetcher } from '@/lib/swr-fetcher'
import { useCan } from '@/lib/useCan'
import { useLanguage } from '@/context/LanguageContext'
import { useToast } from '@/context/ToastContext'
import { useCompany } from '@/context/CompanyContext'
import { ArrowsLeftRightIcon, BuildingsIcon, CalendarBlankIcon, ClockIcon, CoinsIcon, DevicesIcon, FingerprintIcon, HourglassIcon, InfoIcon, TimerIcon, UserIcon, WarningCircleIcon } from '@phosphor-icons/react/ssr'
import { Button, Card, DataList, Details, Dialog, DialogActions, EmptyState, Field, ItemTitle, ListCard, Page, PageHeader, PeriodBar, Section, Select, StatusBadge, Tabs, TextArea, TotalTiles, type Column, type StatusTone, type Tile } from '@/components/ui'
import type { SWRError } from '@/lib/swr-fetcher'
import { send, json } from './send'
import FaceTab from './FaceTab'
import RequestsTab, { AskPermissionDialog, ReportMissingDialog } from './RequestsTab'
import AddPunchDialog from './AddPunchDialog'
import { checkoutDate } from '@/lib/attendance/checkout-date'
import { lastDayOf, pad, useDayInAddress, useFigures, useMonthInAddress } from './period'
import ExceptionsTab from './ExceptionsTab'
import ImportTab from './ImportTab'
import NumbersTab from './NumbersTab'
import type { TranslationKey } from '@/lib/translations'
import { ActionStarts, useBusyAction } from '@/lib/useBusyAction'
import { useLive, useWantedChannels } from '@/components/LiveUpdates'
import { useArrivalsIn } from '@/components/useArrivals'
import { attendanceTopics } from '@/lib/live-updates'

/**
 * Punches (ATTENDANCE_PLAN.md Phase 0): what came in, from a terminal's
 * spreadsheet or added by hand, and who each terminal number is.
 *
 * Everyone sees their own punches; attendance.view_team shows other people's
 * at its scope. attendance.correct adds and withdraws them, never one's own,
 * and — held company-wide — imports files and maps employee numbers.
 *
 * Nothing here is edited: a wrong punch, or a whole wrong file, is withdrawn
 * and stays on record. Days and their deductions are worked out from these by
 * the engine; this screen shows the evidence.
 *
 * On the building blocks in parts (UI_PLAN.md §5 step 5), the frame first:
 * the page header, the tabs, and what the page says before them. What each
 * tab holds follows, one or two tabs at a time.
 *
 * Exceptions, Days and Punches draw themselves again as attendance changes
 * elsewhere, for whoever sees other people's (REALTIME_PLAN.md, part 4c),
 * at most every 30 seconds while check-ins keep coming (DESIGN.md §8).
 */

type Punch = {
    id: string; userId: string | null; name: string | null; hardwareUserId: string | null
    source: string; at: string; direction: 'IN' | 'OUT' | null; note: string | null; deviceName?: string | null
    placeName?: string | null; status?: string; flagReasons?: string[]
    voidedAt: string | null; voidReason: string | null
}
type Person = { id: string; name: string; teamLeaderId: string | null }

type Tab = 'exceptions' | 'days' | 'punches' | 'requests' | 'face' | 'import' | 'numbers'


export default function AttendancePage() {
    const { t } = useLanguage()
    const { data: session, status } = useSession()
    const params = useSearchParams()
    const router = useRouter()
    const pathname = usePathname()
    const p = useCan()
    const isSuperAdmin = session?.user?.role === 'SUPER_ADMIN'
    // A Super Admin's company is the company in view, picked in the top bar
    // as on every other page (DESIGN.md §5.3). A link that names one, from a
    // company's attendance settings or a face check's notice, is put in view
    // by the top bar, and taken out of the address; until then it's the one
    // asked about, so nothing is asked about the last company first.
    const { selectedCompanyId } = useCompany()
    const companyId = isSuperAdmin ? (params.get('companyId') ?? selectedCompanyId) : null
    const q = companyId ? `companyId=${encodeURIComponent(companyId)}&` : ''

    const correctsCompany = p.companyWide('attendance.correct')
    // The company's date, not the device's: around midnight, or for somebody
    // abroad, they differ, and every default date below starts from it (review on #12).
    // Asked once the session says who is asking: before, a Super Admin's request went without the company (review on #49).
    const { data: peopleBody, error: peopleError, isValidating: peopleRetrying, mutate: reloadPeople } = useSWR(status !== 'loading' && (!isSuperAdmin || companyId) ? `/api/attendance/people?${q}` : null, fetcher)
    const today: string | undefined = peopleBody?.data?.today
    // Whoever sees other people's attendance starts on what needs a decision (§13.1).
    const seesOthers = p.can('attendance.view_team')
    // Attendance as it changes, on the company's channel of its own (part 4c), the company in view's for
    // the Super Admin: only for whoever sees other people's, as the channel lets nobody else in.
    const viewer = session?.user ?? null
    const topics = viewer && seesOthers ? attendanceTopics(viewer, companyId, []) : []
    const tabs: Tab[] = [
        ...(seesOthers ? ['exceptions' as const] : []),
        'days', 'punches', 'requests',
        // Face verification (§9.5): only whoever decides it, company-wide.
        ...(p.companyWide('attendance.approve_face') ? ['face' as const] : []),
        ...(correctsCompany ? ['import' as const, 'numbers' as const] : []),
    ]
    // A link may open a tab (?tab=punches, from a notice about a check-in decided); one this person doesn't have falls back.
    // A tab picked by hand goes into the address too: the same notice's link followed again is then a change
    // of address, and opens its tab, where a pick held aside kept winning (review on #21).
    const linked = params.get('tab') as Tab | null
    const setTab = (k: Tab) => {
        const next = new URLSearchParams(params.toString())
        next.set('tab', k)
        router.replace(`${pathname}?${next.toString()}`, { scroll: false })
    }
    const tab: Tab = linked && tabs.includes(linked) ? linked : seesOthers ? 'exceptions' : 'days'

    const label: Record<Tab, TranslationKey> = { exceptions: 'exc_tab', days: 'day_tab_days', punches: 'punch_tab_punches', requests: 'req_tab', face: 'face_tab', import: 'punch_tab_import', numbers: 'punch_tab_numbers' }
    const header = <PageHeader title={t('attendance_title')} subtitle={t('punch_page_hint')} />
    // What the page says before its tabs, under its header (DESIGN.md §5.5).
    const before = (body: React.ReactNode) => <Page>{header}{body}</Page>

    // Not before the session says who is asking: a Super Admin's request went
    // without the company, and its refusal showed as an error (review on #49).
    if (status === 'loading') return before(<div className="ui-panel" role="status"><EmptyState icon={HourglassIcon} title={t('loading')} /></div>)
    if (isSuperAdmin && !companyId) return before(<div className="ui-panel"><EmptyState icon={BuildingsIcon} title={t('punch_pick_company')} /></div>)
    // Failed, it says so: everything below waits on the company's date, and a spinner would wait for good (review on #12).
    if (peopleError && !today) {
        return before(
            <div className="ui-panel">
                <EmptyState
                    icon={WarningCircleIcon}
                    title={t('attendance_load_failed')}
                    detail={(peopleError as SWRError).info?.error}
                    action={<Button busy={peopleRetrying} onClick={() => { void reloadPeople() }}>{t('try_again')}</Button>}
                />
            </div>,
        )
    }
    if (!today) return before(<div className="ui-panel" role="status"><EmptyState icon={HourglassIcon} title={t('loading')} /></div>)

    return (
        <Page>
            {header}
            {tabs.length > 1 && (
                <Tabs label={t('attendance_title')} idPrefix="attendance-tab" value={tab} onChange={setTab}
                    items={tabs.map(k => ({ value: k, label: t(label[k]), controls: 'attendance-panel' }))} />
            )}
            {/* Another company, picked without leaving the page, starts afresh: the tabs' dates were the last
                company's, from its own calendar, and a file chosen for import was meant for it (review on #13). */}
            <div role="tabpanel" id="attendance-panel" className="ui-tab-panel" aria-labelledby={`attendance-tab-${tab}`}>
                <Fragment key={companyId ?? ''}>
                    {tab === 'exceptions' && today && seesOthers && <ExceptionsTab q={q} companyId={companyId} today={today} topics={topics} />}
                    {tab === 'days' && today && <DaysTab q={q} companyId={companyId} today={today} topics={topics} />}
                    {tab === 'punches' && today && <PunchesTab q={q} companyId={companyId} today={today} topics={topics} />}
                    {tab === 'requests' && today && <RequestsTab q={q} companyId={companyId} today={today} />}
                    {tab === 'face' && <FaceTab q={q} />}
                    {tab === 'import' && correctsCompany && <ImportTab q={q} companyId={companyId} />}
                    {tab === 'numbers' && correctsCompany && <NumbersTab q={q} companyId={companyId} />}
                </Fragment>
            </div>
        </Page>
    )
}

// --- Days ------------------------------------------------------------------------

type RuleOutcome = { minutes: number; days: number; occurrence: number; note: string | null }
type Day = {
    id: string; userId: string; name: string; date: string; status: string
    firstIn: string | null; lastOut: string | null; workedMinutes: number
    lateMinutes: number; earlyLeaveMinutes: number; overtimeMinutes: number; excusedMinutes: number
    expectedStartMinutes: number | null; expectedEndMinutes: number | null
    deductionDays: number; deductionMinor: number | null; overtimeStatus: string; overtimeMinor: number | null
    breakdown: { lateness: RuleOutcome; earlyLeave: RuleOutcome; absenceDays: number; unpriced: string | null; holiday: string | null; excusedAbsence?: boolean }
}

/** What a day's status means, which decides its badge's colour (DESIGN.md §2.3); the rest are neutral. */
const STATUS_TONE: Record<string, StatusTone> = {
    PRESENT: 'good', ABSENT: 'problem', SUSPENDED: 'problem', INCOMPLETE: 'waiting',
    WORKED_REST_DAY: 'progress', WORKED_HOLIDAY: 'progress',
}

/**
 * Days (§13.3): one's own, or everyone's this person sees, over a month.
 *
 * On the building blocks (UI_PLAN.md §5 step 5, Attendance part 3, PR 149):
 * the month picked under the page header and kept in the address, with whose
 * days beside it (DESIGN.md §5.3); one person's month so far as total tiles;
 * and the days as a list, a table on computers and a card for each on phones
 * (§5.4), in the page's language throughout.
 */
function DaysTab({ q, companyId, today, topics }: { q: string; companyId: string | null; today: string; topics: string[] }) {
    const { t } = useLanguage()
    const { digits, num, amount, minutes, days: daysWord, clock } = useFigures()
    const { showToast } = useToast()
    const p = useCan()
    const seesOthers = p.can('attendance.view_team')
    const correctsCompany = p.companyWide('attendance.correct')
    const { year, monthNumber, month, monthName, setPeriod, months, years } = useMonthInAddress(today)
    const [who, setWho] = useState('')
    const { data: peopleBody } = useSWR(seesOthers ? `/api/attendance/people?${q}` : null, fetcher)
    const people: Person[] = useMemo(() => peopleBody?.data?.people ?? [], [peopleBody])
    const url = `/api/attendance/days?${q}from=${month}-01&to=${lastDayOf(month)}${who ? `&userId=${encodeURIComponent(who)}` : ''}`
    const { data: body, error, isValidating, mutate } = useSWR(url, fetcher)
    const days: Day[] | null = body ? body.data?.days ?? [] : null
    const daysTruncated: boolean = !!body?.data?.truncated
    // Drawn again as attendance changes, while open (part 4c). A day someone else changed is tinted;
    // working the month out again is the person's own.
    useWantedChannels(topics)
    useLive('attendance', () => { void mutate() })
    const arrivals = useArrivalsIn('attendance', url, days ?? [], d => d.id)
    const action = useBusyAction(arrivals.own)
    const rules: Rules | null = body?.data?.rules ?? null
    const { data: session } = useSession()
    const me = session?.user?.id
    // One person's month — one's own, or the person picked — gets its summary (§13.3).
    const onePerson = !seesOthers || !!who
    const oneself = !seesOthers || who === me
    // Everyone's list says whose each day is.
    const everyone = seesOthers && !who
    const { data: balanceBody, mutate: refreshBalance } = useSWR(oneself && me && !companyId ? `/api/attendance/permissions/balance?month=${month}` : null, fetcher)
    const [asking, setAsking] = useState<Parameters<typeof AskPermissionDialog>[0]['initial'] | null>(null)
    const [reporting, setReporting] = useState<string | null>(null)

    const recompute = () => action.run('recompute', async () => {
        const r = await send('/api/attendance/recompute', json('POST', { ...(companyId ? { companyId } : {}), month }), t('punch_failed'))
        if (!r.ok) return showToast(r.error, 'error')
        showToast(r.body?.locked ? t('day_recompute_locked') : t('day_recomputed'), r.body?.locked ? 'info' : 'success')
        arrivals.saved()
        void mutate()
    })

    const ruleNote = (label: TranslationKey, r: RuleOutcome) => {
        if (!r.note || r.note === 'CHARGED' || r.note === 'OFF') return null
        const key = ({ WITHIN_GRACE: 'day_note_grace', FREE_OCCURRENCE: 'day_note_free', ESCALATED: 'day_note_escalated', CAPPED: 'day_note_capped' } as Record<string, TranslationKey>)[r.note]
        return key ? `${t(label)}: ${t(key).replace('{n}', num(r.occurrence))}` : null
    }
    // What explains a day's status, a line each: run together with a dot, one
    // beside Arabic digits read as a zero.
    const notes = (d: Day) => [
        d.breakdown.holiday,
        ruleNote('day_late', d.breakdown.lateness),
        ruleNote('day_early', d.breakdown.earlyLeave),
        d.breakdown.unpriced ? t(({ INCOMPLETE: 'day_unpriced_incomplete', NO_POLICY: 'day_unpriced_no_policy', NO_SALARY: 'day_unpriced_no_salary' } as Record<string, TranslationKey>)[d.breakdown.unpriced] ?? 'day_unpriced_no_policy') : null,
        d.overtimeStatus === 'PENDING' ? t('day_overtime_pending') : d.overtimeStatus === 'REJECTED' ? t('day_overtime_rejected') : d.overtimeStatus === 'NOT_COUNTED' ? t('day_overtime_short') : null,
        d.excusedMinutes > 0 ? t('day_excused').replace('{n}', num(d.excusedMinutes)) : null,
        d.breakdown.excusedAbsence ? t('day_absence_excused') : null,
    ].filter((n): n is string => !!n)
    const totalMinor = (days ?? []).reduce((sum, d) => sum + (d.deductionMinor ?? 0), 0)
    const showsMoney = (days ?? []).some(d => d.deductionMinor !== null)
    const hhmm = (m: number) => `${pad(Math.floor(m / 60) % 24)}:${pad(m % 60)}`
    const askFor = (d: Day) => d.status === 'PRESENT' && d.expectedStartMinutes !== null && d.expectedEndMinutes !== null && (
        d.lateMinutes > 0 && d.firstIn ? { date: d.date, type: 'LATE_ARRIVAL' as const, start: hhmm(d.expectedStartMinutes), end: d.firstIn.slice(11, 16) }
            : d.earlyLeaveMinutes > 0 && d.lastOut ? { date: d.date, type: 'EARLY_LEAVE' as const, start: d.lastOut.slice(11, 16), end: hhmm(d.expectedEndMinutes) }
                : null
    )

    const listTitle = t('day_list_title').replace('{month}', monthName)
    const dateText = (date: string) => new Date(`${date}T00:00:00Z`).toLocaleDateString(digits, { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })
    const time = (at: string | null) => (at ? <bdi>{clock(at)}</bdi> : '—')
    const mins = (n: number) => (n > 0 ? minutes(n) : '—')
    const badge = (d: Day) => <StatusBadge tone={STATUS_TONE[d.status] ?? 'neutral'}>{t(`audit_value_${d.status}` as TranslationKey)}</StatusBadge>
    const deduction = (d: Day) => (
        <>
            {d.deductionMinor ? <bdi>{amount(d.deductionMinor)}</bdi> : '—'}
            {d.deductionDays > 0 && <div className="ui-item-detail">{daysWord(d.deductionDays)}</div>}
        </>
    )
    // What one can ask about one's own day: permission for the minutes, or the punch that's missing.
    const asks = (d: Day) => {
        if (d.userId !== me) return null
        const ask = askFor(d)
        const missing = d.status === 'INCOMPLETE'
        if (!ask && !missing) return null
        return (
            <>
                {ask && <Button size="sm" onClick={() => setAsking(ask)}>{t('req_ask_permission')}</Button>}
                {missing && <Button size="sm" onClick={() => setReporting(checkoutDate(d.date, d.expectedEndMinutes))}>{t('req_report_missing')}</Button>}
            </>
        )
    }
    const columns: Column<Day>[] = [
        { key: 'date', header: t('punch_date'), cell: d => <ItemTitle title={dateText(d.date)} detail={everyone ? d.name : undefined} /> },
        { key: 'in', header: t('punch_in'), cell: d => time(d.firstIn) },
        { key: 'out', header: t('punch_out'), cell: d => time(d.lastOut) },
        { key: 'late', header: t('day_late'), align: 'end', cell: d => mins(d.lateMinutes) },
        { key: 'early', header: t('day_early'), align: 'end', cell: d => mins(d.earlyLeaveMinutes) },
        { key: 'overtime', header: t('day_overtime'), align: 'end', cell: d => mins(d.overtimeMinutes) },
        ...(showsMoney ? [{ key: 'deduction', header: t('day_deduction'), align: 'end' as const, cell: deduction }] : []),
        // The status and what can be done at the end (DESIGN.md §5.4).
        { key: 'status', header: t('day_status'), cell: d => <>{badge(d)}{notes(d).map(n => <div key={n} className="ui-item-detail">{n}</div>)}</> },
        ...(oneself ? [{ key: 'actions', header: t('actions_label'), hideHeader: true, align: 'end' as const, cell: asks }] : []),
    ]
    const card = (d: Day) => (
        <ListCard
            title={dateText(d.date)}
            status={badge(d)}
            details={[
                ...(everyone ? [{ icon: UserIcon, text: d.name }] : []),
                // One line, as a span: the line spaces its pieces apart (found in the interface audit, PR 149).
                ...(d.firstIn || d.lastOut ? [{ icon: ClockIcon, text: <span>{t('punch_in')} {time(d.firstIn)}, {t('punch_out')} {time(d.lastOut)}</span> }] : []),
                ...(d.lateMinutes > 0 ? [{ icon: TimerIcon, text: `${t('day_late')}: ${minutes(d.lateMinutes)}` }] : []),
                ...(d.earlyLeaveMinutes > 0 ? [{ icon: TimerIcon, text: `${t('day_early')}: ${minutes(d.earlyLeaveMinutes)}` }] : []),
                ...(d.overtimeMinutes > 0 ? [{ icon: TimerIcon, text: `${t('day_overtime')}: ${minutes(d.overtimeMinutes)}` }] : []),
                // The amount with its days, as the table has them, to check against the policy (review on PR 149).
                ...(showsMoney && (d.deductionMinor || d.deductionDays > 0) ? [{ icon: CoinsIcon, text: <span>{t('day_deduction')}: {d.deductionMinor ? <><bdi>{amount(d.deductionMinor)}</bdi>{d.deductionDays > 0 && ` (${daysWord(d.deductionDays)})`}</> : daysWord(d.deductionDays)}</span> }] : []),
                ...notes(d).map(n => ({ icon: InfoIcon, text: n })),
            ]}
            foot={asks(d)}
        />
    )

    return (
        <>
            <PeriodBar>
                <Field label={t('day_month')}>{f => (
                    <Select {...f} value={String(monthNumber)} onChange={e => setPeriod(year, Number(e.target.value))} options={months} />
                )}</Field>
                <Field label={t('year')}>{f => (
                    <Select {...f} value={String(year)} onChange={e => setPeriod(Number(e.target.value), monthNumber)} options={years} />
                )}</Field>
                {seesOthers && (
                    <Field label={t('punch_person')}>{f => (
                        <Select {...f} value={who} onChange={e => setWho(e.target.value)} options={[{ value: '', label: t('punch_everyone') }, ...people.map(x => ({ value: x.id, label: x.name }))]} />
                    )}</Field>
                )}
            </PeriodBar>

            {/* The month so far, not from a list cut short. */}
            {days && days.length > 0 && !daysTruncated && (
                onePerson ? <MonthSummary days={days} rules={rules} balance={oneself ? balanceBody?.data ?? null : null} />
                    : showsMoney && <TotalTiles items={[{ label: t('day_total'), value: amount(totalMinor) }]} />
            )}

            <Section title={listTitle} action={correctsCompany ? <Button size="sm" onClick={() => { void recompute() }} disabled={action.running} busy={action.is('recompute')}>{t('day_recompute')}</Button> : undefined}>
                <p className="ui-hint">{t('day_hint')}</p>
                {daysTruncated && <Card tone="waiting"><p role="status">{t('day_truncated').replace('{n}', num(body?.data?.limit ?? 0))}</p></Card>}
                {error ? (
                    <div className="ui-panel">
                        <EmptyState icon={WarningCircleIcon} title={t('day_load_failed')} detail={(error as SWRError).info?.error}
                            action={<Button busy={isValidating} onClick={() => { void mutate() }}>{t('try_again')}</Button>} />
                    </div>
                ) : days === null ? (
                    <div className="ui-panel" role="status"><EmptyState icon={HourglassIcon} title={t('loading')} /></div>
                ) : (
                    <DataList caption={listTitle} columns={columns} rows={days} rowKey={d => d.id} arrived={arrivals.arrived} card={card}
                        empty={<EmptyState icon={CalendarBlankIcon} title={t('day_none')} />} />
                )}
            </Section>
            {asking && <AskPermissionDialog today={today} initial={asking} onClose={() => setAsking(null)} onDone={() => { setAsking(null); void refreshBalance() }} />}
            {reporting && <ReportMissingDialog today={today} initial={{ date: reporting, direction: 'OUT' }} onClose={() => setReporting(null)} onDone={() => setReporting(null)} />}
        </>
    )
}

type Rules = { lateness: { enabled: boolean; freePerMonth: number }; earlyLeave: { enabled: boolean; freePerMonth: number } }
type Balance = { enabled: boolean; remainingMinutes: number; allowanceMinutes: number; carriedMinutes: number }
const COUNTED = new Set(['FREE_OCCURRENCE', 'CHARGED', 'ESCALATED', 'CAPPED'])

/**
 * One person's month so far (§13.3), as total tiles above the list: deductions
 * to date, lateness and early leave against the free allowance, absences,
 * overtime pay, and — for one's own — the permission hours left.
 */
function MonthSummary({ days, rules, balance }: { days: Day[]; rules: Rules | null; balance: Balance | null }) {
    const { t } = useLanguage()
    const { num, amount, minutes, days: daysWord } = useFigures()
    const deducted = days.reduce((s, d) => s + (d.deductionMinor ?? 0), 0)
    const deductedDays = Math.round(days.reduce((s, d) => s + d.deductionDays, 0) * 10_000) / 10_000
    const overtimeMinor = days.reduce((s, d) => s + (d.overtimeMinor ?? 0), 0)
    const hidesMoney = days.every(d => d.deductionMinor === null)
    const lates = days.filter(d => COUNTED.has(d.breakdown.lateness.note ?? ''))
    const earlies = days.filter(d => COUNTED.has(d.breakdown.earlyLeave.note ?? ''))
    const absences = days.filter(d => d.status === 'ABSENT' && !d.breakdown.excusedAbsence).length
    const freeLine = (used: number, rule: { enabled: boolean; freePerMonth: number } | undefined) =>
        rule?.enabled && rule.freePerMonth > 0 ? t('sum_free_used').replace('{used}', num(Math.min(used, rule.freePerMonth))).replace('{free}', num(rule.freePerMonth)) : undefined
    const items: Tile[] = [
        { label: t('sum_deductions'), value: hidesMoney ? daysWord(deductedDays) : amount(deducted), note: hidesMoney ? undefined : daysWord(deductedDays) },
        { label: t('sum_lates'), value: num(lates.length), note: freeLine(lates.filter(d => d.breakdown.lateness.note === 'FREE_OCCURRENCE').length, rules?.lateness) },
        { label: t('sum_early'), value: num(earlies.length), note: freeLine(earlies.filter(d => d.breakdown.earlyLeave.note === 'FREE_OCCURRENCE').length, rules?.earlyLeave) },
        { label: t('sum_absences'), value: num(absences) },
        ...(!hidesMoney && overtimeMinor > 0 ? [{ label: t('sum_overtime'), value: amount(overtimeMinor) }] : []),
        ...(balance?.enabled ? [{ label: t('sum_permission_left'), value: minutes(balance.remainingMinutes), note: t('sum_of_total').replace('{n}', num(balance.allowanceMinutes + balance.carriedMinutes)) }] : []),
    ]
    return <TotalTiles items={items} />
}

// --- Punches -------------------------------------------------------------------

/** The Person select's choice for the punches whose number is nobody's yet. */
const UNMATCHED = 'unmatched'
/** What a punch that doesn't count, or no longer does, is, as a badge (DESIGN.md §2.3). */
const PUNCH_BADGE: Record<string, { tone: StatusTone; label: TranslationKey }> = {
    FLAGGED: { tone: 'waiting', label: 'punch_badge_FLAGGED' },
    PENDING_DEVICE: { tone: 'waiting', label: 'punch_badge_PENDING_DEVICE' },
    REJECTED: { tone: 'problem', label: 'punch_badge_REJECTED' },
}

/**
 * Punches (§13.2): what came in, as it came in. A wrong one is withdrawn,
 * never edited.
 *
 * On the building blocks (UI_PLAN.md §5 step 5, Attendance part 4, PR 150):
 * the month picked under the page header, the one Days is about, with a day
 * of it and whose punches beside it (DESIGN.md §5.3); the punches as a list,
 * a table on computers and a card for each on phones (§5.4); and withdrawing
 * one in the building blocks' dialog, which asks why.
 */
function PunchesTab({ q, companyId, today, topics }: { q: string; companyId: string | null; today: string; topics: string[] }) {
    const { t } = useLanguage()
    const { digits, num } = useFigures()
    const { showToast } = useToast()
    const p = useCan()
    const { data: session } = useSession()
    const me = session?.user?.id
    const seesOthers = p.can('attendance.view_team')
    const correctsCompany = p.companyWide('attendance.correct')

    // The month Days is about, and a day of it, kept in the address so a
    // reload or a link opens on them. Whose punches is picked here.
    const period = useMonthInAddress(today)
    const { monthNumber, year, month, monthName, setPeriod, months, years } = period
    const { day, setDay, days, dayName } = useDayInAddress(period)
    const [who, setWho] = useState('')
    const [withdrawing, setWithdrawing] = useState<Punch | null>(null)
    const [reason, setReason] = useState('')
    const [reasonError, setReasonError] = useState<string | undefined>()
    const [adding, setAdding] = useState(false)

    const { data: peopleBody } = useSWR(seesOthers || p.can('attendance.correct') ? `/api/attendance/people?${q}` : null, fetcher)
    const people: Person[] = useMemo(() => peopleBody?.data?.people ?? [], [peopleBody])
    const from = day ? `${month}-${pad(day)}` : `${month}-01`
    const to = day ? from : lastDayOf(month)
    const listUrl = `/api/attendance/punches?${q}from=${from}&to=${to}${who === UNMATCHED ? '&unmatched=1' : who ? `&userId=${encodeURIComponent(who)}` : ''}`
    const { data: body, error, isValidating, mutate } = useSWR(listUrl, fetcher)
    const punches: Punch[] | null = body ? body.data?.punches ?? [] : null
    const truncated: boolean = !!body?.data?.truncated
    // Drawn again as attendance changes, while open (part 4c). A punch someone else added or changed is
    // tinted; adding or withdrawing one is the person's own.
    useWantedChannels(topics)
    useLive('attendance', () => { void mutate() })
    const arrivals = useArrivalsIn('attendance', listUrl, punches ?? [], x => x.id)
    const action = useBusyAction(arrivals.own)

    const leaderOf = useMemo(() => new Map(people.map(x => [x.id, x.teamLeaderId])), [people])
    const mayCorrect = (punch: Punch) => !punch.voidedAt && (punch.userId
        ? p.canFor('attendance.correct', punch.userId, leaderOf.get(punch.userId) ?? null)
        : correctsCompany)
    // Nobody withdraws their own.
    const mayWithdraw = (punch: Punch) => mayCorrect(punch) && punch.userId !== me
    // Whose each is, when the list has other people's.
    const showsWhose = seesOthers || who === UNMATCHED

    const openWithdraw = (punch: Punch) => { setReason(''); setReasonError(undefined); setWithdrawing(punch) }
    // Not while it works: closing then would hide the answer.
    const closeWithdraw = () => { if (!action.running) setWithdrawing(null) }
    const withdraw = (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault()
        if (!withdrawing) return
        const form = e.currentTarget
        if (reason.trim().length < 3) {
            setReasonError(t('punch_reason_required'))
            requestAnimationFrame(() => form.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus())
            return
        }
        void action.run('withdraw', async () => {
            const r = await send(`/api/attendance/punches/${withdrawing.id}/void`, json('POST', { reason: reason.trim() }), t('punch_failed'))
            // Refused, it stays open with the reason typed, to try again.
            if (!r.ok) return showToast(r.error, 'error')
            showToast(t('punch_withdrawn'), 'success')
            setWithdrawing(null)
            arrivals.saved()
            await mutate()
        })
    }

    const whoOptions = [
        { value: '', label: t('punch_everyone') },
        ...(correctsCompany ? [{ value: UNMATCHED, label: t('punch_no_person') }] : []),
        ...(seesOthers ? people.map(x => ({ value: x.id, label: x.name })) : []),
    ]
    const listTitle = dayName ? t('punch_list_title_day').replace('{day}', dayName) : t('punch_list_title').replace('{period}', monthName)
    // The punch's day and time on the company's clock, as it came in.
    const when = (x: Punch) => new Date(`${x.at.slice(0, 16)}:00Z`).toLocaleString(digits, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'UTC' })
    const whose = (x: Punch) => x.name ?? t('punch_number').replace('{code}', x.hardwareUserId ?? '')
    const direction = (x: Punch) => (x.direction === 'IN' ? t('punch_in') : x.direction === 'OUT' ? t('punch_out') : t('punch_direction_unknown'))
    const source = (x: Punch) => (x.source === 'AGENT' ? t('punch_source_terminal').replace('{name}', x.deviceName ?? '—')
        // From the app, with the place it was at when there's one (found in the interface audit, PR 150).
        : x.source === 'MOBILE' ? (x.placeName ? t('punch_source_app').replace('{place}', x.placeName) : t('punch_source_app_only'))
            : t(x.source === 'MANUAL' ? 'punch_source_manual' : 'punch_source_import'))
    // One that doesn't count yet, or won't, or no longer does: a badge, and why below it (§9.6).
    const badge = (x: Punch) => {
        if (x.voidedAt) return <StatusBadge tone="neutral">{t('punch_badge_WITHDRAWN')}</StatusBadge>
        const b = x.status ? PUNCH_BADGE[x.status] : undefined
        return b ? <StatusBadge tone={b.tone}>{t(b.label)}</StatusBadge> : null
    }
    const notes = (x: Punch) => [
        x.voidedAt ? x.voidReason : null,
        !x.voidedAt && x.status && PUNCH_BADGE[x.status] ? t(`punch_status_${x.status}` as TranslationKey) : null,
        !x.voidedAt && (x.flagReasons ?? []).length > 0 ? (x.flagReasons ?? []).map(r => t(`att_flag_${r}` as TranslationKey)).join(', ') : null,
        x.note,
    ].filter((n): n is string => !!n)
    const withdrawButton = (x: Punch) => (mayWithdraw(x) ? <Button size="sm" onClick={() => openWithdraw(x)}>{t('punch_withdraw')}</Button> : null)
    const columns: Column<Punch>[] = [
        { key: 'when', header: t('punch_time'), cell: x => <ItemTitle title={when(x)} detail={showsWhose ? whose(x) : undefined} /> },
        { key: 'direction', header: t('punch_direction'), cell: direction },
        { key: 'source', header: t('punch_source'), cell: source },
        // The status and what can be done at the end (DESIGN.md §5.4).
        { key: 'status', header: t('day_status'), cell: x => <>{badge(x)}{notes(x).map(n => <div key={n} className="ui-item-detail">{n}</div>)}</> },
        ...(p.can('attendance.correct') ? [{ key: 'actions', header: t('actions_label'), hideHeader: true, align: 'end' as const, cell: withdrawButton }] : []),
    ]
    const card = (x: Punch) => (
        <ListCard
            title={when(x)}
            status={badge(x) ?? undefined}
            details={[
                ...(showsWhose ? [{ icon: UserIcon, text: whose(x) }] : []),
                { icon: ArrowsLeftRightIcon, text: direction(x) },
                { icon: DevicesIcon, text: source(x) },
                ...notes(x).map(n => ({ icon: InfoIcon, text: n })),
            ]}
            foot={withdrawButton(x) ?? undefined}
        />
    )

    return (
        <>
            <PeriodBar>
                <Field label={t('day_month')}>{f => (
                    <Select {...f} value={String(monthNumber)} onChange={e => setPeriod(year, Number(e.target.value))} options={months} />
                )}</Field>
                <Field label={t('year')}>{f => (
                    <Select {...f} value={String(year)} onChange={e => setPeriod(Number(e.target.value), monthNumber)} options={years} />
                )}</Field>
                <Field label={t('punch_day')}>{f => (
                    <Select {...f} value={day ? String(day) : ''} onChange={e => setDay(e.target.value ? Number(e.target.value) : null)} options={days} />
                )}</Field>
                {(seesOthers || correctsCompany) && (
                    <Field label={t('punch_person')}>{f => (
                        <Select {...f} value={who} onChange={e => setWho(e.target.value)} options={whoOptions} />
                    )}</Field>
                )}
            </PeriodBar>

            <Section title={listTitle} action={p.can('attendance.correct') ? <Button variant="primary" size="sm" onClick={() => setAdding(true)}>{t('punch_add')}</Button> : undefined}>
                {truncated && <Card tone="waiting"><p role="status">{t('punch_truncated').replace('{n}', num(body?.data?.limit ?? 0))}</p></Card>}
                {error ? (
                    <div className="ui-panel">
                        <EmptyState icon={WarningCircleIcon} title={t('punch_load_failed')} detail={(error as SWRError).info?.error}
                            action={<Button busy={isValidating} onClick={() => { void mutate() }}>{t('try_again')}</Button>} />
                    </div>
                ) : punches === null ? (
                    <div className="ui-panel" role="status"><EmptyState icon={HourglassIcon} title={t('loading')} /></div>
                ) : (
                    <DataList caption={listTitle} columns={columns} rows={punches} rowKey={x => x.id} arrived={arrivals.arrived} card={card}
                        empty={<EmptyState icon={FingerprintIcon} title={day ? t('punch_none_day') : t('punch_none')} />} />
                )}
            </Section>

            {/* Adding one is the person's own, said to the list as it starts. */}
            <ActionStarts.Provider value={arrivals.own}>
                {adding && (
                    <AddPunchDialog
                        today={today}
                        companyId={companyId}
                        people={people.filter(x => x.id !== me && p.canFor('attendance.correct', x.id, x.teamLeaderId))}
                        onClose={() => setAdding(false)}
                        onAdded={() => { setAdding(false); arrivals.saved(); void mutate() }}
                    />
                )}
            </ActionStarts.Provider>

            {/* Withdrawing asks why: the punch stays on record, with its reason. */}
            <Dialog open={withdrawing !== null} onClose={closeWithdraw} title={t('punch_withdraw')}>
                {withdrawing && (
                    <form className="ui-form" noValidate onSubmit={withdraw}>
                        {/* Which punch, so the one meant is the one withdrawn (found in the interface audit, PR 150). */}
                        <Details items={[
                            ...(showsWhose ? [{ label: t('punch_person'), value: whose(withdrawing) }] : []),
                            { label: t('punch_time'), value: when(withdrawing) },
                            { label: t('punch_direction'), value: direction(withdrawing) },
                        ]} />
                        <p>{t('punch_withdraw_hint')}</p>
                        <Field label={t('punch_reason')} hint={t('punch_reason_example')} error={reasonError}>{f => (
                            <TextArea {...f} name="reason" value={reason} disabled={action.running}
                                onChange={e => { setReason(e.target.value); setReasonError(undefined) }} />
                        )}</Field>
                        <DialogActions>
                            <Button onClick={closeWithdraw} disabled={action.running}>{t('cancel')}</Button>
                            <Button variant="danger" type="submit" disabled={action.running} busy={action.is('withdraw')}>
                                {t('punch_withdraw')}
                            </Button>
                        </DialogActions>
                    </form>
                )}
            </Dialog>
        </>
    )
}

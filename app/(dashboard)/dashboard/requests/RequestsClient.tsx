'use client'
import { useEffect, useId, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowUUpLeftIcon, CalendarBlankIcon, CalendarIcon, CheckIcon, CircleHalfIcon, ClockIcon, DeviceMobileIcon, EyeIcon, MapPinIcon, PlayIcon, PlusIcon, ProhibitIcon, ShapesIcon, TrashIcon, TrayIcon, UserFocusIcon, UserIcon, XIcon } from '@phosphor-icons/react/ssr'
import { useLanguage } from '@/context/LanguageContext'
import { useToast } from '@/context/ToastContext'
import { useCompany } from '@/context/CompanyContext'
import { useModules } from '@/lib/useModules'
import { useBusyAction } from '@/lib/useBusyAction'
import { useFadingHighlight } from '@/lib/useFadingHighlight'
import { countOf } from '@/lib/plural'
import { spansDays, workDays } from '@/lib/day-off-range'
import { DAY_OFF_TYPE_LABEL } from '@/lib/day-off-types'
import type { TranslationKey } from '@/lib/translations'
import { REQUEST_KINDS, type FeedRow, type RequestKind, type RequestsShow, type RequestsTab } from '@/lib/requests/kinds'
import SafeDate from '@/components/SafeDate'
import DateRangePicker from '@/components/DateRangePicker'
import { DayOffCreditDonut } from '@/components/DayOffCreditDonut'
import { FlaggedFaceModal } from '@/components/FacePhoto'
import { googleMapsLink } from '@/lib/attendance/geo'
import { withChanges } from '@/components/filters/address'
import { useListAddress, useSearchField } from '@/components/filters/useListAddress'
import { useEmployeeOptions } from '@/components/filters/useEmployeeOptions'
import {
    Button, Choice, DataList, Details, Dialog, DialogActions, EmptyState, Field, FilterBar, ItemTitle, ListCard, Page, PageHeader, Pager, Person,
    Row, Rows, RowMenu, SearchInput, Section, Select, StatusBadge, TabLinks, TextArea, TextInput, visibleRow, type Column, type StatusTone,
} from '@/components/ui'
import { AskDayOff, DecideDayOff } from './DayOffDialogs'
import {
    AskPermission, PERMISSION_TYPE_LABEL, RejectAttendance, ReportMissingPunch, RevokePhone, WithdrawAttendance, clockText, decideAttendance, permissionDay, punchDay, punchTime,
} from './AttendanceDialogs'

/**
 * A request's status, as a badge: an internal request's, or a day off's or
 * permission hours' once decided. Withdrawn is the asker's own doing, and no
 * problem (§2.3, part 3a). A check-in phone approved is in use, until it's
 * revoked (part 4b).
 */
const STATUS: Record<string, { tone: StatusTone; label: TranslationKey }> = {
    PENDING: { tone: 'waiting', label: 'status_pending' },
    IN_PROGRESS: { tone: 'progress', label: 'status_in_progress' },
    COMPLETED: { tone: 'good', label: 'status_completed' },
    APPROVED: { tone: 'good', label: 'status_approved' },
    REJECTED: { tone: 'problem', label: 'status_rejected' },
    CANCELLED: { tone: 'neutral', label: 'status_withdrawn' },
    ACTIVE: { tone: 'good', label: 'req_phone_in_use' },
    REVOKED: { tone: 'problem', label: 'requests_phone_revoked' },
    WITHDRAWN: { tone: 'neutral', label: 'status_withdrawn' },
    // A flagged check-in waits, then is accepted, and counts, or rejected (part 4c).
    FLAGGED: { tone: 'waiting', label: 'status_pending' },
    ACCEPTED: { tone: 'good', label: 'requests_flagged_accepted' },
}

/** A phone revoked because a new one of theirs was approved: no problem. */
const REPLACED: { tone: StatusTone; label: TranslationKey } = { tone: 'neutral', label: 'requests_phone_replaced' }

/** Each kind's name, in the filter, on its rows, and in New request. */
const KIND_LABEL: Record<RequestKind, TranslationKey> = {
    internal: 'requests_kind_internal',
    // A kind, "Day off", not the side bar's name for its page (found in the browser).
    dayOff: 'requests_kind_day_off',
    permission: 'requests_kind_permission',
    missingPunch: 'requests_kind_missing_punch',
    overtime: 'requests_kind_overtime',
    phone: 'requests_kind_phone',
    flagged: 'requests_kind_flagged',
}

/** A missing punch's name: which punch, if they said (§2.3, part 3b). */
const MISSING_LABEL: Record<string, TranslationKey> = { IN: 'requests_missing_in', OUT: 'requests_missing_out' }

/** An internal request's next step, for whoever may decide it. */
const NEXT: Record<string, { to: string; label: TranslationKey; icon: typeof PlayIcon }> = {
    PENDING: { to: 'IN_PROGRESS', label: 'requests_start', icon: PlayIcon },
    IN_PROGRESS: { to: 'COMPLETED', label: 'requests_mark_done', icon: CheckIcon },
}

/** The server's own checks on a new request (lib/validations/request.schema.ts). */
const TITLE = { min: 3, max: 100 }
const DETAILS = { min: 10, max: 1000 }

interface RequestsClientProps {
    rows: FeedRow[]
    total: number
    page: number
    totalPages: number
    /** The kinds this person has on this tab. */
    kinds: RequestKind[]
    tabs: Record<RequestsTab, boolean>
    tab: RequestsTab
    show: RequestsShow
    superAdmin: boolean
    /** Whether their role may ask for leave, in a company with Day off (§2.3, part 2c). */
    mayAskDayOff?: boolean
    /** Their day off balance, on Mine, for whoever may ask for leave. */
    credit?: { remaining: number; used: number } | null
    /** Whether they have attendance of their own: to ask permission hours of, and report a missing punch in (§2.3, part 3). */
    mayAskAttendance?: boolean
    /** Today, as the company's calendar has it, for whoever has attendance of their own (found by Codex on PR 131). */
    attendanceToday?: string | null
    /** What's left of this month's permission hours, in minutes, on Mine, while the policy allows them. */
    allowance?: { left: number; total: number; pending: number; carried: number } | null
}

export default function RequestsClient({
    rows, total, page, totalPages, kinds, tabs, tab, show, superAdmin, mayAskDayOff = false, credit = null, mayAskAttendance = false, attendanceToday = null, allowance = null,
}: RequestsClientProps) {
    const { t, locale } = useLanguage()
    const { showToast } = useToast()
    const modules = useModules()
    const router = useRouter()
    const action = useBusyAction()
    const { picked, listed, go } = useListAddress('/dashboard/requests')
    const review = tab === 'review'
    const employeeOptions = useEmployeeOptions(review)
    const { query, setQuery, clear } = useSearchField(picked.get('search') || '', go)

    // The Super Admin's picked company, which the server reads from the address.
    const { selectedCompanyId } = useCompany()
    useEffect(() => {
        if (superAdmin && (selectedCompanyId ?? '') !== (listed.get('companyId') ?? '')) go({ companyId: selectedCompanyId ?? '' })
    }, [superAdmin, selectedCompanyId, listed, go])

    const [viewing, setViewing] = useState<FeedRow | null>(null)
    const [deleting, setDeleting] = useState<FeedRow | null>(null)
    const [asking, setAsking] = useState(false)
    const [deciding, setDeciding] = useState<{ row: FeedRow; decision: 'APPROVED' | 'REJECTED' } | null>(null)
    const [rejecting, setRejecting] = useState<FeedRow | null>(null)
    const [withdrawing, setWithdrawing] = useState<FeedRow | null>(null)
    const [revoking, setRevoking] = useState<FeedRow | null>(null)
    // A flagged check-in whose face check failed, open beside the reference photo (§2.3, part 4c).
    const [faceOf, setFaceOf] = useState<FeedRow | null>(null)

    // The request a notification opened, brought into view while it's on the page shown.
    const highlightId = listed.get('highlight')
    const highlighted = useFadingHighlight(highlightId, 6000)
    const highlightShown = !!highlightId && rows.some(r => r.id === highlightId)
    useEffect(() => {
        if (!highlightId || !highlightShown) return
        const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
        visibleRow(highlightId)?.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'center' })
    }, [highlightId, highlightShown])

    const filters = { kind: picked.get('kind') || '', employeeId: picked.get('employeeId') || '', from: picked.get('from') || '', to: picked.get('to') || '' }
    // Day off's dates of leave are offered with Day off alone (decided on 2026-10-31).
    const dayOffOnly = filters.kind === 'dayOff'
    const filtersOn = (filters.kind ? 1 : 0) + (review && filters.employeeId ? 1 : 0) + (dayOffOnly && (filters.from || filters.to) ? 1 : 0)
    // The tab and Waiting or Done stay: they're which list, not a filter.
    const resetFilters = () => {
        clear()
        go({ kind: '', employeeId: '', search: '', from: '', to: '' })
    }
    const tabHref = (to: RequestsTab) => `/dashboard/requests?${withChanges(picked.toString(), { tab: to, employeeId: '', highlight: '' })}`

    const decide = (r: FeedRow, to: string) => action.run(r.id, async () => {
        try {
            const res = await fetch(`/api/requests/${r.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: to }) })
            if (!res.ok) {
                const body = await res.json().catch(() => ({}))
                showToast(body.error || t('error_generic'), 'error')
                return
            }
            showToast(t('request_action_success'), 'success')
            setViewing(null)
            router.refresh()
        } catch {
            showToast(t('error_generic'), 'error')
        }
    })

    // Permission hours and missing punches are approved as they are: there's
    // nothing to choose (§2.3, part 3). A missing punch's is added as a punch.
    const approveAttendance = (r: FeedRow) => action.run(r.id, async () => {
        const refused = await decideAttendance(r, true, null)
        if (refused) {
            showToast(t(refused), 'error')
            return
        }
        showToast(t('request_action_success'), 'success')
        setViewing(null)
        router.refresh()
    })

    const remove = (r: FeedRow) => action.run('delete', async () => {
        try {
            const res = await fetch(`/api/requests/${r.id}`, { method: 'DELETE' })
            if (!res.ok) {
                const body = await res.json().catch(() => ({}))
                showToast(body.error || t('error_generic'), 'error')
                return
            }
            showToast(t('requests_deleted'), 'success')
            setDeleting(null)
            setViewing(null)
            router.refresh()
        } catch {
            showToast(t('error_generic'), 'error')
        }
    })

    const kindName = (kind: RequestKind) => t(KIND_LABEL[kind])
    const platform = (r: FeedRow) => t(r.phone?.platform === 'IOS' ? 'audit_value_IOS' : 'audit_value_ANDROID')
    // Why a check-in waits, in a sentence: the reasons' words, the first capitalised (§2.3, part 4c).
    const why = (r: FeedRow) => {
        const words = r.flagged!.reasons.map(x => t(`att_flag_${x}` as TranslationKey)).join(locale === 'ar' ? '، ' : ', ')
        return words.charAt(0).toLocaleUpperCase(locale) + words.slice(1)
    }
    const kindLabel = (r: FeedRow) => kindName(r.kind)
    // What it's for: an internal request's title, or a day off's or permission's type.
    const name = (r: FeedRow) => r.kind === 'dayOff' ? t(DAY_OFF_TYPE_LABEL[r.what] ?? 'regular_day_off')
        : r.kind === 'permission' ? t(PERMISSION_TYPE_LABEL[r.what] ?? 'audit_value_MIDDAY')
            : r.kind === 'missingPunch' ? t(MISSING_LABEL[r.what] ?? 'requests_missing_any')
                : r.kind === 'overtime' ? t('requests_overtime')
                    // A phone by its model, or, without one kept, its system.
                    : r.kind === 'phone' ? r.what || platform(r)
                        // A flagged check-in by why it waits.
                        : r.kind === 'flagged' ? why(r) : r.what
    const title = (r: FeedRow) => {
        const what = name(r)
        return <button type="button" className="ui-item-button" onClick={() => setViewing(r)}><bdi>{what}</bdi></button>
    }
    // A day off's days are calendar days, kept at midnight UTC: read as such wherever the screen is.
    const dateLocale = locale === 'ar' ? 'ar-EG' : 'en-GB'
    const day = (iso: string) => new Date(iso).toLocaleDateString(dateLocale, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
    const leaveDates = (r: FeedRow) => {
        const d = r.dayOff!
        return spansDays(d.from, d.to) ? `${day(d.from)} – ${day(d.to!)}` : day(d.from)
    }
    const leaveDays = (r: FeedRow) => countOf(t, locale, workDays(r.dayOff!.from, r.dayOff!.to), 'days')
    // Between the parts of a line. In Arabic a dot beside a number reads as the digit zero (٠).
    const sep = locale === 'ar' ? '، ' : ' · '
    const leaveWhen = (r: FeedRow) => `${leaveDates(r)}${sep}${leaveDays(r)}`
    // Permission hours: the day, its hours and how long, as the language writes them.
    const num = (n: number) => n.toLocaleString(dateLocale)
    const hours = (r: FeedRow) => `${clockText(r.permission!.start, locale)} – ${clockText(r.permission!.end, locale)}`
    const length = (r: FeedRow) => t('req_minutes').replace('{n}', num(r.permission!.minutes))
    const permissionWhen = (r: FeedRow) => [permissionDay(r.permission!.date, locale), hours(r), length(r)].join(sep)
    // A missing punch: the day and the time on the wall.
    const punchWhen = (r: FeedRow) => [punchDay(r.missingPunch!.at, locale), punchTime(r.missingPunch!.at, locale)].join(sep)
    // A day's overtime: the day, how much, and when they came and left; once
    // decided, what was approved (§2.3, part 4a).
    const inOut = (r: FeedRow) => r.overtime?.firstIn && r.overtime.lastOut ? `${clockText(r.overtime.firstIn, locale)} – ${clockText(r.overtime.lastOut, locale)}` : null
    const overtimeAmount = (r: FeedRow) => r.overtime!.approvedMinutes !== null
        ? t('requests_overtime_approved').replace('{n}', num(r.overtime!.approvedMinutes))
        : r.overtime!.minutes !== null ? t('requests_overtime_minutes').replace('{n}', num(r.overtime!.minutes)) : null
    const overtimeWhen = (r: FeedRow) => [permissionDay(r.overtime!.date, locale), overtimeAmount(r), inOut(r)].filter(Boolean).join(sep)
    // A check-in phone: its system when it has a model to be named by, its
    // app's version, the check-ins it holds while it waits, and whether its
    // app is shown to be genuine (§2.3, part 4b).
    const phoneSystem = (r: FeedRow) => [r.phone!.model ? platform(r) : null, r.phone!.appVersion ? `v${r.phone!.appVersion}` : null].filter(Boolean).join(sep)
    const phoneWhen = (r: FeedRow) => [
        phoneSystem(r) || null,
        r.status === 'PENDING' && r.phone!.held > 0 ? countOf(t, locale, r.phone!.held, 'held') : null,
        r.phone!.attested ? null : t('req_phone_unverified'),
    ].filter(Boolean).join(sep)
    // A flagged check-in: in or out, the place it was checked against, and how far from it.
    const metres = (r: FeedRow) => r.flagged!.distance !== null ? t('req_flagged_distance').replace('{n}', num(r.flagged!.distance)) : null
    // The place's name is the company's own words: it keeps its own direction, as <bdi> keeps it,
    // in a line that is text (DESIGN.md §7).
    const isolated = (text: string | null) => text ? `\u2068${text}\u2069` : null
    const flaggedWhen = (r: FeedRow) => [
        r.flagged!.direction ? t(r.flagged!.direction === 'IN' ? 'requests_flagged_in' : 'requests_flagged_out') : null,
        isolated(r.flagged!.place),
        metres(r),
    ].filter(Boolean).join(sep)
    // Where the phone said it was: how far and how exactly, and the map.
    const flaggedWhere = (r: FeedRow) => {
        const f = r.flagged!
        const parts = [metres(r), f.accuracy !== null ? t('req_flagged_accuracy').replace('{n}', num(f.accuracy)) : null].filter(Boolean).join(sep)
        const map = f.latitude !== null && f.longitude !== null
            ? <a href={googleMapsLink(f.latitude, f.longitude)} target="_blank" rel="noopener noreferrer">{t('requests_flagged_map')}</a>
            : null
        return parts || map ? <span>{parts}{parts && map ? sep : null}{map}</span> : null
    }
    const direction = (r: FeedRow) => t(r.missingPunch?.direction === 'IN' ? 'punch_in' : r.missingPunch?.direction === 'OUT' ? 'punch_out' : 'punch_direction_unknown')
    // What came of a day off: the days taken and from what, or why it was refused;
    // and why permission hours were.
    const outcome = (r: FeedRow) => {
        const why = r.dayOff?.rejectionReason ?? r.permission?.rejectionReason ?? r.missingPunch?.rejectionReason ?? r.overtime?.note ?? r.phone?.reason ?? r.flagged?.reason
        const d = r.dayOff
        if (d && r.status === 'APPROVED') return t(d.deductedFrom === 'SALARY' ? 'day_off_deducted_salary' : 'day_off_deducted_credit').replace('{days}', countOf(t, locale, d.deducted, 'days'))
        // A phone revoked, and why, if someone said.
        if (r.status === 'REVOKED' && why) return `${t('requests_phone_revoke_reason')}: ${why}`
        return r.status === 'REJECTED' && why ? `${t('rejected_reason_prefix')}: ${why}` : null
    }
    // Under its name: its kind, once there's more than one, and a day off's days or permission's hours.
    const when = (r: FeedRow) => r.dayOff ? leaveWhen(r) : r.permission ? permissionWhen(r) : r.missingPunch ? punchWhen(r) : r.overtime ? overtimeWhen(r)
        : r.phone ? phoneWhen(r) || null : r.flagged ? flaggedWhen(r) || null : null
    const detail = (r: FeedRow) => {
        const parts = [kinds.length > 1 ? kindLabel(r) : null, when(r)].filter(Boolean)
        return parts.length ? <span>{parts.join(sep)}</span> : undefined
    }
    const badge = (r: FeedRow) => {
        const s = r.phone?.replaced ? REPLACED : STATUS[r.status]
        return s ? <StatusBadge tone={s.tone}>{t(s.label)}</StatusBadge> : null
    }
    // Its day and time together: a narrow column broke "9:25 pm" from its day.
    // A day's overtime is "asked" on its day, which has no time of its own.
    // A flagged check-in's is when it was made, as the clock on the wall read.
    const asked = (r: FeedRow) => <span className="ui-nowrap">{r.overtime ? permissionDay(r.overtime.date, locale)
        : r.flagged ? `${punchDay(r.flagged.at, locale)}${sep}${punchTime(r.flagged.at, locale)}`
            : <SafeDate date={r.asked} locale={locale} format="short" />}</span>
    const next = (r: FeedRow) => {
        if (r.kind === 'dayOff') return r.mayDecide && <>
            <Button size="sm" icon={CheckIcon} onClick={() => { setViewing(null); setDeciding({ row: r, decision: 'APPROVED' }) }} aria-label={`${t('approve_button')}: ${name(r)}, ${r.who.name}`}>{t('approve_button')}</Button>
            <Button size="sm" icon={XIcon} onClick={() => { setViewing(null); setDeciding({ row: r, decision: 'REJECTED' }) }} aria-label={`${t('reject_button')}: ${name(r)}, ${r.who.name}`}>{t('reject_button')}</Button>
        </>
        if (r.kind === 'permission' || r.kind === 'missingPunch' || r.kind === 'overtime' || r.kind === 'phone' || r.kind === 'flagged') return r.mayDecide && <>
            <Button size="sm" icon={CheckIcon} onClick={() => { void approveAttendance(r) }} disabled={action.running} busy={action.is(r.id)} aria-label={`${t('approve_button')}: ${name(r)}, ${r.who.name}`}>{t('approve_button')}</Button>
            <Button size="sm" icon={XIcon} onClick={() => { setViewing(null); setRejecting(r) }} aria-label={`${t('reject_button')}: ${name(r)}, ${r.who.name}`}>{t('reject_button')}</Button>
        </>
        const step = r.mayDecide ? NEXT[r.status] : undefined
        if (!step) return null
        return (
            <Button size="sm" icon={step.icon} onClick={() => { void decide(r, step.to) }} disabled={action.running} busy={action.is(r.id)} aria-label={`${t(step.label)}: ${r.what}`}>
                {t(step.label)}
            </Button>
        )
    }
    const menu = (r: FeedRow) => (
        <RowMenu
            label={t('ui_more_actions_for').replace('{name}', name(r))}
            tooltip={t('ui_more_actions')}
            items={[
                { key: 'view', icon: EyeIcon, label: t('requests_view_details'), onSelect: () => setViewing(r) },
                ...(r.flagged?.mayViewFace ? [{ key: 'face', icon: UserFocusIcon, label: t('face_flag_see'), onSelect: () => setFaceOf(r) }] : []),
                ...(r.mayWithdraw ? [{ key: 'withdraw', icon: ArrowUUpLeftIcon, label: r.overtime ? t('requests_overtime_withdraw') : t('req_withdraw'), danger: true, onSelect: () => setWithdrawing(r) }] : []),
                ...(r.mayRevoke ? [{ key: 'revoke', icon: ProhibitIcon, label: t('requests_phone_revoke'), danger: true, onSelect: () => setRevoking(r) }] : []),
                ...(r.mayDelete ? [{ key: 'delete', icon: TrashIcon, label: t('delete'), danger: true, onSelect: () => setDeleting(r) }] : []),
            ]}
        />
    )
    const actions = (r: FeedRow) => <span className="ui-row-actions">{next(r)}{menu(r)}</span>
    // What rejecting refuses: whose permission hours on which day, whose missing punch when, whose new phone, or whose check-in.
    const rejectQuestion = (r: FeedRow) => {
        if (r.flagged) return t('requests_flagged_reject_question').replace('{name}', r.who.name).replace('{time}', punchTime(r.flagged.at, locale)).replace('{date}', punchDay(r.flagged.at, locale))
        if (r.phone) return t('requests_phone_reject_question').replace('{name}', r.who.name).replace('{phone}', name(r))
        if (r.missingPunch) return t('requests_missing_reject_question').replace('{name}', r.who.name).replace('{time}', punchTime(r.missingPunch.at, locale)).replace('{date}', punchDay(r.missingPunch.at, locale))
        if (r.overtime) return t('requests_overtime_reject_question').replace('{name}', r.who.name).replace('{date}', permissionDay(r.overtime.date, locale))
        return t('requests_permission_reject_question').replace('{name}', r.who.name).replace('{date}', permissionDay(r.permission!.date, locale))
    }
    // When it ended: done, decided, withdrawn by whoever asked, or a phone revoked or replaced.
    const finishedLabel = (r: FeedRow): TranslationKey => r.kind === 'internal' ? 'finished_at'
        : r.status === 'CANCELLED' || r.status === 'WITHDRAWN' ? 'requests_withdrawn_on'
            : r.phone?.replaced ? 'requests_phone_replaced_on'
                : r.status === 'REVOKED' ? 'requests_phone_revoked_on' : 'requests_decided_on'

    const columns: Column<FeedRow>[] = [
        { key: 'request', header: t('requests_col_request'), cell: r => <ItemTitle title={title(r)} detail={detail(r)} /> },
        ...(review ? [{ key: 'who', header: t('requests_col_who'), cell: (r: FeedRow) => <Person names={[r.who.name]} /> }] : []),
        { key: 'asked', header: t('requests_col_asked'), cell: asked },
        { key: 'status', header: t('status_label'), cell: badge },
        { key: 'actions', header: t('actions_label'), hideHeader: true, align: 'end', cell: actions },
    ]

    const empty = filtersOn > 0 || query
        ? <EmptyState icon={TrayIcon} title={t('requests_empty_filters')} action={<Button variant="quiet" onClick={resetFilters}>{t('ui_reset_filters')}</Button>} />
        : show === 'done'
            ? <EmptyState icon={TrayIcon} title={t('requests_empty_done')} />
            : review
                ? <EmptyState icon={TrayIcon} title={t('requests_empty_review')} />
                : <EmptyState icon={TrayIcon} title={t('requests_empty_mine')} action={<Button icon={PlusIcon} onClick={() => setAsking(true)}>{t('requests_new')}</Button>} />
    // A request has a title; the others, a reason.
    const searchLabel = t(kinds.length > 0 && !kinds.includes('internal') ? 'requests_search_reason' : kinds.some(k => k !== 'internal') ? 'requests_search_any' : 'requests_search')

    return (
        <Page>
            <PageHeader
                title={modules.label('requests')}
                subtitle={t('requests_subtitle')}
                action={tabs.mine && <Button variant="primary" icon={PlusIcon} onClick={() => setAsking(true)}>{t('requests_new')}</Button>}
            />

            {tabs.mine && tabs.review && (
                <TabLinks label={t('requests_tabs_label')} items={[
                    { href: tabHref('review'), label: t('requests_tab_review'), current: review },
                    { href: tabHref('mine'), label: t('requests_tab_mine'), current: !review },
                ]} />
            )}

            {/* Their balance, above the list, on Mine (decided on 2026-10-30). */}
            {!review && credit && (
                <Section title={t('credit_overview')}>
                    <DayOffCreditDonut remaining={credit.remaining} used={credit.used} t={t} locale={locale} />
                </Section>
            )}
            {/* What's left of this month's permission hours, under it (decided on 2026-10-31). */}
            {!review && allowance && (
                <Section title={t('req_permissions')}>
                    <Rows label={t('req_permissions')}>
                        <Row
                            title={t('requests_permission_left').replace('{left}', num(allowance.left)).replace('{total}', num(allowance.total))}
                            detail={[
                                allowance.pending > 0 ? t('requests_permission_waiting').replace('{n}', num(allowance.pending)) : null,
                                allowance.carried > 0 ? t('req_carried').replace('{n}', num(allowance.carried)) : null,
                            ].filter(Boolean).join(sep) || undefined}
                        />
                    </Rows>
                </Section>
            )}

            <FilterBar
                search={<Field label={searchLabel} hideLabel>{p => <SearchInput {...p} autoComplete="off" placeholder={searchLabel} value={query} onChange={e => setQuery(e.target.value)} />}</Field>}
                activeCount={filtersOn}
                onReset={filtersOn > 0 || query ? resetFilters : undefined}
            >
                <Field label={t('requests_show_label')} hideLabel>{p => (
                    <Select {...p} icon={CircleHalfIcon} value={show} onChange={e => go({ show: e.target.value, highlight: '' })}
                        options={[{ value: 'waiting', label: t('requests_show_waiting') }, { value: 'done', label: t('requests_show_done') }]} />
                )}</Field>
                {kinds.length > 1 && (
                    <Field label={t('requests_kind_label')} hideLabel>{p => (
                        <Select {...p} icon={ShapesIcon} value={filters.kind} onChange={e => go({ kind: e.target.value, from: '', to: '' })}
                            options={[{ value: '', label: t('requests_kind_all') }, ...kinds.map(k => ({ value: k, label: kindName(k) }))]} />
                    )}</Field>
                )}
                {review && (
                    <Field label={t('requests_col_who')} hideLabel>{p => (
                        <Select {...p} icon={UserIcon} value={filters.employeeId} onChange={e => go({ employeeId: e.target.value })} options={employeeOptions} />
                    )}</Field>
                )}
                {dayOffOnly && (
                    <DateRangePicker asField hideLabel label={t('requests_leave_dates')} dateFrom={filters.from} dateTo={filters.to}
                        onChange={(from, to) => go({ from, to })} />
                )}
            </FilterBar>

            <DataList
                caption={modules.label('requests')}
                columns={columns}
                rows={rows}
                rowKey={r => r.id}
                tone={r => highlighted === r.id ? 'selected' : undefined}
                card={r => (
                    <ListCard
                        title={title(r)}
                        status={badge(r)}
                        details={[
                            ...(kinds.length > 1 ? [{ icon: ShapesIcon, text: kindLabel(r) }] : []),
                            ...(r.dayOff ? [{ icon: CalendarBlankIcon, text: <span>{leaveWhen(r)}</span> }] : []),
                            ...(r.permission ? [{ icon: ClockIcon, text: <span>{permissionWhen(r)}</span> }] : []),
                            ...(r.missingPunch ? [{ icon: ClockIcon, text: <span>{punchWhen(r)}</span> }] : []),
                            ...(r.overtime ? [{ icon: ClockIcon, text: <span>{overtimeWhen(r)}</span> }] : []),
                            ...(r.phone && phoneWhen(r) ? [{ icon: DeviceMobileIcon, text: <span>{phoneWhen(r)}</span> }] : []),
                            ...(r.flagged && flaggedWhen(r) ? [{ icon: MapPinIcon, text: <span>{flaggedWhen(r)}</span> }] : []),
                            ...(review ? [{ icon: UserIcon, text: <bdi>{r.who.name}</bdi> }] : []),
                            { icon: CalendarIcon, text: asked(r) },
                        ]}
                        foot={actions(r)}
                    />
                )}
                footer={<Pager page={page} pageCount={totalPages} onPage={p => go({ page: String(p) })} summary={countOf(t, locale, total, 'requests')} />}
                empty={empty}
            />

            <Dialog
                open={!!viewing}
                onClose={() => setViewing(null)}
                title={viewing ? <bdi>{name(viewing)}</bdi> : ''}
                actions={viewing && <>
                    <Button onClick={() => setViewing(null)}>{t('close')}</Button>
                    {next(viewing)}
                </>}
            >
                {viewing && (
                    <>
                        {viewing.detail && <p className="ui-prose" dir="auto">{viewing.detail}</p>}
                        <Details items={[
                            { label: t('requests_col_who'), value: <bdi>{viewing.who.name}</bdi> },
                            ...(viewing.dayOff ? [
                                { label: t('dates_label'), value: leaveDates(viewing) },
                                { label: t('requests_day_off_work_days'), value: leaveDays(viewing) },
                            ] : []),
                            ...(viewing.permission ? [
                                { label: t('date_label'), value: permissionDay(viewing.permission.date, locale) },
                                { label: t('requests_permission_hours'), value: hours(viewing) },
                                { label: t('requests_permission_length'), value: length(viewing) },
                            ] : []),
                            ...(viewing.missingPunch ? [
                                { label: t('date_label'), value: punchDay(viewing.missingPunch.at, locale) },
                                { label: t('punch_time'), value: punchTime(viewing.missingPunch.at, locale) },
                                { label: t('punch_direction'), value: direction(viewing) },
                            ] : []),
                            ...(viewing.overtime ? [
                                { label: t('date_label'), value: permissionDay(viewing.overtime.date, locale) },
                                ...(overtimeAmount(viewing) ? [{ label: t('requests_overtime'), value: overtimeAmount(viewing) }] : []),
                                ...(inOut(viewing) ? [{ label: t('requests_overtime_in_out'), value: inOut(viewing) }] : []),
                            ] : []),
                            ...(viewing.phone ? [
                                ...(phoneSystem(viewing) ? [{ label: t('requests_phone_system'), value: <bdi>{phoneSystem(viewing)}</bdi> }] : []),
                                { label: t('requests_phone_app_check'), value: t(viewing.phone.attested ? 'requests_phone_verified' : 'req_phone_unverified') },
                                ...(viewing.status === 'PENDING' ? [{ label: t('requests_phone_held_label'), value: num(viewing.phone.held) }] : []),
                            ] : []),
                            ...(viewing.flagged ? [
                                { label: t('date_label'), value: punchDay(viewing.flagged.at, locale) },
                                { label: t('punch_time'), value: punchTime(viewing.flagged.at, locale) },
                                ...(viewing.flagged.direction ? [{ label: t('punch_direction'), value: t(viewing.flagged.direction === 'IN' ? 'punch_in' : 'punch_out') }] : []),
                                ...(viewing.flagged.place ? [{ label: t('requests_flagged_place'), value: <bdi>{viewing.flagged.place}</bdi> }] : []),
                                ...(flaggedWhere(viewing) ? [{ label: t('requests_flagged_where'), value: flaggedWhere(viewing) }] : []),
                                ...(viewing.flagged.ip ? [{ label: t('requests_flagged_ip'), value: <bdi>{viewing.flagged.ip}</bdi> }] : []),
                                ...(viewing.flagged.phone ? [{ label: t('req_phone'), value: <bdi>{viewing.flagged.phone}</bdi> }] : []),
                                ...(viewing.flagged.mayViewFace ? [{ label: t('requests_flagged_face'), value: <Button size="sm" icon={UserFocusIcon} onClick={() => setFaceOf(viewing)}>{t('face_flag_see')}</Button> }] : []),
                            ] : []),
                            // A day's overtime has no time it was asked at: its day is above; a flagged check-in's time is above.
                            ...(viewing.overtime || viewing.flagged ? [] : [{ label: t('requested_on'), value: <SafeDate date={viewing.asked} locale={locale} /> }]),
                            ...(viewing.started ? [{ label: t('started_at'), value: <SafeDate date={viewing.started} locale={locale} /> }] : []),
                            ...(viewing.finished ? [{ label: t(finishedLabel(viewing)), value: <SafeDate date={viewing.finished} locale={locale} /> }] : []),
                            { label: t('status_label'), value: badge(viewing) },
                            ...(outcome(viewing) ? [{ label: t('requests_day_off_outcome'), value: <bdi>{outcome(viewing)}</bdi> }] : []),
                        ]} />
                    </>
                )}
            </Dialog>

            <Dialog
                open={!!deleting}
                onClose={() => setDeleting(null)}
                title={t('requests_delete_title')}
                actions={<>
                    <Button onClick={() => setDeleting(null)}>{t('cancel')}</Button>
                    <Button variant="danger" onClick={() => { if (deleting) void remove(deleting) }} busy={action.is('delete')} disabled={action.running}>{t('delete')}</Button>
                </>}
            >
                <p>{t('requests_delete_body').replace('{title}', deleting ? name(deleting) : '')}</p>
            </Dialog>

            {deciding && (
                <DecideDayOff key={`${deciding.row.id}-${deciding.decision}`} request={deciding.row} decision={deciding.decision}
                    onClose={() => setDeciding(null)} onDecided={() => { setDeciding(null); router.refresh() }} />
            )}
            {rejecting && (
                <RejectAttendance key={rejecting.id} request={rejecting} question={rejectQuestion(rejecting)}
                    placeholder={t(rejecting.missingPunch ? 'requests_missing_reject_placeholder' : rejecting.overtime ? 'requests_overtime_reject_placeholder'
                        : rejecting.phone ? 'requests_phone_reject_placeholder' : rejecting.flagged ? 'requests_flagged_reject_placeholder' : 'requests_permission_reject_placeholder')}
                    onClose={() => setRejecting(null)} onDecided={() => { setRejecting(null); router.refresh() }} />
            )}
            {withdrawing && (
                <WithdrawAttendance key={withdrawing.id} request={withdrawing}
                    title={t(withdrawing.overtime ? 'requests_overtime_withdraw_title' : 'requests_withdraw_title')}
                    hint={t(withdrawing.missingPunch ? 'requests_missing_withdraw_hint' : withdrawing.overtime ? 'requests_overtime_withdraw_hint' : 'req_withdraw_hint')}
                    onClose={() => setWithdrawing(null)} onWithdrawn={() => { setWithdrawing(null); setViewing(null); router.refresh() }} />
            )}

            {faceOf && <FlaggedFaceModal punchId={faceOf.id} name={faceOf.who.name} onClose={() => setFaceOf(null)} />}
            {revoking && (
                <RevokePhone key={revoking.id} request={revoking}
                    onClose={() => setRevoking(null)} onRevoked={() => { setRevoking(null); setViewing(null); router.refresh() }} />
            )}

            <NewRequest open={asking} mayAskDayOff={mayAskDayOff} today={mayAskAttendance ? attendanceToday : null} onClose={() => setAsking(false)} onAsked={() => {
                setAsking(false)
                // Theirs, waiting: where it now is.
                if (tab === 'mine' && show === 'waiting') router.refresh()
                else go({ tab: 'mine', show: 'waiting', kind: '', employeeId: '', search: '', highlight: '' })
            }} />
        </Page>
    )
}

/**
 * Asking for something: a title and what it's about, as the server checks
 * them; a day off, for whoever may ask for leave (§2.3, part 2c); or
 * permission hours or a missing punch, for whoever has attendance of their
 * own (part 3).
 */
function NewRequest({ open, mayAskDayOff, today, onClose, onAsked }: {
    open: boolean
    mayAskDayOff: boolean
    /** The company's day, for whoever has attendance of their own; null for whoever hasn't. */
    today: string | null
    onClose: () => void
    onAsked: () => void
}) {
    const { t } = useLanguage()
    const [what, setWhat] = useState<RequestKind>('internal')
    const offered = REQUEST_KINDS.filter(k => k === 'internal' || (k === 'dayOff' && mayAskDayOff) || ((k === 'permission' || k === 'missingPunch') && today !== null))
    const close = () => {
        setWhat('internal')
        onClose()
    }
    const asked = () => {
        setWhat('internal')
        onAsked()
    }
    return (
        <Dialog open={open} onClose={close} title={t('requests_new')}>
            {offered.length > 1 && (
                <Choice legend={t('requests_ask_for')} name="ask-for" value={what} onChange={setWhat}
                    options={offered.map(k => ({ value: k, label: t(KIND_LABEL[k]) }))} />
            )}
            {what === 'dayOff'
                ? <AskDayOff onCancel={close} onAsked={asked} />
                : what === 'permission' && today
                    ? <AskPermission today={today} onCancel={close} onAsked={asked} />
                    : what === 'missingPunch' && today
                        ? <ReportMissingPunch today={today} onCancel={close} onReported={asked} />
                        : <AskInternal onCancel={close} onAsked={onAsked} />}
        </Dialog>
    )
}

/** An internal request: a title and what it's about. */
function AskInternal({ onCancel, onAsked }: { onCancel: () => void; onAsked: () => void }) {
    const { t, locale } = useLanguage()
    const { showToast } = useToast()
    const action = useBusyAction()
    const formId = useId()
    const [title, setTitle] = useState('')
    const [details, setDetails] = useState('')
    const [errors, setErrors] = useState<{ title?: string; details?: string }>({})
    const num = (n: number) => n.toLocaleString(locale === 'ar' ? 'ar-EG' : 'en-GB')
    const used = (n: number, max: number) => t('ui_characters_used').replace('{used}', num(n)).replace('{max}', num(max))

    const close = () => {
        setTitle('')
        setDetails('')
        setErrors({})
        onCancel()
    }
    const submit = (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault()
        const form = e.currentTarget
        const found = {
            title: title.trim().length < TITLE.min ? t('requests_title_short') : undefined,
            details: details.trim().length < DETAILS.min ? t('requests_details_short') : undefined,
        }
        setErrors(found)
        if (found.title || found.details) {
            // To the first field that needs fixing, once it's marked.
            requestAnimationFrame(() => form.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus())
            return
        }
        void action.run('ask', async () => {
            try {
                const res = await fetch('/api/requests', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: title.trim(), details: details.trim() }) })
                if (!res.ok) {
                    showToast(t('failed_submit_request'), 'error')
                    return
                }
                showToast(t('request_submitted_success'), 'success')
                setTitle('')
                setDetails('')
                setErrors({})
                onAsked()
            } catch {
                showToast(t('error_generic'), 'error')
            }
        })
    }

    return (
        <form id={formId} className="ui-form" noValidate onSubmit={submit}>
            <Field label={t('requests_title_label')} hint={used(title.length, TITLE.max)} error={errors.title}>{p => (
                <TextInput {...p} name="title" autoComplete="off" dir="auto" maxLength={TITLE.max} placeholder={t('requests_title_placeholder')} value={title}
                    onChange={e => { setTitle(e.target.value); setErrors(x => ({ ...x, title: undefined })) }} />
            )}</Field>
            <Field label={t('requests_details_label')} hint={used(details.length, DETAILS.max)} error={errors.details}>{p => (
                <TextArea {...p} name="details" dir="auto" rows={5} maxLength={DETAILS.max} placeholder={t('requests_details_placeholder')} value={details}
                    onChange={e => { setDetails(e.target.value); setErrors(x => ({ ...x, details: undefined })) }} />
            )}</Field>
            <DialogActions>
                <Button onClick={close}>{t('cancel')}</Button>
                <Button type="submit" variant="primary" disabled={action.running} busy={action.is('ask')}>{t('requests_send')}</Button>
            </DialogActions>
        </form>
    )
}

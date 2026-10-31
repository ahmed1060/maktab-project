'use client'
import { useCallback, useEffect, useState } from 'react'
import useSWR from 'swr'
import useSWRInfinite from 'swr/infinite'
import { BuildingsIcon, HourglassIcon, WarningCircleIcon } from '@phosphor-icons/react/ssr'
import { fetcher, fetchRetrying, SWRError } from '@/lib/swr-fetcher'
import { useSession } from 'next-auth/react'
import { useLanguage } from '@/context/LanguageContext'
import { useToast } from '@/context/ToastContext'
import ConfirmModal from '@/components/ConfirmModal'
import DatePickerSingle from '@/components/DatePickerSingle'
import { Button, Card, Details, Dialog, EmptyState, Field, Page, PageHeader, PeriodBar, Row, Section, SectionLink, Select, StatusBadge, TextArea, TotalTiles, type StatusTone, type Tile } from '@/components/ui'
import { useCan } from '@/lib/useCan'
import { useBusyAction } from '@/lib/useBusyAction'
import { dayLabel } from '@/lib/cash-advances'
import type { TranslationKey } from '@/lib/translations'

/**
 * The register: one month, everybody in it, and what changed.
 *
 * Laid out in the order somebody actually reviews it. The totals first, because
 * that is the number being signed off. Then what moved since last month, which
 * is the only question a reviewer can really answer from one screen. Then the
 * things that are not settled — undecided suspensions, people whose month could
 * not be computed — before the list itself, so nothing that needs a decision is
 * below a long table.
 *
 * On the building blocks from the top down (UI_PLAN.md §5 step 5): the page
 * header, the month it's for (DESIGN.md §5.3), paying and sending, and the
 * totals so far; the review cards, the list and the debts follow.
 */

type Line = { kind: 'EARNING' | 'DEDUCTION'; label: string; amountMinor: number; source: string; sourceId?: string | null }
type AttendanceMoney = { lateness: number; earlyLeave: number; absence: number; overtime: number }
type Discrepancy = { id: string; userId: string; name: string; date: string; paidStatus: string; nowStatus: string | null; differenceMinor: number; resolvedAt: string | null; resolution: string | null }
type Entry = {
    userId: string
    name: string
    lines: Line[]
    totals: { earningsMinor: number; deductionsMinor: number; netMinor: number; carriedMinor: number }
    daysPaid: number
    wholeMonth: boolean
    undecidedDays: number
    excluded: boolean
    exclusionReason?: string
}
type PersonVariance = {
    userId: string; name: string
    previousMinor: number | null; currentMinor: number | null
    deltaMinor: number; kind: 'NEW' | 'GONE' | 'CHANGED' | 'SAME'
}
type View = {
    year: number
    month: number
    payrollDay: number
    status: 'DRAFT' | 'APPROVED' | 'PAID'
    delivery: { paidAt: string | null; batchSize: number; sent: number; sendable: number; unsent: number } | null
    payslipIds: Record<string, string>
    register: {
        entries: Entry[]
        payableMinor: number
        carriedMinor: number
        includedCount: number
        excludedCount: number
        pendingDecisions: { userId: string; name: string; undecidedDays: number }[]
    }
    refused: { userId: string; name: string; reason: string }[]
    variance: { previousTotalMinor: number; currentTotalMinor: number; deltaMinor: number; people: PersonVariance[] } | null
    sinceDraft: { deltaMinor: number; people: PersonVariance[] } | null
    draftSavedAt: string | null
    debts: { id: string; userId: string; name: string; amount: number; originalAmount: number; recoveredAmount: number; dueDate: string; source: string }[]
    /** What attendance costs this month: on the payslips once it reaches payroll, else the dry run (ATTENDANCE_PLAN.md §12, §20). */
    attendance?: { reachesPayroll: boolean; from: string | null; byPerson: Record<string, AttendanceMoney>; discrepanciesOpen: number }
}

/** How many of those who changed since last month are listed; the card says how many more. */
const VARIANCE_SHOWN = 8

/** A month's status, by what it means (DESIGN.md §2.3): a draft is neutral, approved and paid are done. */
const STATUS_TONE: Record<View['status'], StatusTone> = { DRAFT: 'neutral', APPROVED: 'good', PAID: 'good' }

export default function PayrollRegisterPage() {
    const { t, locale } = useLanguage()
    const { showToast } = useToast()
    const { data: session } = useSession()
    const isRtl = locale === 'ar'

    const now = new Date()
    const [year, setYear] = useState(now.getFullYear())
    const [month, setMonth] = useState(now.getMonth() + 1)
    const [open, setOpen] = useState<string | null>(null)
    const [acknowledged, setAcknowledged] = useState(false)
    // Saving, approving, sending and marking paid: one at a time, and the
    // button that started it says so.
    const action = useBusyAction()
    // G3: a Super Admin has no companyId of their own — SuperAdmin has no such
    // column — so without a picker the register resolved to no company and
    // answered 400. The API always supported naming one; this is the control
    // that was missing.
    const [companies, setCompanies] = useState<{ id: string; name: string }[]>([])
    const [companyId, setCompanyId] = useState<string>('')
    const [waiving, setWaiving] = useState<string | null>(null)
    // Which confirmation is open, if any. One piece of state rather than three
    // booleans: only ever one of these is on screen, and three flags is three
    // chances for two to be true at once.
    const [confirming, setConfirming] = useState<
        | { kind: 'approve' }
        | { kind: 'paid' }
        | { kind: 'waive'; debt: { id: string; name: string; amount: number } }
        | { kind: 'resolve'; discrepancy: Discrepancy }
        | null
    >(null)
    // Not while it works: closing then would hide the answer.
    const closeConfirm = () => { if (!action.running) setConfirming(null) }
    // Defaults to today, and is a date rather than a switch because a transfer
    // made on the 25th is usually recorded on the 27th, and stamping the 27th
    // makes the record disagree with the bank.
    const [paidAt, setPaidAt] = useState(() => new Date().toISOString().slice(0, 10))

    const isSuper = (session?.user as any)?.role === 'SUPER_ADMIN'
    const { can } = useCan()

    const money = useCallback((minor: number) =>
        new Intl.NumberFormat(isRtl ? 'ar-EG' : 'en-EG', {
            minimumFractionDigits: 2, maximumFractionDigits: 2,
        }).format(minor / 100), [isRtl])

    const signedMoney = useCallback((minor: number) =>
        `${minor > 0 ? '+' : minor < 0 ? '−' : ''}${money(Math.abs(minor))}`, [money])

    useEffect(() => {
        if (!isSuper) return
        (async () => {
            try {
                const res = await fetchRetrying('/api/companies?limit=200')
                if (!res.ok) return
                const body = await res.json()
                // The envelope is { data: { data: [...], total, ... } } — the
                // list route returns a paginated object, and ApiResponse wraps
                // it. Reaching for the wrong level yields an empty picker and
                // no error, which is how this would have shipped looking fine.
                const rows: any[] = Array.isArray(body?.data?.data) ? body.data.data : []
                setCompanies(rows.map(c => ({ id: c.id, name: c.name })).filter(c => c.id && c.name))
                // Nothing is chosen for them. Picking the first company would
                // mean a Super Admin opens payroll and is shown somebody's
                // register they did not ask for.
            } catch {
                // A failed list leaves the picker empty and the screen says so.
                // It is not worth a toast on a screen that has not been asked
                // for anything yet.
            }
        })()
    }, [isSuper])

    // A Super Admin with no company chosen has not asked a question yet, and
    // nobody has until the session says who they are. Firing anyway is what
    // produced the 400 G3 fixed.
    const registerKey = !session || (isSuper && !companyId)
        ? null
        : `/api/payroll/${year}/${month}${companyId ? `?companyId=${encodeURIComponent(companyId)}` : ''}`
    // No other register stays up while this one loads, not even last month's:
    // Save draft, Approve and Mark as paid name the company, month and year
    // picked, not the ones on screen. The pickers stay, over a spinner.
    // Didn't load: the page says so, with the server's own word when it gave
    // one, and Try again (DESIGN.md §5.5).
    const { data, error, isValidating, mutate: load } = useSWR(registerKey, fetcher)
    const view: View | null = registerKey && !error ? (data?.data ?? null) : null
    // Attendance changed after a payroll was approved (§12.3): whenever any is
    // open, whatever the switch says now.
    // A page at a time: every open one is money owed, so none is cut off.
    type DiscrepancyPage = { data?: { open: Discrepancy[]; openCount: number; nextCursor: string | null } }
    const { data: discrepancyPages, mutate: reloadDiscrepancies, size: discrepancyPageCount, setSize: setDiscrepancyPageCount } = useSWRInfinite<DiscrepancyPage>(
        (i, previous: DiscrepancyPage | null) => {
            if (!view?.attendance?.discrepanciesOpen) return null
            if (i > 0 && !previous?.data?.nextCursor) return null
            const q = new URLSearchParams()
            if (companyId) q.set('companyId', companyId)
            if (i > 0) q.set('after', previous!.data!.nextCursor!)
            return `/api/attendance/discrepancies${q.size ? `?${q}` : ''}`
        }, fetcher)
    const discrepancies: Discrepancy[] = (discrepancyPages ?? []).flatMap(p => p.data?.open ?? [])
    const discrepanciesOpen = discrepancyPages?.[0]?.data?.openCount ?? 0
    const moreDiscrepancies = !!discrepancyPages?.[discrepancyPages.length - 1]?.data?.nextCursor
    // How a difference was settled, said in the dialog that marks it
    // resolved: kept as the record of how, so it's a few words at least.
    const [resolution, setResolution] = useState('')
    const [resolutionMissing, setResolutionMissing] = useState(false)
    const openResolve = (discrepancy: Discrepancy) => {
        setResolution('')
        setResolutionMissing(false)
        setConfirming({ kind: 'resolve', discrepancy })
    }
    const resolve = async (target: Discrepancy) => {
        if (resolution.trim().length < 3) {
            setResolutionMissing(true)
            // To the field, once it's marked, as a form's first error is.
            requestAnimationFrame(() => document.querySelector<HTMLElement>('textarea[name="resolution"]')?.focus())
            return
        }
        try {
            const res = await fetch(`/api/attendance/discrepancies/${target.id}/resolve`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reason: resolution.trim() }) })
            const body = await res.json().catch(() => null)
            showToast(res.ok ? t('attpay_resolved') : (body?.error || t('error_generic')), res.ok ? 'success' : 'error')
            // Refused, it stays open with what was typed, to try again.
            if (res.ok) {
                reloadDiscrepancies()
                setConfirming(null)
            }
        } catch {
            showToast(t('error_generic'), 'error')
        }
    }

    const save = async () => {
        try {
            const res = await fetch(`/api/payroll/${year}/${month}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ companyId: companyId || undefined }),
            })
            const body = await res.json()
            showToast(res.ok ? t('payroll_saved') : (body?.error || t('payroll_save_failed')), res.ok ? 'success' : 'error')
            if (res.ok) load()
        } catch {
            showToast(t('payroll_save_failed'), 'error')
        }
    }

    const approve = async () => {
        try {
            const res = await fetch(`/api/payroll/${year}/${month}/approve`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ acknowledgePending: acknowledged, companyId: companyId || undefined }),
            })
            const body = await res.json()
            if (res.ok) {
                showToast(t('payroll_approved_ok'), 'success')
                load()
                return
            }
            // The refusal names the people it is about, and saying which ones
            // is the difference between a message somebody can act on and one
            // that sends them through a list of fifty.
            const names: string[] = body?.details?.names ?? []
            showToast(
                names.length ? `${body.error} (${names.join(', ')})` : (body?.error || t('payroll_approve_failed')),
                'error',
            )
        } catch {
            showToast(t('payroll_approve_failed'), 'error')
        }
    }

    const issue = async () => {
        try {
            const res = await fetch(`/api/payroll/${year}/${month}/issue`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ companyId: companyId || undefined }),
            })
            const body = await res.json()
            if (!res.ok) {
                showToast(body?.error || t('payroll_issue_failed'), 'error')
                return
            }
            const { sent, remaining, skipped, failed } = body.data
            showToast(
                remaining > 0
                    ? t('payroll_issue_partial').replace('{n}', String(sent)).replace('{left}', String(remaining))
                    : t('payroll_issue_ok').replace('{n}', String(sent)),
                'success',
            )
            // Reported separately and not folded into the count. A reserved
            // address is never going to be deliverable and a failure will be
            // retried, and a screen that showed only "24 sent" would leave
            // somebody to discover the difference from the person who never
            // got theirs.
            if (skipped?.length) showToast(t('payroll_issue_skipped').replace('{names}', skipped.join(', ')), 'error')
            if (failed?.length) showToast(t('payroll_issue_failed_some').replace('{names}', failed.map((f: any) => f.name).join(', ')), 'error')
            load()
        } catch {
            showToast(t('payroll_issue_failed'), 'error')
        }
    }

    const markPaid = async () => {
        try {
            const res = await fetch(`/api/payroll/${year}/${month}/paid`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ paidAt, companyId: companyId || undefined }),
            })
            const body = await res.json()
            showToast(res.ok ? t('payroll_paid_ok') : (body?.error || t('payroll_paid_failed')), res.ok ? 'success' : 'error')
            if (res.ok) load()
        } catch {
            showToast(t('payroll_paid_failed'), 'error')
        }
    }

    const waive = async (debt: { id: string; name: string; amount: number }, reason: string) => {
        setWaiving(debt.id)
        try {
            const res = await fetch(`/api/debts/${debt.id}/waive`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ reason }),
            })
            const body = await res.json()
            showToast(res.ok ? t('payroll_debt_waived') : (body?.error || t('error_generic')), res.ok ? 'success' : 'error')
            if (res.ok) load()
        } catch {
            showToast(t('error_generic'), 'error')
        } finally {
            setWaiving(null)
        }
    }

    const digits = isRtl ? 'ar-EG' : 'en-GB'
    const count = (n: number) => n.toLocaleString(digits)
    const months = Array.from({ length: 12 }, (_, i) => ({
        value: String(i + 1),
        label: new Date(2000, i).toLocaleString(digits, { month: 'long' }),
    }))
    const years = Array.from({ length: 5 }, (_, i) => now.getFullYear() - 2 + i).map(y => ({
        value: String(y),
        label: y.toLocaleString(digits, { useGrouping: false }),
    }))

    const register = view?.register
    const isDraft = view?.status === 'DRAFT'
    const canPrepare = can('payroll.prepare')
    const canApprove = can('payroll.approve')
    const canIssue = can('payroll.issue_payslips')
    const canMarkPaid = can('payroll.mark_paid')
    const canWaive = can('debts.waive')
    const delivery = view?.delivery
    const today = new Date().toISOString().slice(0, 10)
    const forCompany = companyId ? `?companyId=${encodeURIComponent(companyId)}` : ''

    const card = (children: React.ReactNode, tone?: 'warn' | 'danger') => (
        <div className="card" style={{
            padding: '1.25rem',
            background: tone === 'warn' ? 'var(--warn-bg)' : tone === 'danger' ? 'var(--danger-bg)' : 'var(--surface)',
            border: `1px solid ${tone === 'warn' ? 'var(--warn-border, var(--border))' : tone === 'danger' ? 'var(--danger-border)' : 'var(--border)'}`,
            borderRadius: '1rem',
        }}>{children}</div>
    )

    // Who moved since the draft was saved, and since last month, the unchanged
    // left out; last month's change lists the first few and says how many more.
    const sinceDraft = view?.sinceDraft?.people.filter(p => p.kind !== 'SAME') ?? []
    const varied = view?.variance?.people.filter(p => p.kind !== 'SAME') ?? []
    const when = (iso: string) => new Date(iso).toLocaleString(digits, { dateStyle: 'medium', timeStyle: 'short' })
    // Attendance's dry run: each person on the register it would deduct from or pay.
    const dryRun = view?.attendance && !view.attendance.reachesPayroll
        ? Object.entries(view.attendance.byPerson)
            .map(([userId, m]) => ({ userId, name: register?.entries.find(e => e.userId === userId)?.name ?? '', ...m, deductions: m.lateness + m.earlyLeave + m.absence }))
            .filter(r => r.name && (r.deductions > 0 || r.overtime > 0))
        : []

    const totals: Tile[] = register ? [
        { label: t('payroll_payable'), value: money(register.payableMinor) },
        { label: t('payroll_included'), value: count(register.includedCount) },
        ...(register.excludedCount > 0 ? [{ label: t('payroll_excluded'), value: count(register.excludedCount) }] : []),
        ...(register.carriedMinor > 0 ? [{ label: t('payroll_carried'), value: money(register.carriedMinor) }] : []),
    ] : []

    return (
        <Page>
            <PageHeader
                title={(
                    <span className="ui-title-with-badge">
                        {t('payroll_register')}
                        {view && <StatusBadge tone={STATUS_TONE[view.status]}>{t(`payroll_status_${view.status}` as TranslationKey)}</StatusBadge>}
                    </span>
                )}
                subtitle={`${new Date(year, month - 1).toLocaleString(digits, { month: 'long', year: 'numeric' })}${view ? ` · ${t('payroll_payday_line').replace('{day}', count(view.payrollDay))}` : ''}`}
                // A draft's: saving it, and approving it, which asks first.
                action={isDraft && (canPrepare || canApprove) && (
                    <>
                        {canPrepare && (
                            <Button onClick={() => action.run('save', save)} disabled={action.running} busy={action.is('save')}>
                                {t('payroll_save_draft')}
                            </Button>
                        )}
                        {canApprove && (
                            <Button variant="primary" onClick={() => setConfirming({ kind: 'approve' })} disabled={action.running || !register || register.includedCount === 0}>
                                {t('payroll_approve')}
                            </Button>
                        )}
                    </>
                )}
            />

            <PeriodBar>
                {isSuper && (
                    <Field label={t('payroll_company')} className="ui-period-wide">{p => (
                        <Select {...p} value={companyId} onChange={e => setCompanyId(e.target.value)} options={[
                            { value: '', label: t('payroll_pick_company') },
                            ...companies.map(c => ({ value: c.id, label: c.name })),
                        ]} />
                    )}</Field>
                )}
                <Field label={t('payroll_month')}>{p => (
                    <Select {...p} value={String(month)} onChange={e => setMonth(Number(e.target.value))} options={months} />
                )}</Field>
                <Field label={t('payroll_year')}>{p => (
                    <Select {...p} value={String(year)} onChange={e => setYear(Number(e.target.value))} options={years} />
                )}</Field>
            </PeriodBar>

            {isSuper && !companyId ? (
                <div className="ui-panel"><EmptyState icon={BuildingsIcon} title={t('payroll_pick_company_hint')} /></div>
            ) : error ? (
                <div className="ui-panel">
                    <EmptyState
                        icon={WarningCircleIcon}
                        title={t('payroll_load_failed')}
                        detail={(error as SWRError).info?.error}
                        action={<Button busy={isValidating} onClick={() => { void load() }}>{t('try_again')}</Button>}
                    />
                </div>
            ) : !view && (
                <div className="ui-panel" role="status"><EmptyState icon={HourglassIcon} title={t('payroll_loading')} /></div>
            )}

            {view && !isDraft && <Card><p>{t('payroll_approved_locked')}</p></Card>}

            {/* Sending and paying. Only after approval, and the two halves are
                side by side because they are independent: payslips can go out
                before the transfer clears, or after, and neither waits on the
                other. Each half's button is for whoever may do it. */}
            {view && !isDraft && delivery && (canIssue || canMarkPaid) && (
                <Card title={t('payroll_delivery')}>
                    <p className="ui-card-note">{t('payroll_delivery_msg')}</p>
                    <div className="ui-columns">
                        <section>
                            <h3 className="ui-subsection-title">{t('payroll_issue')}</h3>
                            {delivery.sendable === 0 ? (
                                <p className="ui-card-note">{t('payroll_issue_none')}</p>
                            ) : (
                                <>
                                    <p className="ui-num">
                                        {t('payroll_issue_progress').replace('{sent}', count(delivery.sent)).replace('{total}', count(delivery.sendable))}
                                    </p>
                                    {delivery.unsent === 0 ? (
                                        <p className="ui-card-note">{t('payroll_issue_all_sent')}</p>
                                    ) : canIssue && (
                                        <div className="ui-form-actions">
                                            <Button variant="primary" onClick={() => action.run('issue', issue)} disabled={action.running} busy={action.is('issue')}>
                                                {t('payroll_issue_next').replace('{n}', count(Math.min(delivery.batchSize, delivery.unsent)))}
                                            </Button>
                                        </div>
                                    )}
                                </>
                            )}
                        </section>
                        <section>
                            <h3 className="ui-subsection-title">{t('payroll_mark_paid')}</h3>
                            {delivery.paidAt ? (
                                // Kept as the day picked: the start of it, in UTC.
                                <p>{`${t('payroll_paid_on')} ${dayLabel(delivery.paidAt.slice(0, 10), locale)}`}</p>
                            ) : canMarkPaid ? (
                                <>
                                    {/* A date rather than a switch: a transfer made on the
                                        25th is usually recorded on the 27th, and stamping
                                        the 27th makes the record disagree with the bank. */}
                                    <DatePickerSingle asField label={t('payroll_paid_date')} hint={t('payroll_paid_date_hint')} value={paidAt} maxDate={today} onChange={setPaidAt} disabled={action.running} />
                                    <div className="ui-form-actions">
                                        <Button onClick={() => setConfirming({ kind: 'paid' })} disabled={action.running}>{t('payroll_mark_paid')}</Button>
                                    </div>
                                </>
                            ) : (
                                <p className="ui-card-note">{t('payroll_not_paid_yet')}</p>
                            )}
                        </section>
                    </div>
                </Card>
            )}

            {/* The register as a file, draft included, once it's stored: the
                filename carries the status, so a draft's can't be taken for an
                approved one's. Beside the totals rather than in the header,
                where it made a third button beside Save draft and Approve. */}
            {register && (
                <Section
                    title={t('payroll_totals')}
                    action={delivery && <SectionLink download href={`/api/payroll/${year}/${month}/export${forCompany}`}>{t('payroll_export')}</SectionLink>}
                >
                    <TotalTiles items={totals} />
                </Section>
            )}

            {/* E1: what has moved since the draft on screen was saved, and
                only when something did, because its job is to interrupt:
                approval is irreversible, and the gap between reading a
                register and signing it is where a late adjustment lands
                unnoticed. Above the month-on-month change. */}
            {isDraft && sinceDraft.length > 0 && (
                <Card tone="waiting" title={t('payroll_since_draft')} actions={<strong className="ui-num">{signedMoney(view!.sinceDraft!.deltaMinor)}</strong>}>
                    <p>{t('payroll_since_draft_msg').replace('{when}', view!.draftSavedAt ? when(view!.draftSavedAt) : '—')}</p>
                    <ul className="ui-rows" aria-label={t('payroll_since_draft')}>
                        {sinceDraft.map(p => (
                            // The stored draft has no names, so the computed side
                            // supplies them; a row only the draft had has none,
                            // and says so rather than showing blank, which says
                            // what "Gone" would too.
                            <Row key={p.userId} title={p.name || t('payroll_since_draft_gone')} detail={p.name ? t(`payroll_variance_${p.kind}` as TranslationKey) : undefined} end={<span className="ui-num">{signedMoney(p.deltaMinor)}</span>} />
                        ))}
                    </ul>
                </Card>
            )}

            {/* What moved since last month. Null and zero are different
                answers, so they read differently: one says nothing changed,
                the other that there is nothing to compare against. */}
            {view && (
                <Card title={t('payroll_variance')} actions={view.variance && <strong className="ui-num">{signedMoney(view.variance.deltaMinor)}</strong>}>
                    {!view.variance ? (
                        <p className="ui-card-note">{t('payroll_no_previous')}</p>
                    ) : varied.length === 0 ? (
                        <p className="ui-card-note">{t('payroll_variance_SAME')}</p>
                    ) : (
                        <>
                            <ul className="ui-rows" aria-label={t('payroll_variance')}>
                                {varied.slice(0, VARIANCE_SHOWN).map(p => (
                                    <Row key={p.userId} title={p.name} detail={t(`payroll_variance_${p.kind}` as TranslationKey)} end={<span className="ui-num">{signedMoney(p.deltaMinor)}</span>} />
                                ))}
                            </ul>
                            {varied.length > VARIANCE_SHOWN && <p className="ui-card-note">{t('payroll_variance_more').replace('{n}', count(varied.length - VARIANCE_SHOWN))}</p>}
                        </>
                    )}
                </Card>
            )}

            {register && register.pendingDecisions.length > 0 && (
                <Card tone="waiting" title={t('payroll_pending_decisions')}>
                    <p>{t('payroll_pending_decisions_msg')}</p>
                    <ul className="ui-rows" aria-label={t('payroll_pending_decisions')}>
                        {register.pendingDecisions.map(p => (
                            <Row key={p.userId} title={p.name} end={t('payroll_undecided_days').replace('{n}', count(p.undecidedDays))} />
                        ))}
                    </ul>
                    {/* The acknowledgement lives here, with the names it is
                        about, rather than next to the Approve button. A tickbox
                        beside a button is a step in pressing the button; one
                        beside the list is a statement about the list. */}
                    {isDraft && (
                        <label className="ui-choice">
                            <input type="checkbox" className="ui-check" checked={acknowledged} onChange={e => setAcknowledged(e.target.checked)} />
                            {t('payroll_acknowledge_pending')}
                        </label>
                    )}
                </Card>
            )}

            {view && view.refused.length > 0 && (
                <Card tone="problem" title={t('payroll_refused')}>
                    <p>{t('payroll_refused_msg')}</p>
                    <ul className="ui-rows" aria-label={t('payroll_refused')}>
                        {view.refused.map(r => <Row key={r.userId} title={r.name} detail={r.reason} />)}
                    </ul>
                </Card>
            )}

            {/* What attendance costs this month: on the payslips once it
                reaches payroll; before then, what it would cost each person,
                deducted from nobody (ATTENDANCE_PLAN.md §20). */}
            {view?.attendance && (view.attendance.reachesPayroll ? (
                <Card title={t('attpay_title')}>
                    <p>{view.attendance.from
                        ? t('attpay_register_on').replace('{month}', new Date(`${view.attendance.from}-01T00:00:00Z`).toLocaleDateString(digits, { month: 'long', year: 'numeric', timeZone: 'UTC' }))
                        : t('attpay_register_on_approved')}</p>
                </Card>
            ) : dryRun.length > 0 && (
                <Card title={t('attpay_dry_title')}>
                    <p>{t('attpay_dry_msg')
                        .replace('{deductions}', money(dryRun.reduce((s, r) => s + r.deductions, 0)))
                        .replace('{overtime}', money(dryRun.reduce((s, r) => s + r.overtime, 0)))}</p>
                    <ul className="ui-rows" aria-label={t('attpay_dry_title')}>
                        {dryRun.map(r => (
                            <Row key={r.userId} title={r.name} end={(
                                <span className="ui-num">
                                    {[r.deductions > 0 ? `−${money(r.deductions)}` : null, r.overtime > 0 ? `+${money(r.overtime)}` : null].filter(Boolean).join(' · ')}
                                </span>
                            )} />
                        ))}
                    </ul>
                </Card>
            ))}

            {/* Attendance changed after its month's payroll was approved
                (ATTENDANCE_PLAN.md §12.3): whenever any is open, whatever the
                switch says now. A page at a time, and every one shown: each is
                money owed. */}
            {discrepancies.length > 0 && (
                <Card tone="waiting" title={`${t('attpay_changed_title')} (${count(discrepanciesOpen)})`}>
                    <p>{t('attpay_changed_msg')}</p>
                    <ul className="ui-rows" aria-label={t('attpay_changed_title')}>
                        {discrepancies.map(d => (
                            <Row
                                key={d.id}
                                title={<>{dayLabel(d.date, locale)} · <bdi>{d.name}</bdi></>}
                                // The arrow points the way the page reads.
                                detail={`${t(`audit_value_${d.paidStatus}` as TranslationKey)} ${isRtl ? '←' : '→'} ${d.nowStatus ? t(`audit_value_${d.nowStatus}` as TranslationKey) : '—'}`}
                                end={<>
                                    <span className="ui-num">
                                        {d.differenceMinor > 0 ? t('attpay_owed_to').replace('{amount}', money(d.differenceMinor)) : t('attpay_owed_by').replace('{amount}', money(-d.differenceMinor))}
                                    </span>
                                    {canPrepare && <Button size="sm" onClick={() => openResolve(d)}>{t('attpay_resolve')}</Button>}
                                </>}
                            />
                        ))}
                    </ul>
                    {moreDiscrepancies && (
                        <div className="ui-form-actions">
                            <Button variant="quiet" onClick={() => setDiscrepancyPageCount(discrepancyPageCount + 1)}>{t('attpay_show_more')}</Button>
                        </div>
                    )}
                </Card>
            )}

            {register && card(
                register.entries.length === 0 ? (
                    <p style={{ margin: 0, color: 'var(--text-muted)' }}>{t('payroll_empty')}</p>
                ) : (
                    <div style={{ display: 'flex', flexDirection: 'column' }}>
                        {register.entries.map(entry => (
                            <div key={entry.userId} style={{
                                borderTop: '1px solid var(--border)',
                                padding: '0.75rem 0',
                                opacity: entry.excluded ? 0.6 : 1,
                            }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', alignItems: 'baseline', flexWrap: 'wrap' }}>
                                    <button
                                        onClick={() => setOpen(open === entry.userId ? null : entry.userId)}
                                        style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'inherit', font: 'inherit', textAlign: isRtl ? 'right' : 'left' }}
                                    >
                                        <strong>{entry.name}</strong>
                                        <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem', marginInlineStart: '0.5rem' }}>
                                            {entry.daysPaid} {t('payroll_days_paid')}
                                            {entry.undecidedDays > 0 && ` · ${t('payroll_undecided_days').replace('{n}', String(entry.undecidedDays))}`}
                                        </span>
                                        {entry.excluded && (
                                            <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                                                {t('payroll_excluded')}: {entry.exclusionReason}
                                            </div>
                                        )}
                                    </button>
                                    <span style={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums', display: 'flex', alignItems: 'baseline', gap: '0.6rem' }}>
                                        {/* G5: the document existed at a URL
                                            nothing linked to. Shown only once a
                                            draft has been saved — a computed row
                                            that was never stored has no payslip,
                                            and a link to one that does not exist
                                            is worse than no link. */}
                                        {view?.payslipIds?.[entry.userId] && !entry.excluded && (
                                            <a
                                                href={`/dashboard/documents/payslip/${view.payslipIds[entry.userId]}`}
                                                style={{ fontSize: '0.78rem', fontWeight: 500, color: 'var(--brand-primary-text)' }}
                                                onClick={e => e.stopPropagation()}
                                            >
                                                {t('payroll_view_payslip')}
                                            </a>
                                        )}
                                        {money(entry.totals.netMinor)}
                                        {entry.totals.carriedMinor > 0 && (
                                            <span style={{ color: 'var(--danger-fg-strong)', fontSize: '0.8rem', marginInlineStart: '0.5rem' }}>
                                                +{money(entry.totals.carriedMinor)} {t('payroll_carried')}
                                            </span>
                                        )}
                                    </span>
                                </div>

                                {open === entry.userId && (
                                    <div style={{ marginTop: '0.5rem', paddingInlineStart: '1rem', display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                                        {entry.lines.map((line, i) => (
                                            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                                                <span>{line.source === 'ATTENDANCE' && line.sourceId ? t(`attpay_line_${line.sourceId}` as any) : line.label}</span>
                                                <span style={{ fontVariantNumeric: 'tabular-nums', color: line.kind === 'DEDUCTION' ? 'var(--danger-fg-strong)' : 'inherit' }}>
                                                    {line.kind === 'DEDUCTION' ? '−' : ''}{money(line.amountMinor)}
                                                </span>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                )
            )}

            {/* Marking a difference settled says how, for the record. */}
            <Dialog
                open={confirming?.kind === 'resolve'}
                onClose={closeConfirm}
                title={t('attpay_resolve')}
                actions={<>
                    <Button onClick={closeConfirm} disabled={action.running}>{t('cancel')}</Button>
                    <Button variant="primary" onClick={() => { if (confirming?.kind === 'resolve') void action.run('resolve', () => resolve(confirming.discrepancy)) }} disabled={action.running} busy={action.is('resolve')}>
                        {t('attpay_resolve')}
                    </Button>
                </>}
            >
                {confirming?.kind === 'resolve' && (
                    <p>
                        {dayLabel(confirming.discrepancy.date, locale)} · <bdi>{confirming.discrepancy.name}</bdi>
                    </p>
                )}
                <Field label={t('attpay_resolution')} hint={t('attpay_resolve_hint')} error={resolutionMissing ? t('attpay_resolution_required') : undefined}>{p => (
                    <TextArea {...p} name="resolution" dir="auto" maxLength={500} value={resolution} disabled={action.running}
                        onChange={e => { setResolution(e.target.value); setResolutionMissing(false) }} />
                )}</Field>
            </Dialog>
            {/* Approving and marking paid can't be undone, so each asks first,
                and stays open while it works: the code a high-risk action asks
                for comes up over it. */}
            <Dialog
                open={confirming?.kind === 'approve'}
                onClose={closeConfirm}
                title={t('payroll_approve_title')}
                actions={<>
                    <Button onClick={closeConfirm} disabled={action.running}>{t('cancel')}</Button>
                    <Button variant="primary" onClick={() => action.run('approve', async () => { await approve(); setConfirming(null) })} disabled={action.running} busy={action.is('approve')}>
                        {t('payroll_approve')}
                    </Button>
                </>}
            >
                <p>{t('payroll_approve_msg')}</p>
            </Dialog>
            <Dialog
                open={confirming?.kind === 'paid'}
                onClose={closeConfirm}
                title={t('payroll_mark_paid_title')}
                actions={<>
                    <Button onClick={closeConfirm} disabled={action.running}>{t('cancel')}</Button>
                    <Button variant="primary" onClick={() => action.run('paid', async () => { await markPaid(); setConfirming(null) })} disabled={action.running} busy={action.is('paid')}>
                        {t('payroll_mark_paid')}
                    </Button>
                </>}
            >
                <p>{t('payroll_mark_paid_msg')}</p>
                <Details items={[{ label: t('payroll_paid_date'), value: dayLabel(paidAt, locale) }]} />
            </Dialog>
            {/* Writing off a debt can't be undone either, and records why. */}
            <ConfirmModal
                isOpen={confirming?.kind === 'waive'}
                variant="warning"
                title={confirming?.kind === 'waive' ? t('payroll_debt_waive_title').replace('{name}', confirming.debt.name) : ''}
                message={t('payroll_debt_waive_msg')}
                confirmText={t('payroll_debt_waive')}
                reason={{ label: t('payroll_debt_waive_reason_label'), placeholder: t('payroll_debt_waive_reason_hint') }}
                onCancel={() => setConfirming(null)}
                onConfirm={async (reason) => {
                    const pending = confirming
                    if (pending?.kind === 'waive') await waive(pending.debt, reason ?? '')
                    setConfirming(null)
                }}
            />

            {view && card(
                <>
                    <h2 style={{ margin: '0 0 0.35rem', fontSize: '1.05rem' }}>{t('payroll_debts')}</h2>
                    <p style={{ margin: '0 0 0.75rem', fontSize: '0.85rem', color: 'var(--text-muted)' }}>{t('payroll_debts_msg')}</p>
                    {view.debts.length === 0 ? (
                        <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: '0.9rem' }}>{t('payroll_no_debts')}</p>
                    ) : view.debts.map(d => (
                        <div key={d.id} style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', fontSize: '0.9rem', padding: '0.35rem 0', alignItems: 'baseline' }}>
                            <span>
                                {d.name}
                                {/* Only where they differ. On a debt nothing has
                                    been taken from, the original is the
                                    outstanding figure and saying it twice is
                                    noise. */}
                                {d.recoveredAmount > 0 && (
                                    <span style={{ color: 'var(--text-muted)', fontSize: '0.78rem', marginInlineStart: '0.5rem' }}>
                                        {t('payroll_debt_recovered')
                                            .replace('{paid}', money(Math.round(d.recoveredAmount * 100)))
                                            .replace('{total}', money(Math.round(d.originalAmount * 100)))}
                                    </span>
                                )}
                            </span>
                            <span style={{ display: 'flex', gap: '0.5rem', alignItems: 'baseline' }}>
                                <span style={{ fontVariantNumeric: 'tabular-nums' }}>
                                    {new Intl.NumberFormat(isRtl ? 'ar-EG' : 'en-EG', { minimumFractionDigits: 2 }).format(d.amount)}
                                    <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem', marginInlineStart: '0.5rem' }}>
                                        {new Date(d.dueDate).toLocaleDateString(isRtl ? 'ar-EG' : 'en-GB')}
                                    </span>
                                </span>
                                {canWaive && (
                                    <button
                                        className="btn"
                                        style={{ fontSize: '0.75rem', padding: '0.2rem 0.6rem' }}
                                        disabled={waiving === d.id}
                                        onClick={() => setConfirming({ kind: 'waive', debt: d })}
                                    >
                                        {waiving === d.id ? '…' : t('payroll_debt_waive')}
                                    </button>
                                )}
                            </span>
                        </div>
                    ))}
                </>
            )}
        </Page>
    )
}

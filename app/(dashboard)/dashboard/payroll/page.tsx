'use client'
import { useCallback, useEffect, useMemo, useState } from 'react'
import useSWR from 'swr'
import { fetcher, SWRError } from '@/lib/swr-fetcher'
import { useSession } from 'next-auth/react'
import { useLanguage } from '@/context/LanguageContext'
import { useToast } from '@/context/ToastContext'
import LoadingSpinner from '@/components/LoadingSpinner'
import ConfirmModal from '@/components/ConfirmModal'
import { useCan } from '@/lib/useCan'

/**
 * The register: one month, everybody in it, and what changed.
 *
 * Laid out in the order somebody actually reviews it. The totals first, because
 * that is the number being signed off. Then what moved since last month, which
 * is the only question a reviewer can really answer from one screen. Then the
 * things that are not settled — undecided suspensions, people whose month could
 * not be computed — before the list itself, so nothing that needs a decision is
 * below a long table.
 */

type Line = { kind: 'EARNING' | 'DEDUCTION'; label: string; amountMinor: number; source: string }
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
}

export default function PayrollRegisterPage() {
    const { t, locale } = useLanguage()
    const { showToast } = useToast()
    const { data: session } = useSession()
    const isRtl = locale === 'ar'

    const now = new Date()
    const [year, setYear] = useState(now.getFullYear())
    const [month, setMonth] = useState(now.getMonth() + 1)
    const [saving, setSaving] = useState(false)
    const [open, setOpen] = useState<string | null>(null)
    const [approving, setApproving] = useState(false)
    const [acknowledged, setAcknowledged] = useState(false)
    const [issuing, setIssuing] = useState(false)
    // G3: a Super Admin has no companyId of their own — SuperAdmin has no such
    // column — so without a picker the register resolved to no company and
    // answered 400. The API always supported naming one; this is the control
    // that was missing.
    const [companies, setCompanies] = useState<{ id: string; name: string }[]>([])
    const [companyId, setCompanyId] = useState<string>('')
    const [paying, setPaying] = useState(false)
    const [waiving, setWaiving] = useState<string | null>(null)
    // Which confirmation is open, if any. One piece of state rather than three
    // booleans: only ever one of these is on screen, and three flags is three
    // chances for two to be true at once.
    const [confirming, setConfirming] = useState<
        | { kind: 'approve' }
        | { kind: 'paid' }
        | { kind: 'waive'; debt: { id: string; name: string; amount: number } }
        | null
    >(null)
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
                const res = await fetch('/api/companies?limit=200')
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
    const { data, error, isLoading, mutate: load } = useSWR(registerKey, fetcher, {
        // The last month's register stays up while the next one loads, rather
        // than the screen dropping to a spinner at every step of the picker.
        keepPreviousData: true,
        onError: (err: SWRError) => showToast(err.info?.error || t('error_generic'), 'error'),
    })
    const view: View | null = registerKey && !error ? (data?.data ?? null) : null
    const loading = !session || isLoading

    const save = async () => {
        setSaving(true)
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
        } finally {
            setSaving(false)
        }
    }

    const approve = async () => {
        setApproving(true)
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
        } finally {
            setApproving(false)
        }
    }

    const issue = async () => {
        setIssuing(true)
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
        } finally {
            setIssuing(false)
        }
    }

    const markPaid = async () => {
        setPaying(true)
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
        } finally {
            setPaying(false)
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

    const monthName = useMemo(
        () => new Date(2000, month - 1).toLocaleString(isRtl ? 'ar-EG' : 'en-US', { month: 'long' }),
        [month, isRtl])

    if (loading && !view) return <LoadingSpinner />

    const register = view?.register
    const isDraft = view?.status === 'DRAFT'
    const canPrepare = can('payroll.prepare')
    const canApprove = can('payroll.approve')
    const canDeliver = can('payroll.issue_payslips') || can('payroll.mark_paid')
    const canWaive = can('debts.waive')

    const card = (children: React.ReactNode, tone?: 'warn' | 'danger') => (
        <div className="card" style={{
            padding: '1.25rem',
            background: tone === 'warn' ? 'var(--warn-bg)' : tone === 'danger' ? 'var(--danger-bg)' : 'var(--surface)',
            border: `1px solid ${tone === 'warn' ? 'var(--warn-border, var(--border))' : tone === 'danger' ? 'var(--danger-border)' : 'var(--border)'}`,
            borderRadius: '1rem',
        }}>{children}</div>
    )

    const stat = (label: string, value: string, tone?: string) => (
        <div style={{ minWidth: '9rem' }}>
            <div style={{ fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-muted)' }}>{label}</div>
            <div style={{ fontSize: '1.5rem', fontWeight: 700, color: tone || 'var(--text-strong)', fontVariantNumeric: 'tabular-nums' }}>{value}</div>
        </div>
    )

    return (
        <div style={{ direction: isRtl ? 'rtl' : 'ltr', display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
            <div style={{ display: 'flex', gap: '1rem', alignItems: 'flex-end', flexWrap: 'wrap' }}>
                <div>
                    <h1 style={{ margin: 0 }}>{t('payroll_register')}</h1>
                    <p style={{ margin: '0.25rem 0 0', color: 'var(--text-muted)' }}>
                        {monthName} {year}
                        {view ? ` · ${t('payroll_month')} ${view.payrollDay}` : ''}
                    </p>
                </div>

                <div style={{ display: 'flex', gap: '0.5rem', marginInlineStart: 'auto', flexWrap: 'wrap', alignItems: 'center' }}>
                    {isSuper && (
                        <select
                            className="input"
                            value={companyId}
                            onChange={e => setCompanyId(e.target.value)}
                            style={{ width: 'auto', maxWidth: '14rem' }}
                            aria-label={t('payroll_company')}
                        >
                            <option value="">{t('payroll_pick_company')}</option>
                            {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                        </select>
                    )}
                    <select className="input" value={month} onChange={e => setMonth(Number(e.target.value))} style={{ width: 'auto' }}>
                        {Array.from({ length: 12 }, (_, i) => (
                            <option key={i + 1} value={i + 1}>
                                {new Date(2000, i).toLocaleString(isRtl ? 'ar-EG' : 'en-US', { month: 'long' })}
                            </option>
                        ))}
                    </select>
                    <select className="input" value={year} onChange={e => setYear(Number(e.target.value))} style={{ width: 'auto' }}>
                        {Array.from({ length: 5 }, (_, i) => now.getFullYear() - 2 + i).map(y => (
                            <option key={y} value={y}>{y}</option>
                        ))}
                    </select>
                    {view && (
                        <span style={{
                            padding: '0.35rem 0.75rem', borderRadius: '0.6rem', fontSize: '0.8rem', fontWeight: 700,
                            background: isDraft ? 'var(--surface-sunk)' : 'var(--ok-bg)',
                            color: isDraft ? 'var(--text-muted)' : 'var(--ok-fg)',
                        }}>
                            {t(`payroll_status_${view.status}` as any)}
                        </span>
                    )}
                    {/* A file of whatever is stored, draft included — the
                        filename carries the status, so a draft export cannot be
                        mistaken for an approved one. A plain link rather than a
                        fetch-and-blob: the browser already sends the session
                        cookie, and this way the download behaves like a
                        download. */}
                    {view?.delivery && (
                        <a className="btn" href={`/api/payroll/${year}/${month}/export${companyId ? `?companyId=${encodeURIComponent(companyId)}` : ''}`}>
                            {t('payroll_export')}
                        </a>
                    )}
                    {isDraft && canPrepare && (
                        <button className="btn" onClick={save} disabled={saving || approving}>
                            {saving ? '…' : t('payroll_save_draft')}
                        </button>
                    )}
                    {isDraft && canApprove && (
                        <button
                            className="btn btn-primary"
                            onClick={() => setConfirming({ kind: 'approve' })}
                            disabled={approving || saving || !register || register.includedCount === 0}
                        >
                            {approving ? '…' : t('payroll_approve')}
                        </button>
                    )}
                </div>
            </div>

            {isSuper && !companyId && card(
                <p style={{ margin: 0, color: 'var(--text-muted)' }}>{t('payroll_pick_company_hint')}</p>
            )}

            {view && !isDraft && card(
                <p style={{ margin: 0, fontSize: '0.9rem' }}>{t('payroll_approved_locked')}</p>
            )}

            {/* Sending and paying. Only after approval, and the two halves are
                laid out side by side because they are independent: payslips can
                go out before the transfer clears, or after, and neither waits on
                the other. */}
            {view && !isDraft && view.delivery && canDeliver && card(
                <>
                    <h2 style={{ margin: '0 0 0.35rem', fontSize: '1.05rem' }}>{t('payroll_delivery')}</h2>
                    <p style={{ margin: '0 0 1rem', fontSize: '0.85rem', color: 'var(--text-muted)' }}>{t('payroll_delivery_msg')}</p>

                    <div style={{ display: 'flex', gap: '2rem', flexWrap: 'wrap', alignItems: 'flex-start' }}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', minWidth: '14rem' }}>
                            <div style={{ fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-muted)' }}>
                                {t('payroll_issue')}
                            </div>
                            {view.delivery.sendable === 0 ? (
                                <span style={{ fontSize: '0.9rem', color: 'var(--text-muted)' }}>{t('payroll_issue_none')}</span>
                            ) : (
                                <>
                                    <span style={{ fontSize: '0.9rem', fontVariantNumeric: 'tabular-nums' }}>
                                        {t('payroll_issue_progress')
                                            .replace('{sent}', String(view.delivery.sent))
                                            .replace('{total}', String(view.delivery.sendable))}
                                    </span>
                                    {view.delivery.unsent === 0 ? (
                                        <span style={{ fontSize: '0.85rem', color: 'var(--ok-fg)' }}>{t('payroll_issue_all_sent')}</span>
                                    ) : (
                                        <button className="btn btn-primary" onClick={issue} disabled={issuing} style={{ alignSelf: 'flex-start' }}>
                                            {issuing ? '…' : t('payroll_issue_next')
                                                .replace('{n}', String(Math.min(view.delivery.batchSize, view.delivery.unsent)))}
                                        </button>
                                    )}
                                </>
                            )}
                        </div>

                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', minWidth: '14rem' }}>
                            <div style={{ fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-muted)' }}>
                                {t('payroll_mark_paid')}
                            </div>
                            {view.delivery.paidAt ? (
                                <span style={{ fontSize: '0.9rem' }}>
                                    {t('payroll_paid_on')}{' '}
                                    {new Date(view.delivery.paidAt).toLocaleDateString(isRtl ? 'ar-EG' : 'en-GB')}
                                </span>
                            ) : (
                                <>
                                    <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }} htmlFor="payroll-paid-at">
                                        {t('payroll_paid_date')}
                                    </label>
                                    <input
                                        id="payroll-paid-at"
                                        className="input"
                                        type="date"
                                        value={paidAt}
                                        max={new Date().toISOString().slice(0, 10)}
                                        onChange={e => setPaidAt(e.target.value)}
                                        style={{ width: 'auto' }}
                                    />
                                    <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{t('payroll_paid_date_hint')}</span>
                                    <button
                                        className="btn"
                                        onClick={() => setConfirming({ kind: 'paid' })}
                                        disabled={paying}
                                        style={{ alignSelf: 'flex-start' }}
                                    >
                                        {paying ? '…' : t('payroll_mark_paid')}
                                    </button>
                                </>
                            )}
                        </div>
                    </div>
                </>
            )}

            {register && card(
                <div style={{ display: 'flex', gap: '2rem', flexWrap: 'wrap' }}>
                    {stat(t('payroll_payable'), money(register.payableMinor))}
                    {stat(t('payroll_included'), String(register.includedCount))}
                    {register.excludedCount > 0 && stat(t('payroll_excluded'), String(register.excludedCount), 'var(--text-muted)')}
                    {register.carriedMinor > 0 && stat(t('payroll_carried'), money(register.carriedMinor), 'var(--danger-solid)')}
                </div>
            )}

            {/* E1: what has moved since the draft on screen was saved.
                Shown above the month-on-month variance and only when something
                actually moved, because its job is to interrupt — approval is
                irreversible, and the gap between reading a register and signing
                it is exactly where a late adjustment lands unnoticed. */}
            {(() => {
                const changed = view?.sinceDraft?.people.filter(p => p.kind !== 'SAME') ?? []
                if (!isDraft || changed.length === 0) return null
                return card(
                    <>
                        <h2 style={{ margin: '0 0 0.35rem', fontSize: '1.05rem' }}>{t('payroll_since_draft')}</h2>
                        <p style={{ margin: '0 0 0.75rem', fontSize: '0.85rem' }}>
                            {t('payroll_since_draft_msg').replace(
                                '{when}',
                                view!.draftSavedAt
                                    ? new Date(view!.draftSavedAt).toLocaleString(isRtl ? 'ar-EG' : 'en-GB')
                                    : '—',
                            )}
                        </p>
                        <div style={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums', marginBottom: '0.5rem' }}>
                            {signedMoney(view!.sinceDraft!.deltaMinor)}
                        </div>
                        {changed.map(p => (
                            <div key={p.userId} style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', fontSize: '0.9rem' }}>
                                <span>
                                    {/* The stored draft has no names, so the
                                        computed side supplies them; a row that
                                        appears only in the draft has none and
                                        says so rather than showing blank. */}
                                    {p.name || t('payroll_since_draft_gone')}{' '}
                                    <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                                        {t(`payroll_variance_${p.kind}` as any)}
                                    </span>
                                </span>
                                <span style={{ fontVariantNumeric: 'tabular-nums' }}>{signedMoney(p.deltaMinor)}</span>
                            </div>
                        ))}
                    </>, 'warn')
            })()}

            {/* What moved. Null and zero are different answers, so they read
                differently: one says nothing changed, the other says there is
                nothing to compare against. */}
            {view && card(
                <>
                    <h2 style={{ margin: '0 0 0.5rem', fontSize: '1.05rem' }}>{t('payroll_variance')}</h2>
                    {!view.variance ? (
                        <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: '0.9rem' }}>{t('payroll_no_previous')}</p>
                    ) : (
                        <>
                            <div style={{ fontSize: '1.25rem', fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: view.variance.deltaMinor === 0 ? 'var(--text-muted)' : view.variance.deltaMinor > 0 ? 'var(--warn-fg)' : 'var(--ok-fg)' }}>
                                {signedMoney(view.variance.deltaMinor)}
                            </div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', marginTop: '0.75rem' }}>
                                {view.variance.people.filter(p => p.kind !== 'SAME').slice(0, 8).map(p => (
                                    <div key={p.userId} style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', fontSize: '0.9rem' }}>
                                        <span>
                                            {p.name}{' '}
                                            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                                                {t(`payroll_variance_${p.kind}` as any)}
                                            </span>
                                        </span>
                                        <span style={{ fontVariantNumeric: 'tabular-nums' }}>{signedMoney(p.deltaMinor)}</span>
                                    </div>
                                ))}
                                {view.variance.people.every(p => p.kind === 'SAME') && (
                                    <span style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>
                                        {t('payroll_variance_SAME')}
                                    </span>
                                )}
                            </div>
                        </>
                    )}
                </>
            )}

            {register && register.pendingDecisions.length > 0 && card(
                <>
                    <h2 style={{ margin: '0 0 0.35rem', fontSize: '1.05rem' }}>{t('payroll_pending_decisions')}</h2>
                    <p style={{ margin: '0 0 0.75rem', fontSize: '0.85rem' }}>{t('payroll_pending_decisions_msg')}</p>
                    {register.pendingDecisions.map(p => (
                        <div key={p.userId} style={{ fontSize: '0.9rem' }}>
                            {p.name} — {t('payroll_undecided_days').replace('{n}', String(p.undecidedDays))}
                        </div>
                    ))}
                    {/* The acknowledgement lives here, with the names it is
                        about, rather than next to the Approve button. A tickbox
                        beside a button is a step in pressing the button; one
                        beside the list is a statement about the list. */}
                    {isDraft && (
                        <label style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-start', marginTop: '0.75rem', fontSize: '0.85rem', cursor: 'pointer' }}>
                            <input
                                type="checkbox"
                                checked={acknowledged}
                                onChange={e => setAcknowledged(e.target.checked)}
                                style={{ marginTop: '0.2rem' }}
                            />
                            <span>{t('payroll_acknowledge_pending')}</span>
                        </label>
                    )}
                </>, 'warn')}

            {view && view.refused.length > 0 && card(
                <>
                    <h2 style={{ margin: '0 0 0.35rem', fontSize: '1.05rem' }}>{t('payroll_refused')}</h2>
                    <p style={{ margin: '0 0 0.75rem', fontSize: '0.85rem' }}>{t('payroll_refused_msg')}</p>
                    {view.refused.map(r => (
                        <div key={r.userId} style={{ fontSize: '0.9rem' }}>
                            <strong>{r.name}</strong> — {r.reason}
                        </div>
                    ))}
                </>, 'danger')}

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
                                                style={{ fontSize: '0.78rem', fontWeight: 500, color: 'var(--primary)' }}
                                                onClick={e => e.stopPropagation()}
                                            >
                                                {t('payroll_view_payslip')}
                                            </a>
                                        )}
                                        {money(entry.totals.netMinor)}
                                        {entry.totals.carriedMinor > 0 && (
                                            <span style={{ color: 'var(--danger-solid)', fontSize: '0.8rem', marginInlineStart: '0.5rem' }}>
                                                +{money(entry.totals.carriedMinor)} {t('payroll_carried')}
                                            </span>
                                        )}
                                    </span>
                                </div>

                                {open === entry.userId && (
                                    <div style={{ marginTop: '0.5rem', paddingInlineStart: '1rem', display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                                        {entry.lines.map((line, i) => (
                                            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                                                <span>{line.label}</span>
                                                <span style={{ fontVariantNumeric: 'tabular-nums', color: line.kind === 'DEDUCTION' ? 'var(--danger-solid)' : 'inherit' }}>
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

            {/* One modal, told what it is asking by the state above. Approving
                and marking paid are irreversible; writing off a debt is too, and
                additionally needs to record why — so it is the same dialog with
                a reason field rather than a second dialog that would drift out
                of step with this one. */}
            <ConfirmModal
                isOpen={confirming !== null}
                variant={confirming?.kind === 'waive' ? 'warning' : 'danger'}
                title={
                    confirming?.kind === 'approve' ? t('payroll_approve_title')
                        : confirming?.kind === 'paid' ? t('payroll_mark_paid_title')
                            : confirming?.kind === 'waive'
                                ? t('payroll_debt_waive_title').replace('{name}', confirming.debt.name)
                                : ''
                }
                message={
                    confirming?.kind === 'approve' ? t('payroll_approve_msg')
                        : confirming?.kind === 'paid' ? t('payroll_mark_paid_msg')
                            : confirming?.kind === 'waive' ? t('payroll_debt_waive_msg')
                                : ''
                }
                confirmText={
                    confirming?.kind === 'approve' ? t('payroll_approve')
                        : confirming?.kind === 'paid' ? t('payroll_mark_paid')
                            : t('payroll_debt_waive')
                }
                reason={confirming?.kind === 'waive'
                    ? { label: t('payroll_debt_waive_reason_label'), placeholder: t('payroll_debt_waive_reason_hint') }
                    : undefined}
                onCancel={() => setConfirming(null)}
                onConfirm={(reason) => {
                    const pending = confirming
                    setConfirming(null)
                    if (pending?.kind === 'approve') approve()
                    else if (pending?.kind === 'paid') markPaid()
                    else if (pending?.kind === 'waive') waive(pending.debt, reason ?? '')
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
        </div>
    )
}

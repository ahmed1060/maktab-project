'use client'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSession } from 'next-auth/react'
import { useLanguage } from '@/context/LanguageContext'
import { useToast } from '@/context/ToastContext'
import LoadingSpinner from '@/components/LoadingSpinner'

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
    debts: { id: string; userId: string; name: string; amount: number; dueDate: string; source: string }[]
}

export default function PayrollRegisterPage() {
    const { t, locale } = useLanguage()
    const { showToast } = useToast()
    const { data: session } = useSession()
    const isRtl = locale === 'ar'

    const now = new Date()
    const [year, setYear] = useState(now.getFullYear())
    const [month, setMonth] = useState(now.getMonth() + 1)
    const [view, setView] = useState<View | null>(null)
    const [loading, setLoading] = useState(true)
    const [saving, setSaving] = useState(false)
    const [open, setOpen] = useState<string | null>(null)

    const money = useCallback((minor: number) =>
        new Intl.NumberFormat(isRtl ? 'ar-EG' : 'en-EG', {
            minimumFractionDigits: 2, maximumFractionDigits: 2,
        }).format(minor / 100), [isRtl])

    const signedMoney = useCallback((minor: number) =>
        `${minor > 0 ? '+' : minor < 0 ? '−' : ''}${money(Math.abs(minor))}`, [money])

    const load = useCallback(async () => {
        setLoading(true)
        try {
            const res = await fetch(`/api/payroll/${year}/${month}`)
            const body = await res.json()
            if (!res.ok) {
                showToast(body?.error || t('error_generic'), 'error')
                setView(null)
                return
            }
            setView(body.data)
        } catch {
            showToast(t('error_generic'), 'error')
        } finally {
            setLoading(false)
        }
    }, [year, month, showToast, t])

    useEffect(() => { load() }, [load])

    const save = async () => {
        setSaving(true)
        try {
            const res = await fetch(`/api/payroll/${year}/${month}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({}),
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

    const monthName = useMemo(
        () => new Date(2000, month - 1).toLocaleString(isRtl ? 'ar-EG' : 'en-US', { month: 'long' }),
        [month, isRtl])

    if (loading && !view) return <LoadingSpinner />

    const register = view?.register
    const isDraft = view?.status === 'DRAFT'

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
                    {isDraft && ['ADMIN', 'SUPER_ADMIN'].includes((session?.user as any)?.role || '') && (
                        <button className="btn btn-primary" onClick={save} disabled={saving}>
                            {saving ? '…' : t('payroll_save_draft')}
                        </button>
                    )}
                </div>
            </div>

            {view && !isDraft && card(
                <p style={{ margin: 0, fontSize: '0.9rem' }}>{t('payroll_approved_locked')}</p>
            )}

            {register && card(
                <div style={{ display: 'flex', gap: '2rem', flexWrap: 'wrap' }}>
                    {stat(t('payroll_payable'), money(register.payableMinor))}
                    {stat(t('payroll_included'), String(register.includedCount))}
                    {register.excludedCount > 0 && stat(t('payroll_excluded'), String(register.excludedCount), 'var(--text-muted)')}
                    {register.carriedMinor > 0 && stat(t('payroll_carried'), money(register.carriedMinor), 'var(--danger-solid)')}
                </div>
            )}

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
                                    <span style={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
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

            {view && card(
                <>
                    <h2 style={{ margin: '0 0 0.35rem', fontSize: '1.05rem' }}>{t('payroll_debts')}</h2>
                    <p style={{ margin: '0 0 0.75rem', fontSize: '0.85rem', color: 'var(--text-muted)' }}>{t('payroll_debts_msg')}</p>
                    {view.debts.length === 0 ? (
                        <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: '0.9rem' }}>{t('payroll_no_debts')}</p>
                    ) : view.debts.map(d => (
                        <div key={d.id} style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', fontSize: '0.9rem', padding: '0.25rem 0' }}>
                            <span>{d.name}</span>
                            <span style={{ fontVariantNumeric: 'tabular-nums' }}>
                                {new Intl.NumberFormat(isRtl ? 'ar-EG' : 'en-EG', { minimumFractionDigits: 2 }).format(d.amount)}
                                <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem', marginInlineStart: '0.5rem' }}>
                                    {new Date(d.dueDate).toLocaleDateString(isRtl ? 'ar-EG' : 'en-GB')}
                                </span>
                            </span>
                        </div>
                    ))}
                </>
            )}
        </div>
    )
}

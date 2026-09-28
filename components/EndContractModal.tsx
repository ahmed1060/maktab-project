'use client'
import { useCallback, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useLanguage } from '@/context/LanguageContext'
import { useToast } from '@/context/ToastContext'
import useSWR from 'swr'
import { fetcher } from '@/lib/swr-fetcher'
import TeamHandOffModal from './TeamHandOffModal'

/**
 * Ending somebody's contract, with the settlement shown before it happens.
 *
 * The preview is the reason this is a screen of its own rather than another
 * option in the status dropdown. The sign turns on whether the month's salary
 * had already gone out: the same leaving date is money owed to the person or
 * money owed back by them, and an admin picking a date has to see which before
 * they commit — not read it off a payslip a fortnight later.
 *
 * It recomputes on every change of date, from the same endpoint the commit
 * uses, so the figure on the confirmation is the figure that gets recorded.
 */

type Preview = {
    year: number
    month: number
    lastWorkingDay: number
    daysWorked: number
    earned: number
    paid: number
    net: number
    direction: 'COMPANY_OWES' | 'PERSON_OWES' | 'SETTLED'
    paidSource: 'PAYSLIP' | 'RUN_NOT_PAID' | 'NO_RUN'
    debtsOutstanding: number
    debtRecovered: number
    payable: number
}

type Timeline = {
    suspensions: { fromDay: number; toDay: number; deduct: boolean | null }[]
}

type Props = {
    userId: string
    name: string
    /** ARCHIVED shows the reinstate path instead. */
    status: string
    onClose: () => void
    onDone: () => void
}

/** Today as YYYY-MM-DD on the viewer's own calendar — the default leaving date. */
const todayStr = () => {
    const now = new Date()
    const pad = (n: number) => String(n).padStart(2, '0')
    return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

export default function EndContractModal({ userId, name, status, onClose, onDone }: Props) {
    const { t, locale } = useLanguage()
    const { showToast } = useToast()
    const isArchived = status === 'ARCHIVED'

    const [lastWorkingDay, setLastWorkingDay] = useState(todayStr)
    const [reason, setReason] = useState('')
    const [preview, setPreview] = useState<Preview | null>(null)
    const [timeline, setTimeline] = useState<Timeline | null>(null)
    const [previewError, setPreviewError] = useState<string | null>(null)
    // The leaving date the preview on screen was worked out for. Loading is
    // derived from it rather than switched on inside the effect: whenever the
    // date on the form is not the one the preview answers, a new one is on
    // its way.
    const [previewedFor, setPreviewedFor] = useState<string | null>(null)
    const loading = !isArchived && !!lastWorkingDay && previewedFor !== lastWorkingDay
    const [submitting, setSubmitting] = useState(false)
    // Set when the server says this person still leads a team: the people it
    // named, for the hand-off popup to ask about before the contract ends.
    const [handoff, setHandoff] = useState<{ id: string; firstName: string; lastName: string }[] | null>(null)
    // Who could take them — asked for only once the question comes up.
    const { data: leadersResult } = useSWR(handoff ? '/api/users?role=TEAM_LEADER&limit=1000' : null, fetcher)
    const leaders: { id: string; firstName: string; lastName: string }[] = leadersResult?.data?.data || []

    const money = useCallback((amount: number) =>
        new Intl.NumberFormat(locale === 'ar' ? 'ar-EG' : 'en-EG', {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
        }).format(Math.abs(amount)), [locale])

    useEffect(() => {
        if (isArchived || !lastWorkingDay) return
        let cancelled = false
        // Debounced: a date input fires on every keystroke while somebody types
        // a year, and each one would be a settlement calculation.
        const timer = setTimeout(async () => {
            try {
                const res = await fetch(`/api/users/${userId}/employment?lastWorkingDay=${lastWorkingDay}`)
                const body = await res.json()
                if (cancelled) return
                if (!res.ok) {
                    setPreview(null)
                    setPreviewError(body?.error || t('error_generic'))
                    return
                }
                setPreview(body.data.preview)
                setTimeline(body.data.timeline)
                setPreviewError(null)
            } catch {
                if (!cancelled) setPreviewError(t('error_generic'))
            } finally {
                if (!cancelled) setPreviewedFor(lastWorkingDay)
            }
        }, 350)
        return () => { cancelled = true; clearTimeout(timer) }
    }, [userId, lastWorkingDay, isArchived, t])

    /**
     * `reassignTo` is the hand-off answer: left out on the first attempt, so
     * the server can ask; then an id to move the team or null to leave them
     * unassigned. Never an empty string.
     */
    const submit = async (action: 'END_CONTRACT' | 'REINSTATE', reassignTo?: string | null) => {
        setSubmitting(true)
        try {
            const res = await fetch(`/api/users/${userId}/employment`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    action,
                    lastWorkingDay,
                    reason: reason || undefined,
                    ...(reassignTo !== undefined && { reassignReportsTo: reassignTo }),
                }),
            })
            const body = await res.json()
            if (!res.ok) {
                // Not an error to report — a question to ask. The refusal
                // names who still reports to them.
                const reports = body?.details?.reports
                if (Array.isArray(reports) && reports.length > 0) {
                    setHandoff(reports)
                    return
                }
                showToast(body?.error || t('error_generic'), 'error')
                return
            }
            onDone()
            onClose()
        } catch {
            showToast(t('error_generic'), 'error')
        } finally {
            setSubmitting(false)
        }
    }

    const undecided = (timeline?.suspensions ?? [])
        .filter(s => s.deduct === null)
        .reduce((days, s) => days + (s.toDay - s.fromDay + 1), 0)

    const directionLabel = preview?.direction === 'COMPANY_OWES'
        ? t('settlement_company_owes')
        : preview?.direction === 'PERSON_OWES'
            ? t('settlement_person_owes')
            : t('settlement_settled')

    const directionColor = preview?.direction === 'PERSON_OWES'
        ? 'var(--danger-solid)'
        : preview?.direction === 'COMPANY_OWES'
            ? 'var(--ok-solid-alt)'
            : 'var(--text-muted)'

    const row = (label: string, value: string, strong = false) => (
        <div style={{
            display: 'flex', justifyContent: 'space-between', gap: '1rem',
            padding: '0.4rem 0', fontSize: strong ? '1rem' : '0.875rem',
            fontWeight: strong ? 600 : 400,
            borderTop: strong ? '1px solid var(--border)' : undefined,
            marginTop: strong ? '0.25rem' : undefined,
        }}>
            <span style={{ color: strong ? 'var(--text-strong)' : 'var(--text-muted)' }}>{label}</span>
            <span style={{ fontVariantNumeric: 'tabular-nums' }}>{value}</span>
        </div>
    )

    return <>{createPortal(
        <div className="modal-overlay">
            <div className="modal-content" style={{ maxWidth: '480px', width: '92%' }}>
                <div className="modal-header">
                    <h3 className="modal-title">
                        {isArchived ? t('reinstate_title') : t('end_contract_title')}
                    </h3>
                    <button className="modal-close" onClick={onClose}>&times;</button>
                </div>

                <div className="modal-body" style={{ textAlign: locale === 'ar' ? 'right' : 'left' }}>
                    <p style={{ marginTop: 0, color: 'var(--text-muted)', fontSize: '0.9rem' }}>
                        {name}
                    </p>

                    {isArchived ? (
                        <p style={{ fontSize: '0.9rem' }}>{t('reinstate_msg')}</p>
                    ) : (
                        <>
                            <label style={{ display: 'block', marginBottom: '0.4rem', fontSize: '0.875rem' }}>
                                {t('last_working_day')}
                            </label>
                            <input aria-label={t('last_working_day')}
                                type="date"
                                className="input"
                                value={lastWorkingDay}
                                onChange={e => setLastWorkingDay(e.target.value)}
                            />
                            <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', margin: '0.4rem 0 1rem' }}>
                                {t('last_working_day_hint')}
                            </p>

                            <div style={{
                                background: 'var(--surface-sunk)', borderRadius: '8px',
                                padding: '0.75rem 1rem', marginBottom: '1rem',
                            }}>
                                <div style={{ fontSize: '0.75rem', letterSpacing: '0.04em', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: '0.5rem' }}>
                                    {t('settlement_preview')}
                                </div>

                                {previewError && (
                                    <p style={{ margin: 0, color: 'var(--danger-solid)', fontSize: '0.85rem' }}>{previewError}</p>
                                )}

                                {!previewError && preview && (
                                    <>
                                        {row(t('settlement_days_worked'), String(preview.daysWorked))}
                                        {row(t('settlement_earned'), money(preview.earned))}
                                        {row(t('settlement_paid'), money(preview.paid))}
                                        {row(t('settlement_net'), money(preview.net), true)}
                                        {/* Shown before the contract ends, not
                                            discovered on the statement after.
                                            What cannot be taken out of the
                                            settlement stays a debt, and saying
                                            so here is the difference between a
                                            decision and a surprise. */}
                                        {preview.debtsOutstanding > 0 && (
                                            <>
                                                {row(t('settlement_debt_recovered'), money(preview.debtRecovered))}
                                                {row(t('settlement_payable'), money(preview.payable), true)}
                                                {preview.debtsOutstanding > preview.debtRecovered && (
                                                    <p style={{ fontSize: '0.75rem', color: 'var(--warn-fg)', margin: '0.4rem 0 0', fontWeight: 600 }}>
                                                        {t('settlement_debt_remains').replace(
                                                            '{amount}',
                                                            money(preview.debtsOutstanding - preview.debtRecovered),
                                                        )}
                                                    </p>
                                                )}
                                            </>
                                        )}
                                        <div style={{ color: directionColor, fontSize: '0.85rem', marginTop: '0.5rem', fontWeight: 600 }}>
                                            {directionLabel}
                                        </div>
                                        {/* The caveat is shown only when it is
                                            true. It used to be unconditional,
                                            because nothing could be read — now
                                            the usual case is a figure taken
                                            from the payslip that was actually
                                            paid, and printing "provisional"
                                            over a fact teaches people to
                                            disregard the word when it matters. */}
                                        <p style={{
                                            fontSize: '0.7rem', margin: '0.5rem 0 0',
                                            // The unpaid-run case is the one to
                                            // act on, so it does not read like
                                            // the same quiet footnote as the
                                            // other two.
                                            color: preview.paidSource === 'RUN_NOT_PAID' ? 'var(--warn-fg)' : 'var(--text-muted)',
                                            fontWeight: preview.paidSource === 'RUN_NOT_PAID' ? 600 : 400,
                                        }}>
                                            {preview.paidSource === 'PAYSLIP' ? t('settlement_paid_from_payslip')
                                                : preview.paidSource === 'RUN_NOT_PAID' ? t('settlement_run_not_paid')
                                                    : t('settlement_provisional')}
                                        </p>
                                    </>
                                )}

                                {!previewError && !preview && (
                                    <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                                        {loading ? '…' : ''}
                                    </p>
                                )}
                            </div>

                            {undecided > 0 && (
                                <p style={{ fontSize: '0.8rem', color: 'var(--warn-fg)', background: 'var(--warn-bg)', padding: '0.5rem 0.75rem', borderRadius: '6px' }}>
                                    {t('end_contract_undecided').replace('{n}', String(undecided))}
                                </p>
                            )}

                            <label style={{ display: 'block', margin: '0.5rem 0 0.4rem', fontSize: '0.875rem' }}>
                                {t('end_contract_reason')}
                            </label>
                            <textarea aria-label={t('end_contract_reason')}
                                className="input"
                                rows={2}
                                value={reason}
                                onChange={e => setReason(e.target.value)}
                            />

                            <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: 0 }}>
                                {lastWorkingDay && lastWorkingDay <= todayStr()
                                    ? t('end_contract_effective_now')
                                    : t('end_contract_effective_later')}
                            </p>
                        </>
                    )}
                </div>

                <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end', padding: '0 1.5rem 1.5rem' }}>
                    <button type="button" className="btn" style={{ background: 'var(--border)', color: 'var(--text-strong)' }} onClick={onClose}>
                        {t('close_button')}
                    </button>
                    <button
                        type="button"
                        className="btn"
                        style={{ background: isArchived ? 'var(--primary)' : 'var(--danger-fill)', color: 'var(--text-on-accent)' }}
                        disabled={submitting || (!isArchived && !preview)}
                        onClick={() => submit(isArchived ? 'REINSTATE' : 'END_CONTRACT')}
                    >
                        {isArchived ? t('reinstate') : t('end_contract_confirm')}
                    </button>
                </div>
            </div>
        </div>,
        document.body,
    )}
        {handoff && (
            <TeamHandOffModal
                leaderId={userId}
                leaderName={name}
                reports={handoff}
                leaders={leaders}
                busy={submitting}
                onCancel={() => setHandoff(null)}
                onConfirm={reassignTo => {
                    setHandoff(null)
                    submit('END_CONTRACT', reassignTo)
                }}
            />
        )}
    </>
}

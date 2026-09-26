'use client'

import { useEffect, useState } from 'react'
import { useLanguage } from '@/context/LanguageContext'
import { useNow } from '@/lib/useNow'

type Job = {
    job: string
    label: string
    everyHours: number
    lastRunAt: string | null
    lastSuccessAt: string | null
    lastError: string | null
    failureStreak: number
    neverRun: boolean
    overdue: boolean
}

type Backup = {
    reachable: boolean
    error: string | null
    newestAt: string | null
    newestName: string | null
    ageHours: number | null
    stale: boolean
}

type Health = { jobs: Job[]; backup: Backup; staleAfterHours: number }

type Tone = 'ok' | 'warn' | 'bad'

const TONE: Record<Tone, { fg: string; bg: string }> = {
    ok: { fg: 'var(--ok-fg)', bg: 'var(--ok-bg)' },
    warn: { fg: 'var(--warn-fg)', bg: 'var(--warn-bg)' },
    bad: { fg: 'var(--danger-fg)', bg: 'var(--danger-bg)' },
}

function Pill({ tone, children }: { tone: Tone; children: React.ReactNode }) {
    return (
        <span style={{
            background: TONE[tone].bg,
            color: TONE[tone].fg,
            fontSize: '0.7rem',
            fontWeight: 700,
            padding: '0.15rem 0.5rem',
            borderRadius: '999px',
            whiteSpace: 'nowrap',
        }}>
            {children}
        </span>
    )
}

/**
 * "When did this last work?" for every scheduled job, and for the backup.
 *
 * This card is the alert. P1 originally called for an email, until it turned
 * out GitHub already sends one every time the backup fails — and it had been
 * arriving daily, unread, for a week. That is a property of the channel, not
 * of anyone reading it: a message that says the same thing every morning stops
 * being a message. So the signal moved to where the work already happens.
 *
 * It shows silence as loudly as failure. A job that stops firing writes no
 * error and leaves no trace, which is why the register lives in code rather
 * than being derived from rows — a job with no row at all is the loudest thing
 * this can report, and a query over past runs could never have said it.
 */
export default function JobsCard() {
    const { t, locale } = useLanguage()
    // So "3 hours ago" becomes "4 hours ago" while the card is open,
    // rather than only when something else redraws it.
    const now = useNow()
    const [health, setHealth] = useState<Health | null>(null)
    const [failed, setFailed] = useState(false)

    useEffect(() => {
        let cancelled = false
        fetch('/api/admin/maintenance/jobs')
            .then(r => r.json())
            .then(body => {
                if (cancelled) return
                if (body?.data) setHealth(body.data)
                else setFailed(true)
            })
            .catch(() => { if (!cancelled) setFailed(true) })
        return () => { cancelled = true }
    }, [])

    const ago = (iso: string | null): string => {
        if (!iso) return '—'
        const hours = (now - new Date(iso).getTime()) / 36e5
        if (hours < 1) return t('jobs_just_now' as any)
        if (hours < 48) return `${Math.round(hours)}${t('jobs_hours_short' as any)}`
        return `${Math.round(hours / 24)}${t('jobs_days_short' as any)}`
    }

    const backupTone = (b: Backup): Tone => (!b.reachable || b.stale || b.error) ? 'bad' : 'ok'
    const backupLine = (b: Backup): string => {
        // Two reds with different sentences: for a week the true one was the
        // second, and "stale" alone would have understated it.
        if (!b.reachable) return t('jobs_backup_unreachable' as any)
        if (b.error === 'NO_BACKUPS') return t('jobs_no_backups' as any)
        if (b.stale) return t('jobs_backup_stale' as any)
        return t('jobs_backup_ok' as any)
    }

    const jobTone = (j: Job): Tone => {
        if (j.neverRun || j.overdue || j.failureStreak >= 3) return 'bad'
        if (j.failureStreak > 0) return 'warn'
        return 'ok'
    }
    const jobStatus = (j: Job): string => {
        if (j.neverRun) return t('jobs_never_run' as any)
        if (j.overdue) return t('jobs_overdue' as any)
        if (j.failureStreak > 0) return t('jobs_failing' as any)
        return ago(j.lastSuccessAt)
    }

    const row = {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '0.75rem',
        padding: '0.45rem 0',
        borderTop: '1px solid var(--border)',
        fontSize: '0.85rem',
    } as const

    return (
        <div className="glass-card" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                <span style={{ fontSize: '2rem' }}>🩺</span>
                <div>
                    <h3 style={{ margin: 0, fontSize: '1.1rem', color: 'var(--text-main)' }}>{t('jobs_header' as any)}</h3>
                    <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--text-muted)' }}>{t('jobs_subtitle' as any)}</p>
                </div>
            </div>

            {failed && (
                <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--danger-fg)' }}>
                    {t('jobs_check_failed' as any)}
                </p>
            )}

            {!health && !failed && (
                <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                    {t('jobs_loading' as any)}
                </p>
            )}

            {health && (
                <>
                    {/* The backup first and on its own: it is the reason this
                        card exists, and it is the only row whose failure means
                        the data is not safe rather than a feature being late. */}
                    <div style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: '0.75rem',
                        background: TONE[backupTone(health.backup)].bg,
                        color: TONE[backupTone(health.backup)].fg,
                        borderRadius: '0.65rem',
                        padding: '0.6rem 0.8rem',
                        fontSize: '0.85rem',
                        fontWeight: 600,
                    }}>
                        <span>💾 {backupLine(health.backup)}</span>
                        <span style={{ fontVariantNumeric: 'tabular-nums' }}>
                            {health.backup.newestAt ? ago(health.backup.newestAt) : '—'}
                        </span>
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column' }}>
                        {health.jobs.map(j => (
                            <div key={j.job} style={row} title={j.lastError ?? undefined}>
                                <span style={{ color: 'var(--text-main)' }}>{j.label}</span>
                                <span style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                    {j.lastError && (
                                        <span style={{ color: 'var(--text-faint)', fontSize: '0.75rem' }} aria-hidden>⚠</span>
                                    )}
                                    <Pill tone={jobTone(j)}>{jobStatus(j)}</Pill>
                                </span>
                            </div>
                        ))}
                    </div>

                    <p style={{
                        margin: 0,
                        fontSize: '0.75rem',
                        color: 'var(--text-faint)',
                        textAlign: locale === 'ar' ? 'right' : 'left',
                    }}>
                        {t('jobs_footnote' as any)}
                    </p>
                </>
            )}
        </div>
    )
}

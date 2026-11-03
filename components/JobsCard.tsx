'use client'

import { Fragment, type ReactNode } from 'react'
import useSWR from 'swr'
import { WarningCircleIcon } from '@phosphor-icons/react/ssr'
import { Button, Card, EmptyState, Row, StatusBadge, type StatusTone } from '@/components/ui'
import { useLanguage } from '@/context/LanguageContext'
import { fetcher, type SWRError } from '@/lib/swr-fetcher'
import type { TranslationKey } from '@/lib/translations'
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
 *
 * On the building blocks (UI_PLAN.md §5 step 5, Operations part 3b): a card
 * with the backup and then each job as a row, its state as a badge in its
 * meaning's colour, a row that isn't fine marked, and a job's last error in
 * words, where it was a tooltip.
 */
export default function JobsCard() {
    const { t, locale } = useLanguage()
    // So "3 hours ago" becomes "4 hours ago" while the card is open,
    // rather than only when something else redraws it.
    const now = useNow()
    // Asked again while it's open, so a job that ran since doesn't still read
    // late; every five minutes, as each ask lists the backups on Google Drive.
    const { data, error, isValidating, mutate } = useSWR('/api/admin/maintenance/jobs', fetcher, { refreshInterval: 5 * 60_000 })
    const health: Health | undefined = data?.data

    const intl = locale === 'ar' ? 'ar-EG' : 'en-GB'
    // "2 hours ago", قبل ساعتين: the language's own words for it, where a
    // count and "ago" put together read wrongly in Arabic.
    const ago = (iso: string): string => {
        const hours = (now - Date.parse(iso)) / 36e5
        if (hours < 1) return t('jobs_just_now')
        const relative = new Intl.RelativeTimeFormat(intl, { numeric: 'auto' })
        return hours < 48 ? relative.format(-Math.round(hours), 'hour') : relative.format(-Math.round(hours / 24), 'day')
    }
    // Each fact kept apart from the next, so a name can't swap places with
    // the words beside it in Arabic.
    const facts = (items: (ReactNode | null | false)[]): ReactNode => (
        <span>{items.filter(Boolean).map((x, i) => <Fragment key={i}>{i > 0 && t('list_separator')}<bdi>{x}</bdi></Fragment>)}</span>
    )

    const backupBad = (b: Backup) => !b.reachable || b.stale || !!b.error
    // Two reds with different words: for a week the true one was the second,
    // and "stale" alone would have understated it.
    const backupState = (b: Backup): TranslationKey =>
        !b.reachable ? 'jobs_backup_unreachable' : b.error === 'NO_BACKUPS' ? 'jobs_no_backups' : b.stale ? 'jobs_backup_stale' : 'jobs_backup_ok'

    const jobTone = (j: Job): StatusTone => j.neverRun || j.overdue || j.failureStreak >= 3 ? 'problem' : j.failureStreak > 0 ? 'waiting' : 'good'
    const jobState = (j: Job): TranslationKey => j.neverRun ? 'jobs_never_run' : j.overdue ? 'jobs_overdue' : j.failureStreak > 0 ? 'jobs_failing' : 'jobs_working'
    const every = (hours: number): TranslationKey => hours <= 1 ? 'jobs_every_hour' : hours <= 24 ? 'jobs_every_day' : hours <= 24 * 31 ? 'jobs_every_month' : 'jobs_every_year'
    // Its name in the reader's language; the server's own name if it's one this doesn't know yet.
    const name = (j: Job) => {
        const key = `jobs_name_${j.job.replace(/-/g, '_')}` as TranslationKey
        const named = t(key)
        return named && named !== key ? named : j.label
    }

    if (!health) {
        return (
            <Card title={t('jobs_header')}>
                <p className="ui-card-note">{t('jobs_subtitle')}</p>
                {error
                    ? <EmptyState icon={WarningCircleIcon} title={t('jobs_check_failed')} detail={(error as SWRError).info?.error}
                        action={<Button busy={isValidating} onClick={() => { void mutate() }}>{t('try_again')}</Button>} />
                    : <p className="ui-card-note" role="status">{t('jobs_loading')}</p>}
            </Card>
        )
    }

    const { backup } = health
    return (
        <Card title={t('jobs_header')}>
            <p className="ui-card-note">{t('jobs_subtitle')}</p>
            <p className="ui-card-note">{t('jobs_footnote')}</p>
            <ul className="ui-rows ui-rows-flush" aria-label={t('jobs_header')}>
                {/* The backup first: it's the reason this card exists, and the
                    one row whose failure means the data isn't safe rather than
                    a feature being late. */}
                <Row
                    tone={backupBad(backup) ? 'overdue' : undefined}
                    title={t('jobs_backup')}
                    detail={backup.newestAt && facts([
                        t('jobs_backup_newest').replace('{when}', ago(backup.newestAt)),
                        backup.newestName && <bdi dir="ltr" translate="no">{backup.newestName}</bdi>,
                    ])}
                    end={<StatusBadge tone={backupBad(backup) ? 'problem' : 'good'}>{t(backupState(backup))}</StatusBadge>}
                />
                {health.jobs.map(j => (
                    <Row
                        key={j.job}
                        tone={jobTone(j) === 'problem' ? 'overdue' : undefined}
                        title={name(j)}
                        detail={facts([
                            t(every(j.everyHours)),
                            j.neverRun ? t('jobs_no_run') : j.lastSuccessAt ? t('jobs_last_worked').replace('{when}', ago(j.lastSuccessAt)) : t('jobs_never_worked'),
                        ])}
                        note={j.lastError && <bdi>{j.lastError}</bdi>}
                        end={<StatusBadge tone={jobTone(j)}>{t(jobState(j))}</StatusBadge>}
                    />
                ))}
            </ul>
        </Card>
    )
}

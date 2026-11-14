'use client'

import { useId } from 'react'
import Link from 'next/link'
import { Row, StatusBadge } from '@/components/ui'
import { useLanguage } from '@/context/LanguageContext'
import type { TranslationKey } from '@/lib/translations'

/**
 * What Payroll's Approve shows while days of the month wait to be settled
 * (ATTENDANCE_PLAN.md §6.9, §12.1, round 10, decisions 14 and 24, PR 276;
 * DESIGN.md §5.5, Dialog): each day waiting, opening the Exceptions screen
 * on its day and kind; and the month's requests not yet decided, as a
 * warning, each kind opening the Requests page on it.
 */

export type DayToSettle = {
    userId: string; name: string; date: string; status: 'INCOMPLETE' | 'TO_CONFIRM'
    /** The scans, as the day's wall time written as UTC, as attendance keeps them. */
    firstIn: string | null; lastOut: string | null
}
export type ToSettle = {
    /** How many wait in all; `days` lists the first of them. */
    count: number
    days: DayToSettle[]
    requests: { permissions: number; missing: number; overtime: number }
}

const exceptions = (year: number, month: number, kind: string, day?: number) =>
    `/dashboard/attendance?tab=exceptions&year=${year}&month=${month}${day ? `&day=${day}` : ''}&kind=${kind}`
const kindOf = (d: DayToSettle) => (d.status === 'TO_CONFIRM' ? 'departure' : 'incomplete')
const WAITS_ON: Record<DayToSettle['status'], TranslationKey> = { INCOMPLETE: 'exc_tab_incomplete', TO_CONFIRM: 'exc_tab_departure' }

function useWords() {
    const { t, locale } = useLanguage()
    const digits = locale === 'ar' ? 'ar-EG' : 'en-GB'
    const num = (n: number) => n.toLocaleString(digits)
    return {
        t, num,
        date: (date: string) => new Date(`${date}T00:00:00Z`).toLocaleDateString(digits, { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }),
        clock: (at: string) => at.slice(11, 16).replace(/\d/g, c => num(Number(c))),
    }
}

export function DaysToSettle({ settle, year, month }: { settle: ToSettle; year: number; month: number }) {
    const { t, num, date, clock } = useWords()
    const more = settle.count - settle.days.length
    const scans = (d: DayToSettle) => [d.firstIn, d.lastOut].filter((at): at is string => !!at).map(clock).join('–')
    return (
        <>
            <p>{t('payroll_settle_msg')}</p>
            <ul className="ui-rows" aria-label={t('payroll_settle_title')}>
                {settle.days.map(d => (
                    <Row key={`${d.userId}:${d.date}`} href={exceptions(year, month, kindOf(d), Number(d.date.slice(8, 10)))}
                        title={d.name} detail={date(d.date)}
                        note={scans(d) ? <>{t('exc_punched')}: <bdi>{scans(d)}</bdi></> : null}
                        end={<StatusBadge tone="waiting">{t(WAITS_ON[d.status])}</StatusBadge>} />
                ))}
            </ul>
            {more > 0 && (
                <p><Link className="ui-item-link" href={exceptions(year, month, 'incomplete')} prefetch={false}>{t('payroll_settle_more').replace('{n}', num(more))}</Link></p>
            )}
        </>
    )
}

const REQUESTS: { key: keyof ToSettle['requests']; label: TranslationKey; kind: string }[] = [
    { key: 'permissions', label: 'payroll_undecided_permissions', kind: 'permission' },
    { key: 'missing', label: 'payroll_undecided_missing', kind: 'missingPunch' },
    { key: 'overtime', label: 'payroll_undecided_overtime', kind: 'overtime' },
]

export function UndecidedRequests({ requests }: { requests: ToSettle['requests'] }) {
    const { t, num } = useWords()
    const id = useId()
    const rows = REQUESTS.filter(r => requests[r.key] > 0)
    if (rows.length === 0) return null
    return (
        <section aria-labelledby={id}>
            <h3 id={id} className="ui-subsection-title">{t('payroll_undecided_title')}</h3>
            <p>{t('payroll_undecided_msg')}</p>
            <ul className="ui-rows" aria-labelledby={id}>
                {rows.map(r => (
                    <Row key={r.key} href={`/dashboard/requests?tab=review&kind=${r.kind}&show=waiting`}
                        title={t(r.label)} end={<span className="ui-num">{num(requests[r.key])}</span>} />
                ))}
            </ul>
        </section>
    )
}

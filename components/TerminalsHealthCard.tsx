'use client'

import { Fragment, type ReactNode } from 'react'
import useSWR from 'swr'
import { WarningCircleIcon } from '@phosphor-icons/react/ssr'
import { Button, Card, EmptyState, Row, StatusBadge, type StatusTone } from '@/components/ui'
import { useLanguage } from '@/context/LanguageContext'
import { countOf } from '@/lib/plural'
import { fetcher, type SWRError } from '@/lib/swr-fetcher'
import type { TranslationKey } from '@/lib/translations'

/**
 * Every company's attendance agents and terminals (ATTENDANCE_PLAN.md
 * §13.2), worst first: an agent silent during working hours, a terminal its
 * agent cannot reach, then a terminal nearly full or with its clock off.
 * The same health the company sees on its own Attendance tab.
 *
 * On the building blocks (UI_PLAN.md §5 step 5, Operations part 3b): a card
 * with each company as a row, its state as a badge in its meaning's colour
 * and what's wrong fact by fact, in the language's digits.
 */

type Company = {
    companyId: string; name: string; working: boolean; tone: 'ok' | 'warn' | 'bad'
    agents: { id: string; name: string; health: 'OK' | 'SILENT' | 'QUIET' | 'WAITING' | 'REVOKED'; queueDepth: number | null }[]
    terminals: { total: number; ok: number; unreachable: number; silent: number; memoryFull: number; clockOff: number }
}

const TONE: Record<Company['tone'], StatusTone> = { ok: 'good', warn: 'waiting', bad: 'problem' }
const STATE: Record<Company['tone'], TranslationKey> = { ok: 'att_term_health_ok_pill', warn: 'att_term_health_warn_pill', bad: 'att_term_health_bad_pill' }

export default function TerminalsHealthCard() {
    const { t, locale } = useLanguage()
    const { data, error, isValidating, mutate } = useSWR('/api/admin/terminals', fetcher, { refreshInterval: 60_000 })
    const rows: Company[] | undefined = data?.data?.companies
    // While it loads, and if it didn't, the card keeps its place: rendering
    // nothing and then the card moved every card after it into a new spot
    // on the health page (Lighthouse: a layout shift of 0.26), and an error
    // took the card away without a word.
    if (!rows) {
        return (
            <Card title={t('att_term_health_title')}>
                {error
                    ? <EmptyState icon={WarningCircleIcon} title={t('error_generic')} detail={(error as SWRError).info?.error}
                        action={<Button busy={isValidating} onClick={() => { void mutate() }}>{t('try_again')}</Button>} />
                    : <p className="ui-card-note" role="status">{t('loading')}</p>}
            </Card>
        )
    }

    const num = (n: number) => n.toLocaleString(locale === 'ar' ? 'ar-EG' : 'en-GB')
    const bad = rows.filter(r => r.tone === 'bad').length
    // Each fact kept apart from the next, so an agent's name can't swap
    // places with the words beside it in Arabic.
    const facts = (items: (string | false)[]): ReactNode => (
        <span>{items.filter(Boolean).map((x, i) => <Fragment key={i}>{i > 0 && t('list_separator')}<bdi>{x}</bdi></Fragment>)}</span>
    )

    return (
        <Card title={t('att_term_health_title')}>
            <p className="ui-card-note">
                {rows.length === 0 ? t('att_term_health_none') : bad ? t('att_term_health_bad').replace('{count}', countOf(t, locale, bad, 'companies')) : t('att_term_health_ok')}
            </p>
            {rows.length > 0 && (
                <ul className="ui-rows ui-rows-flush" aria-label={t('att_term_health_title')}>
                    {rows.map(r => (
                        <Row
                            key={r.companyId}
                            tone={r.tone === 'bad' ? 'overdue' : undefined}
                            title={<bdi>{r.name}</bdi>}
                            detail={facts([
                                ...r.agents.map(a => `${a.name}: ${t(`att_term_agent_${a.health}`)}`),
                                t('att_term_health_terminals').replace('{ok}', num(r.terminals.ok)).replace('{total}', num(r.terminals.total)),
                                r.terminals.unreachable > 0 && t('att_term_health_unreachable').replace('{n}', num(r.terminals.unreachable)),
                                r.terminals.memoryFull > 0 && t('att_term_health_memory').replace('{n}', num(r.terminals.memoryFull)),
                                r.terminals.clockOff > 0 && t('att_term_health_clock').replace('{n}', num(r.terminals.clockOff)),
                            ])}
                            end={<StatusBadge tone={TONE[r.tone]}>{t(STATE[r.tone])}</StatusBadge>}
                        />
                    ))}
                </ul>
            )}
        </Card>
    )
}

'use client'

import useSWR from 'swr'
import { fetcher } from '@/lib/swr-fetcher'
import { useLanguage } from '@/context/LanguageContext'

/**
 * Every company's attendance agents and terminals (ATTENDANCE_PLAN.md
 * §13.2), worst first: an agent silent during working hours, a terminal its
 * agent cannot reach, then a terminal nearly full or with its clock off.
 * The same health the company sees on its own Attendance tab.
 */

type Row = {
    companyId: string; name: string; working: boolean; tone: 'ok' | 'warn' | 'bad'
    agents: { id: string; name: string; health: string; queueDepth: number | null }[]
    terminals: { total: number; ok: number; unreachable: number; silent: number; memoryFull: number; clockOff: number }
}

const TONE = {
    ok: { fg: 'var(--ok-fg)', bg: 'var(--ok-bg)' },
    warn: { fg: 'var(--warn-fg)', bg: 'var(--warn-bg)' },
    bad: { fg: 'var(--danger-fg)', bg: 'var(--danger-bg)' },
}

export default function TerminalsHealthCard() {
    const { t } = useLanguage()
    const { data } = useSWR('/api/admin/terminals', fetcher, { refreshInterval: 60_000 })
    const rows: Row[] | undefined = data?.data?.companies
    if (!rows) return null
    const bad = rows.filter(r => r.tone === 'bad').length

    return (
        <div className="glass-card" style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                <span style={{ fontSize: '2rem' }} aria-hidden>🖐️</span>
                <div>
                    <h3 style={{ margin: 0 }}>{t('att_term_health_title')}</h3>
                    <p style={{ margin: 0, fontSize: '0.85rem', color: bad ? 'var(--danger-fg)' : 'var(--text-soft)' }}>
                        {rows.length === 0 ? t('att_term_health_none') : bad ? t('att_term_health_bad').replace('{n}', String(bad)) : t('att_term_health_ok')}
                    </p>
                </div>
            </div>
            {rows.map(r => (
                <div key={r.companyId} style={{ borderTop: '1px solid var(--border)', paddingTop: '0.5rem', display: 'grid', gap: '0.2rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.5rem', alignItems: 'center' }}>
                        <strong style={{ fontSize: '0.9rem' }}>{r.name}</strong>
                        <span style={{ background: TONE[r.tone].bg, color: TONE[r.tone].fg, fontSize: '0.7rem', fontWeight: 700, padding: '0.15rem 0.5rem', borderRadius: '999px' }}>
                            {t(`att_term_health_${r.tone}_pill` as any)}
                        </span>
                    </div>
                    <span style={{ fontSize: '0.78rem', color: 'var(--text-soft)' }}>
                        {[
                            r.agents.map(a => `${a.name}: ${t(`att_term_agent_${a.health}` as any)}`).join(', '),
                            t('att_term_health_terminals').replace('{ok}', String(r.terminals.ok)).replace('{total}', String(r.terminals.total)),
                            r.terminals.unreachable > 0 && t('att_term_health_unreachable').replace('{n}', String(r.terminals.unreachable)),
                            r.terminals.memoryFull > 0 && t('att_term_health_memory').replace('{n}', String(r.terminals.memoryFull)),
                            r.terminals.clockOff > 0 && t('att_term_health_clock').replace('{n}', String(r.terminals.clockOff)),
                        ].filter(Boolean).join(' · ')}
                    </span>
                </div>
            ))}
        </div>
    )
}

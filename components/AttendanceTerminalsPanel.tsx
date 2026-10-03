'use client'

import { useState } from 'react'
import useSWR from 'swr'
import { fetcher } from '@/lib/swr-fetcher'
import { useLanguage } from '@/context/LanguageContext'
import { useToast } from '@/context/ToastContext'
import Modal from '@/components/Modal'
import ConfirmModal from '@/components/ConfirmModal'
import { apiErrorText } from '@/lib/api-error-text'
import { useNow } from '@/lib/useNow'

/**
 * Fingerprint terminals and the Local Sync Agent (ATTENDANCE_PLAN.md §17,
 * §13.2), on the Attendance tab of a company holding the Terminals add-on.
 *
 * The agent is a program on a PC in the office that reads the terminals on
 * its network and sends their punches. It is added here, and connected by
 * typing the one-time code shown here into it. Terminals appear by
 * themselves once an agent reports them; here they are named, marked
 * entrance-only or exit-only, and retired.
 */

type Agent = {
    id: string; name: string; status: 'PENDING' | 'ACTIVE' | 'REVOKED'; codeExpiresAt: string | null
    hostname: string | null; agentVersion: string | null; lastSeenAt: string | null; lastSyncAt: string | null
    queueDepth: number | null; clockDriftSeconds: number | null
    health: 'WAITING' | 'REVOKED' | 'OK' | 'SILENT' | 'QUIET'
}
type Device = {
    id: string; serialNumber: string; name: string; model: string | null; mode: 'ANY' | 'ENTRANCE' | 'EXIT'
    lastSeenAt: string | null; lastPunchAt: string | null; reachable: boolean; lastError: string | null
    clockDriftSeconds: number | null; recordCount: number | null; recordCapacity: number | null; retiredAt: string | null
    health: { state: 'RETIRED' | 'OK' | 'UNREACHABLE' | 'SILENT' | 'QUIET'; memoryFull: boolean; clockOff: boolean }
}

type Tone = 'ok' | 'warn' | 'bad' | 'muted'
const TONES: Record<Tone, { fg: string; bg: string }> = {
    ok: { fg: 'var(--ok-fg)', bg: 'var(--ok-bg)' },
    warn: { fg: 'var(--warn-fg)', bg: 'var(--warn-bg)' },
    bad: { fg: 'var(--danger-fg)', bg: 'var(--danger-bg)' },
    muted: { fg: 'var(--text-soft)', bg: 'var(--surface-sunk)' },
}
const Pill = ({ tone, children }: { tone: Tone; children: React.ReactNode }) => (
    <span style={{ background: TONES[tone].bg, color: TONES[tone].fg, fontSize: '0.72rem', fontWeight: 700, padding: '0.15rem 0.55rem', borderRadius: '999px', whiteSpace: 'nowrap' }}>{children}</span>
)
const AGENT_TONE: Record<Agent['health'], Tone> = { OK: 'ok', SILENT: 'bad', QUIET: 'muted', WAITING: 'warn', REVOKED: 'muted' }
const DEVICE_TONE: Record<Device['health']['state'], Tone> = { OK: 'ok', UNREACHABLE: 'bad', SILENT: 'bad', QUIET: 'muted', RETIRED: 'muted' }

export default function AttendanceTerminalsPanel({ companyId, readOnly }: { companyId: string; readOnly: boolean }) {
    const { t, locale } = useLanguage()
    const { showToast } = useToast()
    const now = useNow(30_000)
    const q = `?companyId=${encodeURIComponent(companyId)}`
    // Refreshed as heartbeats come in: health is the point of the panel.
    const { data: agentsBody, error: agentsError, mutate: reloadAgents } = useSWR(`/api/attendance/agents${q}`, fetcher, { refreshInterval: 60_000 })
    const { data: devicesBody, mutate: reloadDevices } = useSWR(agentsBody ? `/api/attendance/devices${q}` : null, fetcher, { refreshInterval: 60_000 })
    const [adding, setAdding] = useState<string | null>(null)
    const [shownCode, setShownCode] = useState<{ name: string; code: string; expiresAt: string | null } | null>(null)
    const [revoking, setRevoking] = useState<Agent | null>(null)
    const [renaming, setRenaming] = useState<{ device: Device; name: string } | null>(null)
    const [retiring, setRetiring] = useState<Device | null>(null)
    const [busy, setBusy] = useState(false)

    // Not sold to this company, or not this person's to see: nothing here.
    if (agentsError || !agentsBody?.data) return null
    const agents: Agent[] = agentsBody.data.agents
    const devices: Device[] = devicesBody?.data?.devices ?? []
    const intl = locale === 'ar' ? 'ar-EG' : 'en-GB'

    const ago = (iso: string | null) => {
        if (!iso) return t('att_term_never')
        const minutes = Math.max(0, Math.round((now - Date.parse(iso)) / 60_000))
        if (minutes < 1) return t('att_term_just_now')
        if (minutes < 60) return t('att_term_minutes_ago').replace('{n}', String(minutes))
        return new Date(iso).toLocaleString(intl, { dateStyle: 'medium', timeStyle: 'short' })
    }
    const drift = (s: number | null) => s === null ? null : Math.abs(s) < 60 ? t('att_term_drift_s').replace('{n}', String(Math.abs(s))) : t('att_term_drift_m').replace('{n}', String(Math.round(Math.abs(s) / 60)))

    const send = async (url: string, init: RequestInit, done: string, then?: (body: any) => void) => {
        setBusy(true)
        try {
            const res = await fetch(url, { headers: { 'Content-Type': 'application/json' }, ...init })
            const text = await res.text()
            if (!res.ok) return showToast(apiErrorText(text, t('error_generic')), 'error')
            showToast(t(done as any), 'success')
            then?.(JSON.parse(text).data)
            reloadAgents()
            reloadDevices()
        } finally { setBusy(false) }
    }

    const addAgent = () => adding !== null && send('/api/attendance/agents', { method: 'POST', body: JSON.stringify({ companyId, name: adding }) }, 'att_term_agent_added', d => {
        setShownCode({ name: d.agent.name, code: d.code, expiresAt: d.agent.codeExpiresAt })
        setAdding(null)
    })
    const newCode = (a: Agent) => send(`/api/attendance/agents/${a.id}/code`, { method: 'POST' }, 'att_term_code_issued', d => setShownCode({ name: a.name, code: d.code, expiresAt: d.agent.codeExpiresAt }))
    const setMode = (d: Device, mode: Device['mode']) => send(`/api/attendance/devices/${d.id}`, { method: 'PATCH', body: JSON.stringify({ mode }) }, 'att_term_saved')

    const live = agents.filter(a => a.status !== 'REVOKED')
    const revoked = agents.filter(a => a.status === 'REVOKED')

    return (
        <section className="glass" style={{ padding: '1.5rem', borderRadius: '1rem', display: 'grid', gap: '1rem' }} aria-labelledby="attendance-terminals">
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap', alignItems: 'flex-start' }}>
                <div style={{ minWidth: 0, flex: '1 1 18rem' }}>
                    <h3 id="attendance-terminals" style={{ margin: 0, fontSize: '1rem' }}>{t('att_term_title')}</h3>
                    <p style={{ margin: '0.3rem 0 0', fontSize: '0.84rem', color: 'var(--text-soft)' }}>{t('att_term_hint')}</p>
                </div>
                {!readOnly && <button className="btn btn-primary" disabled={busy} onClick={() => setAdding('')}>{t('att_term_add_agent')}</button>}
            </div>

            <div style={{ display: 'grid', gap: '0.5rem' }}>
                <h4 style={{ margin: 0, fontSize: '0.9rem' }}>{t('att_term_agents')}</h4>
                {live.length === 0 && <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--text-soft)' }}>{t('att_term_no_agents')}</p>}
                {live.map(a => (
                    <div key={a.id} style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center', borderTop: '1px solid var(--border)', paddingTop: '0.5rem' }}>
                        <div style={{ minWidth: 0, display: 'grid', gap: '0.2rem' }}>
                            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
                                <strong>{a.name}</strong>
                                <Pill tone={AGENT_TONE[a.health]}>{t(`att_term_agent_${a.health}` as any)}</Pill>
                                {(a.queueDepth ?? 0) > 0 && <Pill tone="warn">{t('att_term_queue').replace('{n}', String(a.queueDepth))}</Pill>}
                            </div>
                            <span style={{ fontSize: '0.78rem', color: 'var(--text-soft)' }}>
                                {a.status === 'PENDING'
                                    ? t('att_term_waiting_hint')
                                    : [a.hostname, a.agentVersion && `v${a.agentVersion}`, t('att_term_last_seen').replace('{when}', ago(a.lastSeenAt)), a.lastSyncAt && t('att_term_last_sync').replace('{when}', ago(a.lastSyncAt)), a.clockDriftSeconds !== null && Math.abs(a.clockDriftSeconds) > 120 && t('att_term_clock_off').replace('{d}', drift(a.clockDriftSeconds)!)].filter(Boolean).join(' · ')}
                            </span>
                        </div>
                        {!readOnly && (
                            <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
                                <button className="btn btn-secondary" style={{ fontSize: '0.8rem' }} disabled={busy} onClick={() => newCode(a)}>{t(a.status === 'PENDING' ? 'att_term_new_code' : 'att_term_move_pc')}</button>
                                <button className="btn btn-secondary" style={{ fontSize: '0.8rem', color: 'var(--danger-fg)' }} disabled={busy} onClick={() => setRevoking(a)}>{t('att_term_revoke')}</button>
                            </div>
                        )}
                    </div>
                ))}
                {revoked.length > 0 && <p style={{ margin: 0, fontSize: '0.78rem', color: 'var(--text-soft)' }}>{t('att_term_revoked_n').replace('{n}', String(revoked.length))}</p>}
            </div>

            <div style={{ display: 'grid', gap: '0.5rem' }}>
                <h4 style={{ margin: 0, fontSize: '0.9rem' }}>{t('att_term_devices')}</h4>
                {devices.length === 0 && <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--text-soft)' }}>{t('att_term_no_devices')}</p>}
                {devices.map(d => (
                    <div key={d.id} style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center', borderTop: '1px solid var(--border)', paddingTop: '0.5rem', opacity: d.retiredAt ? 0.65 : 1 }}>
                        <div style={{ minWidth: 0, display: 'grid', gap: '0.2rem' }}>
                            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
                                <strong>{d.name}</strong>
                                <Pill tone={DEVICE_TONE[d.health.state]}>{t(`att_term_device_${d.health.state}` as any)}</Pill>
                                {d.health.memoryFull && <Pill tone="warn">{t('att_term_memory_full').replace('{p}', String(Math.round(100 * (d.recordCount ?? 0) / (d.recordCapacity || 1))))}</Pill>}
                                {d.health.clockOff && <Pill tone="warn">{t('att_term_clock_off').replace('{d}', drift(d.clockDriftSeconds)!)}</Pill>}
                            </div>
                            <span style={{ fontSize: '0.78rem', color: 'var(--text-soft)' }}>
                                {[`${t('att_term_serial')} ${d.serialNumber}`, d.model, t('att_term_last_seen').replace('{when}', ago(d.lastSeenAt)), d.lastPunchAt && t('att_term_last_punch').replace('{when}', ago(d.lastPunchAt)), !d.reachable && d.lastError].filter(Boolean).join(' · ')}
                            </span>
                        </div>
                        <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', alignItems: 'center' }}>
                            {readOnly || d.retiredAt ? (
                                <span style={{ fontSize: '0.8rem' }}>{t(`audit_value_${d.mode}` as any)}</span>
                            ) : (
                                <select className="input" aria-label={t('att_term_mode')} value={d.mode} disabled={busy} onChange={e => setMode(d, e.target.value as Device['mode'])} style={{ width: 'auto', fontSize: '0.8rem' }}>
                                    <option value="ANY">{t('audit_value_ANY')}</option>
                                    <option value="ENTRANCE">{t('audit_value_ENTRANCE')}</option>
                                    <option value="EXIT">{t('audit_value_EXIT')}</option>
                                </select>
                            )}
                            {!readOnly && !d.retiredAt && <button className="btn btn-secondary" style={{ fontSize: '0.8rem' }} disabled={busy} onClick={() => setRenaming({ device: d, name: d.name })}>{t('att_term_rename')}</button>}
                            {!readOnly && !d.retiredAt && <button className="btn btn-secondary" style={{ fontSize: '0.8rem', color: 'var(--danger-fg)' }} disabled={busy} onClick={() => setRetiring(d)}>{t('att_term_retire')}</button>}
                            {!readOnly && d.retiredAt && <button className="btn btn-secondary" style={{ fontSize: '0.8rem' }} disabled={busy} onClick={() => send(`/api/attendance/devices/${d.id}/restore`, { method: 'POST' }, 'att_term_restored')}>{t('att_term_restore')}</button>}
                        </div>
                    </div>
                ))}
                <p style={{ margin: 0, fontSize: '0.78rem', color: 'var(--text-soft)' }}>{t('att_term_mode_hint')}</p>
            </div>

            <Modal isOpen={adding !== null} onClose={() => setAdding(null)} title={t('att_term_add_agent')}>
                <div style={{ display: 'grid', gap: '0.75rem' }}>
                    <label style={{ display: 'grid', gap: '0.25rem' }}>
                        <span className="label">{t('att_term_agent_name')}</span>
                        <input className="input" autoFocus maxLength={80} value={adding ?? ''} placeholder={t('att_term_agent_name_placeholder')} onChange={e => setAdding(e.target.value)} />
                    </label>
                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
                        <button className="btn btn-secondary" onClick={() => setAdding(null)}>{t('cancel')}</button>
                        <button className="btn btn-primary" disabled={busy || !adding?.trim()} onClick={addAgent}>{t('att_term_add_agent')}</button>
                    </div>
                </div>
            </Modal>

            <Modal isOpen={!!shownCode} onClose={() => setShownCode(null)} title={t('att_term_code_title').replace('{name}', shownCode?.name ?? '')}>
                {shownCode && (
                    <div style={{ display: 'grid', gap: '0.75rem' }}>
                        <p style={{ margin: 0, fontSize: '0.88rem' }}>{t('att_term_code_hint')}</p>
                        <div dir="ltr" style={{ fontFamily: 'ui-monospace, monospace', fontSize: '2rem', fontWeight: 700, letterSpacing: '0.15em', textAlign: 'center', padding: '0.75rem', border: '1px dashed var(--border)', borderRadius: '0.75rem', userSelect: 'all' }}>{shownCode.code}</div>
                        {shownCode.expiresAt && <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--text-soft)' }}>{t('att_term_code_expires').replace('{time}', new Date(shownCode.expiresAt).toLocaleTimeString(intl, { timeStyle: 'short' }))}</p>}
                        <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--text-soft)' }}>{t('att_term_code_once')}</p>
                        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                            <button className="btn btn-primary" onClick={() => setShownCode(null)}>{t('att_term_done')}</button>
                        </div>
                    </div>
                )}
            </Modal>

            <Modal isOpen={!!renaming} onClose={() => setRenaming(null)} title={t('att_term_rename')}>
                {renaming && (
                    <div style={{ display: 'grid', gap: '0.75rem' }}>
                        <label style={{ display: 'grid', gap: '0.25rem' }}>
                            <span className="label">{t('att_term_device_name')}</span>
                            <input className="input" autoFocus maxLength={80} value={renaming.name} onChange={e => setRenaming({ ...renaming, name: e.target.value })} />
                        </label>
                        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
                            <button className="btn btn-secondary" onClick={() => setRenaming(null)}>{t('cancel')}</button>
                            <button className="btn btn-primary" disabled={busy || !renaming.name.trim()} onClick={() => send(`/api/attendance/devices/${renaming.device.id}`, { method: 'PATCH', body: JSON.stringify({ name: renaming.name }) }, 'att_term_saved', () => setRenaming(null))}>{t('save')}</button>
                        </div>
                    </div>
                )}
            </Modal>

            <ConfirmModal
                isOpen={!!revoking}
                title={t('att_term_revoke')}
                message={t('att_term_revoke_confirm').replace('{name}', revoking?.name ?? '')}
                confirmText={t('att_term_revoke')}
                onConfirm={() => { const a = revoking; setRevoking(null); if (a) send(`/api/attendance/agents/${a.id}`, { method: 'DELETE' }, 'att_term_revoked') }}
                onCancel={() => setRevoking(null)}
            />
            <ConfirmModal
                isOpen={!!retiring}
                title={t('att_term_retire')}
                message={t('att_term_retire_confirm').replace('{name}', retiring?.name ?? '')}
                confirmText={t('att_term_retire')}
                onConfirm={() => { const d = retiring; setRetiring(null); if (d) send(`/api/attendance/devices/${d.id}`, { method: 'DELETE' }, 'att_term_retired') }}
                onCancel={() => setRetiring(null)}
            />
        </section>
    )
}

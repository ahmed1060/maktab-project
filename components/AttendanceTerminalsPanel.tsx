'use client'

import { Fragment, useRef, useState, type FormEvent, type ReactNode } from 'react'
import useSWR from 'swr'
import { ArrowsClockwiseIcon, PencilSimpleIcon, PlusIcon, ProhibitIcon, ArrowCounterClockwiseIcon, WarningCircleIcon } from '@phosphor-icons/react/ssr'
import { fetcher, type SWRError } from '@/lib/swr-fetcher'
import { useLanguage } from '@/context/LanguageContext'
import { useToast } from '@/context/ToastContext'
import { apiErrorText } from '@/lib/api-error-text'
import { useNow } from '@/lib/useNow'
import type { TranslationKey } from '@/lib/translations'
import { Button, Card, Dialog, DialogActions, EmptyState, Field, Row, RowMenu, Select, StatusBadge, TextInput, type MenuItem, type StatusTone } from '@/components/ui'
import { focusFirstWrong } from '@/components/attendance-calendar/focus'

/**
 * Fingerprint terminals and the Local Sync Agent (ATTENDANCE_PLAN.md §17,
 * §13.2), on the Attendance tab of a company holding the Terminals add-on.
 *
 * The agent is a program on a PC in the office that reads the terminals on
 * its network and sends their punches. It is added here, and connected by
 * typing the one-time code shown here into it. Terminals appear by
 * themselves once an agent reports them; here they are named, marked
 * entrance-only or exit-only, and retired.
 *
 * On the building blocks (UI_PLAN.md §5 step 5, company settings part 3c): a
 * card listing the agents and the terminals as rows, each with its state as a
 * badge and what can be done to it in a menu named for it.
 *
 * Shown only to whoever may set the company's terminals up, who may change
 * everything in it (§17.10, PR 277): the server answers 404 to anyone else.
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
type Shown = { name: string; code: string; expiresAt: string | null }

const AGENT_TONE: Record<Agent['health'], StatusTone> = { OK: 'good', SILENT: 'problem', QUIET: 'neutral', WAITING: 'waiting', REVOKED: 'neutral' }
const DEVICE_TONE: Record<Device['health']['state'], StatusTone> = { OK: 'good', UNREACHABLE: 'problem', SILENT: 'problem', QUIET: 'neutral', RETIRED: 'neutral' }
const MODES: Device['mode'][] = ['ANY', 'ENTRANCE', 'EXIT']
const MODE_LABEL = { ANY: 'audit_value_ANY', ENTRANCE: 'audit_value_ENTRANCE', EXIT: 'audit_value_EXIT' } as const

export default function AttendanceTerminalsPanel({ companyId }: { companyId: string }) {
    const { t, locale } = useLanguage()
    const { showToast } = useToast()
    const now = useNow(30_000)
    const q = `?companyId=${encodeURIComponent(companyId)}`
    // Refreshed as heartbeats come in: health is the point of the panel.
    const { data: agentsBody, error: agentsError, isValidating, mutate: reloadAgents } = useSWR(`/api/attendance/agents${q}`, fetcher, { refreshInterval: 60_000 })
    const { data: devicesBody, mutate: reloadDevices } = useSWR(agentsBody ? `/api/attendance/devices${q}` : null, fetcher, { refreshInterval: 60_000 })
    const [adding, setAdding] = useState(false)
    const [shownCode, setShownCode] = useState<Shown | null>(null)
    const [revoking, setRevoking] = useState<Agent | null>(null)
    const [editing, setEditing] = useState<Device | null>(null)
    const [retiring, setRetiring] = useState<Device | null>(null)
    const [busy, setBusy] = useState(false)
    // One change at a time: each new code replaces the last, so two at once
    // could leave a code on screen that no longer works (Codex on PR 164).
    const inFlight = useRef(false)

    // Not sold to this company, or not this person's to see: nothing here.
    // Anything else is a failure to load, and says so rather than vanishing;
    // once loaded, a failed refresh keeps the panel (below).
    const status = (agentsError as SWRError | undefined)?.status
    if (agentsError && (status === 403 || status === 404)) return null
    if (agentsError && !agentsBody) return (
        <div className="ui-panel">
            <EmptyState icon={WarningCircleIcon} title={t('att_term_load_failed')} detail={(agentsError as SWRError).info?.error}
                action={<Button busy={isValidating} onClick={() => { void reloadAgents() }}>{t('try_again')}</Button>} />
        </div>
    )
    if (!agentsBody?.data) return null
    const agents: Agent[] = agentsBody.data.agents
    const devices: Device[] = devicesBody?.data?.devices ?? []
    const intl = locale === 'ar' ? 'ar-EG' : 'en-GB'
    const number = (n: number) => n.toLocaleString(intl)
    // Each fact kept apart from the next, so a host name or a version can't
    // swap places with the words beside it in Arabic (audit on part 3c), and
    // all of them in one span: the detail line puts a gap between its
    // children, which put one before each comma.
    const facts = (items: (string | null | false | undefined)[]): ReactNode => (
        <span>{items.filter(Boolean).map((x, i) => <Fragment key={i}>{i > 0 && t('list_separator')}<bdi>{x}</bdi></Fragment>)}</span>
    )

    const ago = (iso: string | null) => {
        if (!iso) return t('att_term_never')
        const minutes = Math.max(0, Math.round((now - Date.parse(iso)) / 60_000))
        if (minutes < 1) return t('att_term_just_now')
        if (minutes < 60) return t('att_term_minutes_ago').replace('{n}', number(minutes))
        return new Date(iso).toLocaleString(intl, { dateStyle: 'medium', timeStyle: 'short' })
    }
    const drift = (s: number | null) => s === null ? '' : Math.abs(s) < 60 ? t('att_term_drift_s').replace('{n}', number(Math.abs(s))) : t('att_term_drift_m').replace('{n}', number(Math.round(Math.abs(s) / 60)))

    /** Sends one change, then reloads; the server's refusal is shown as it said it. */
    const send = async (url: string, init: RequestInit, done: TranslationKey, then?: (body: { agent?: Agent & { codeExpiresAt: string | null }; code?: string } | undefined) => void) => {
        if (inFlight.current) return false
        inFlight.current = true
        setBusy(true)
        try {
            const res = await fetch(url, { headers: { 'Content-Type': 'application/json' }, ...init })
            const text = await res.text()
            if (!res.ok) {
                showToast(apiErrorText(text, t('error_generic')), 'error')
                return false
            }
            showToast(t(done), 'success')
            then?.(text ? JSON.parse(text).data : undefined)
            void reloadAgents()
            void reloadDevices()
            return true
        } catch {
            showToast(t('error_generic'), 'error')
            return false
        } finally {
            inFlight.current = false
            setBusy(false)
        }
    }

    const newCode = (a: Agent) => send(`/api/attendance/agents/${a.id}/code`, { method: 'POST' }, 'att_term_code_issued',
        d => d?.code && setShownCode({ name: a.name, code: d.code, expiresAt: d.agent?.codeExpiresAt ?? null }))
    const live = agents.filter(a => a.status !== 'REVOKED')
    const revoked = agents.filter(a => a.status === 'REVOKED')

    const agentMenu = (a: Agent): MenuItem[] => [
        { key: 'code', label: t(a.status === 'PENDING' ? 'att_term_new_code' : 'att_term_move_pc'), icon: ArrowsClockwiseIcon, onSelect: () => { void newCode(a) }, disabled: busy },
        { key: 'revoke', label: t('att_term_revoke'), icon: ProhibitIcon, danger: true, onSelect: () => setRevoking(a) },
    ]
    const deviceMenu = (d: Device): MenuItem[] => d.retiredAt
        ? [{ key: 'restore', label: t('att_term_restore'), icon: ArrowCounterClockwiseIcon, onSelect: () => { void send(`/api/attendance/devices/${d.id}/restore`, { method: 'POST' }, 'att_term_restored') }, disabled: busy }]
        : [
            { key: 'edit', label: t('edit'), icon: PencilSimpleIcon, onSelect: () => setEditing(d) },
            { key: 'retire', label: t('att_term_retire'), icon: ProhibitIcon, danger: true, onSelect: () => setRetiring(d) },
        ]

    return (
        <Card
            title={t('att_term_title')}
            actions={<Button variant="primary" icon={PlusIcon} disabled={busy} onClick={() => setAdding(true)}>{t('att_term_add_agent')}</Button>}
        >
            {/* A refresh that failed after it loaded keeps what's here, and anything open, and says so (Codex on PR 164). */}
            {agentsError && <p className="ui-card-note" role="status">{t('ui_refresh_failed')} <Button size="sm" busy={isValidating} onClick={() => { void reloadAgents() }}>{t('try_again')}</Button></p>}
            <p className="ui-card-note">{t('att_term_hint')}</p>

            <section>
                <h3 className="ui-subsection-title">{t('att_term_agents')}</h3>
                {live.length === 0 ? <p className="ui-card-note">{t('att_term_no_agents')}</p> : (
                    <ul className="ui-rows ui-rows-flush" aria-label={t('att_term_agents')}>
                        {live.map(a => (
                            <Row
                                key={a.id}
                                title={<>
                                    <bdi>{a.name}</bdi>{' '}
                                    <StatusBadge tone={AGENT_TONE[a.health]}>{t(`att_term_agent_${a.health}`)}</StatusBadge>
                                    {(a.queueDepth ?? 0) > 0 && <>{' '}<StatusBadge tone="waiting">{t('att_term_queue').replace('{n}', number(a.queueDepth!))}</StatusBadge></>}
                                </>}
                                detail={a.status === 'PENDING' ? t('att_term_waiting_hint') : facts([
                                    a.hostname,
                                    a.agentVersion && `v${a.agentVersion}`,
                                    t('att_term_last_seen').replace('{when}', ago(a.lastSeenAt)),
                                    a.lastSyncAt && t('att_term_last_sync').replace('{when}', ago(a.lastSyncAt)),
                                    a.clockDriftSeconds !== null && Math.abs(a.clockDriftSeconds) > 120 && t('att_term_clock_off').replace('{d}', drift(a.clockDriftSeconds)),
                                ])}
                                end={<RowMenu label={t('ui_more_actions_for').replace('{name}', a.name)} tooltip={t('ui_more_actions')} items={agentMenu(a)} />}
                            />
                        ))}
                    </ul>
                )}
                {revoked.length > 0 && <p className="ui-card-note">{t('att_term_revoked_line').replace('{n}', number(revoked.length))}</p>}
            </section>

            <section>
                <h3 className="ui-subsection-title">{t('att_term_devices')}</h3>
                {devices.length === 0 ? <p className="ui-card-note">{t('att_term_no_devices')}</p> : (
                    <ul className="ui-rows ui-rows-flush" aria-label={t('att_term_devices')}>
                        {devices.map(d => (
                            <Row
                                key={d.id}
                                title={<>
                                    <bdi>{d.name}</bdi>{' '}
                                    <StatusBadge tone={DEVICE_TONE[d.health.state]}>{t(`att_term_device_${d.health.state}`)}</StatusBadge>
                                    {d.health.memoryFull && <>{' '}<StatusBadge tone="waiting">{t('att_term_memory_full').replace('{p}', number(Math.round(100 * (d.recordCount ?? 0) / (d.recordCapacity || 1))))}</StatusBadge></>}
                                    {d.health.clockOff && <>{' '}<StatusBadge tone="waiting">{t('att_term_clock_off').replace('{d}', drift(d.clockDriftSeconds))}</StatusBadge></>}
                                </>}
                                detail={facts([
                                    `${t('att_term_serial')} ${d.serialNumber}`,
                                    d.model,
                                    t('att_term_mode_line').replace('{mode}', t(MODE_LABEL[d.mode])),
                                    t('att_term_last_seen').replace('{when}', ago(d.lastSeenAt)),
                                    d.lastPunchAt && t('att_term_last_punch').replace('{when}', ago(d.lastPunchAt)),
                                    !d.reachable && d.lastError,
                                ])}
                                end={<RowMenu label={t('ui_more_actions_for').replace('{name}', d.name)} tooltip={t('ui_more_actions')} items={deviceMenu(d)} />}
                            />
                        ))}
                    </ul>
                )}
                {/* How a terminal reads scans, once there's one: with none it ran on from "No terminal yet". */}
                {devices.length > 0 && <p className="ui-card-note">{t('att_term_mode_hint')}</p>}
            </section>

            {adding && (
                <AgentDialog busy={busy} onClose={() => setAdding(false)} onSubmit={async name => {
                    await send('/api/attendance/agents', { method: 'POST', body: JSON.stringify({ companyId, name }) }, 'att_term_agent_added', d => {
                        if (d?.agent && d.code) setShownCode({ name: d.agent.name, code: d.code, expiresAt: d.agent.codeExpiresAt })
                        setAdding(false)
                    })
                }} />
            )}
            {shownCode && <CodeDialog shown={shownCode} onClose={() => setShownCode(null)} />}
            {editing && (
                <TerminalDialog device={editing} busy={busy} onClose={() => setEditing(null)} onSubmit={async change => {
                    await send(`/api/attendance/devices/${editing.id}`, { method: 'PATCH', body: JSON.stringify(change) }, 'att_term_saved', () => setEditing(null))
                }} />
            )}

            {/* Revoking an agent and retiring a terminal can't be taken back by themselves: asked about first. */}
            <Dialog
                open={!!revoking}
                onClose={() => { if (!busy) setRevoking(null) }}
                title={t('att_term_revoke_title').replace('{name}', revoking?.name ?? '')}
                actions={<>
                    <Button onClick={() => setRevoking(null)} disabled={busy}>{t('cancel')}</Button>
                    <Button variant="danger" busy={busy} onClick={() => { if (revoking) void send(`/api/attendance/agents/${revoking.id}`, { method: 'DELETE' }, 'att_term_revoked', () => setRevoking(null)) }}>{t('att_term_revoke')}</Button>
                </>}
            >
                <p>{t('att_term_revoke_body')}</p>
            </Dialog>
            <Dialog
                open={!!retiring}
                onClose={() => { if (!busy) setRetiring(null) }}
                title={t('att_term_retire_title').replace('{name}', retiring?.name ?? '')}
                actions={<>
                    <Button onClick={() => setRetiring(null)} disabled={busy}>{t('cancel')}</Button>
                    <Button variant="danger" busy={busy} onClick={() => { if (retiring) void send(`/api/attendance/devices/${retiring.id}`, { method: 'DELETE' }, 'att_term_retired', () => setRetiring(null)) }}>{t('att_term_retire')}</Button>
                </>}
            >
                <p>{t('att_term_retire_body')}</p>
            </Dialog>
        </Card>
    )
}

/** Adds an agent: its name, which it needs, said under the field. */
export function AgentDialog({ busy, onClose, onSubmit }: { busy: boolean; onClose: () => void; onSubmit: (name: string) => Promise<void> }) {
    const { t } = useLanguage()
    const formRef = useRef<HTMLFormElement>(null)
    const [name, setName] = useState('')
    const [error, setError] = useState<string | undefined>()
    const submit = async (e: FormEvent) => {
        e.preventDefault()
        if (!name.trim()) { setError(t('att_term_agent_name_required')); focusFirstWrong(formRef.current); return }
        await onSubmit(name.trim())
    }
    return (
        <Dialog open onClose={() => { if (!busy) onClose() }} title={t('att_term_add_agent')}>
            <form ref={formRef} className="ui-form" noValidate onSubmit={submit}>
                <Field label={t('att_term_agent_name')} hint={t('att_term_agent_name_hint')} error={error}>{p => (
                    <TextInput {...p} name="name" autoComplete="off" maxLength={80} value={name} onChange={e => { setName(e.target.value); setError(undefined) }} />
                )}</Field>
                <DialogActions>
                    <Button onClick={onClose} disabled={busy}>{t('cancel')}</Button>
                    <Button type="submit" variant="primary" busy={busy}>{t('att_term_add_agent')}</Button>
                </DialogActions>
            </form>
        </Dialog>
    )
}

/** The one-time code to type into the agent on the office PC, shown once. */
export function CodeDialog({ shown, onClose }: { shown: Shown; onClose: () => void }) {
    const { t, locale } = useLanguage()
    const intl = locale === 'ar' ? 'ar-EG' : 'en-GB'
    return (
        <Dialog
            open
            onClose={onClose}
            title={t('att_term_code_title').replace('{name}', shown.name)}
            actions={<Button variant="primary" onClick={onClose}>{t('att_term_done')}</Button>}
        >
            <p>{t('att_term_code_hint')}</p>
            {/* Typed as shown: left to right, and never translated by the page. */}
            <p className="ui-code" dir="ltr" translate="no">{shown.code}</p>
            {shown.expiresAt && <p className="ui-hint">{t('att_term_code_expires').replace('{time}', new Date(shown.expiresAt).toLocaleTimeString(intl, { timeStyle: 'short' }))}</p>}
            <p className="ui-hint">{t('att_term_code_once')}</p>
        </Dialog>
    )
}

/** A terminal's name, which it needs, and how it reads scans. */
export function TerminalDialog({ device, busy, onClose, onSubmit }: {
    device: Pick<Device, 'name' | 'mode'>
    busy: boolean
    onClose: () => void
    onSubmit: (change: { name: string; mode: Device['mode'] }) => Promise<void>
}) {
    const { t } = useLanguage()
    const formRef = useRef<HTMLFormElement>(null)
    const [name, setName] = useState(device.name)
    const [mode, setMode] = useState<Device['mode']>(device.mode)
    const [error, setError] = useState<string | undefined>()
    const submit = async (e: FormEvent) => {
        e.preventDefault()
        if (!name.trim()) { setError(t('att_term_device_name_required')); focusFirstWrong(formRef.current); return }
        await onSubmit({ name: name.trim(), mode })
    }
    return (
        <Dialog open onClose={() => { if (!busy) onClose() }} title={t('att_term_edit_title').replace('{name}', device.name)}>
            <form ref={formRef} className="ui-form" noValidate onSubmit={submit}>
                <Field label={t('att_term_device_name')} error={error}>{p => (
                    <TextInput {...p} name="name" autoComplete="off" maxLength={80} value={name} onChange={e => { setName(e.target.value); setError(undefined) }} />
                )}</Field>
                <Field label={t('att_term_mode')} hint={t('att_term_mode_hint')}>{p => (
                    <Select {...p} name="mode" value={mode} options={MODES.map(m => ({ value: m, label: t(MODE_LABEL[m]) }))} onChange={e => setMode(e.target.value as Device['mode'])} />
                )}</Field>
                <DialogActions>
                    <Button onClick={onClose} disabled={busy}>{t('cancel')}</Button>
                    <Button type="submit" variant="primary" busy={busy}>{t('save')}</Button>
                </DialogActions>
            </form>
        </Dialog>
    )
}

'use client'

import { Fragment, useRef, useState, type FormEvent, type ReactNode } from 'react'
import useSWR from 'swr'
import { useSession } from 'next-auth/react'
import { ArrowsClockwiseIcon, GlobeSimpleIcon, KeyIcon, ListMagnifyingGlassIcon, PencilSimpleIcon, PlugsConnectedIcon, PlusIcon, ProhibitIcon, ArrowCounterClockwiseIcon, WarningCircleIcon, WrenchIcon } from '@phosphor-icons/react/ssr'
import { fetcher, type SWRError } from '@/lib/swr-fetcher'
import { useLanguage } from '@/context/LanguageContext'
import { useToast } from '@/context/ToastContext'
import { apiErrorText } from '@/lib/api-error-text'
import { useNow } from '@/lib/useNow'
import type { TranslationKey } from '@/lib/translations'
import { Button, Card, Dialog, DialogActions, EmptyState, Field, GuideButton, Row, RowMenu, Select, StatusBadge, TextInput, type MenuItem, type StatusTone } from '@/components/ui'
import { focusFirstWrong } from '@/components/attendance-calendar/focus'
import TerminalSetupGuide, { type GuideBrand } from '@/components/TerminalSetupGuide'
import { ConnectionDialog, OfficeAddressDialog, TerminalAddDialog, TerminalAddressDialog, TerminalSettingsDialog } from '@/components/TerminalAddDialog'
import { TerminalContactsDialog } from '@/components/TerminalContactsDialog'
import { agentReads, hasAddress, hasOfficeAddress, keepsFirstContacts, otherConnection, refusalWords } from '@/lib/attendance/terminal-connections'
import { utcOffsetLabel } from '@/lib/attendance/terminal-health'

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
 *
 * A round "i" beside its title opens How to set up a fingerprint terminal
 * (§17.7, PR 282), its steps by the model picked from the brands offered.
 *
 * A terminal is also added by hand (§17.7, PR 292), with how it connects:
 * through the agent, where it waits for an agent to report it, or straight
 * to Nizmo, where what to set on it is shown once. One straight to Nizmo
 * says so on its row, with where it calls from and what was refused, and
 * its menu issues a new address.
 *
 * A ZKTeco terminal straight to Nizmo (PR 297) is let in from its office's
 * internet address, which its row says and its menu changes; what to set
 * on it holds no secret, so its menu shows it again at any time.
 *
 * A terminal's menu moves it to its other way of connecting, where one is
 * open to it (PR 298): straight to Nizmo, then what to set on it is shown,
 * as after adding it.
 */

type Agent = {
    id: string; name: string; status: 'PENDING' | 'ACTIVE' | 'REVOKED'; codeExpiresAt: string | null
    hostname: string | null; agentVersion: string | null; lastSeenAt: string | null; lastSyncAt: string | null
    queueDepth: number | null; clockDriftSeconds: number | null
    health: 'WAITING' | 'REVOKED' | 'OK' | 'SILENT' | 'QUIET'
}
type Device = {
    id: string; serialNumber: string; name: string; model: string | null; mode: 'ANY' | 'ENTRANCE' | 'EXIT'
    // What it speaks, and the brand printed on it (ATTENDANCE_PLAN.md §17.9, PR 280).
    protocol: 'ZKTECO' | 'HIKVISION'; brand: { id: string; name: string; retired: boolean } | null
    // How its scans come, and for one straight to Nizmo, where it calls from and what was refused (§17.7, PR 292).
    connection: 'AGENT' | 'DIRECT'; lastAddress: string | null; refusedCount: number; lastRefusedAt: string | null; lastRefusal: string | null
    // Its own offset from UTC, as its last scan stated it (§17.5, PR 293).
    utcOffsetMinutes: number | null
    // The office's internet addresses a ZKTeco terminal straight to Nizmo is let in from (§17.3, PR 297).
    allowedAddresses?: string[]
    lastSeenAt: string | null; lastPunchAt: string | null; reachable: boolean; lastError: string | null
    clockDriftSeconds: number | null; recordCount: number | null; recordCapacity: number | null; retiredAt: string | null
    health: { state: 'RETIRED' | 'WAITING' | 'OK' | 'UNREACHABLE' | 'SILENT' | 'QUIET'; memoryFull: boolean; clockOff: boolean; zoneOff?: boolean }
}
type Shown = { name: string; code: string; expiresAt: string | null }
/** A terminal's address to set on it, with its secret: held only while its dialog is open. */
type ShownAddress = { name: string; path: string; brandId: string | null }
/** A ZKTeco terminal's settings to show: nothing secret in them (PR 297). */
type ShownSettings = { name: string; brandId: string | null }
/** A brand one may give a terminal: the Super Admin's, not retired, with their notes for the setup guide (PR 282). */
type OfferedBrand = GuideBrand

const AGENT_TONE: Record<Agent['health'], StatusTone> = { OK: 'good', SILENT: 'problem', QUIET: 'neutral', WAITING: 'waiting', REVOKED: 'neutral' }
const DEVICE_TONE: Record<Device['health']['state'], StatusTone> = { OK: 'good', WAITING: 'waiting', UNREACHABLE: 'problem', SILENT: 'problem', QUIET: 'neutral', RETIRED: 'neutral' }
const MODES: Device['mode'][] = ['ANY', 'ENTRANCE', 'EXIT']
const MODE_LABEL = { ANY: 'audit_value_ANY', ENTRANCE: 'audit_value_ENTRANCE', EXIT: 'audit_value_EXIT' } as const

export default function AttendanceTerminalsPanel({ companyId }: { companyId: string }) {
    const { t, locale } = useLanguage()
    const { showToast } = useToast()
    const { data: session } = useSession()
    const superAdmin = session?.user?.role === 'SUPER_ADMIN'
    const now = useNow(30_000)
    const q = `?companyId=${encodeURIComponent(companyId)}`
    // Refreshed as heartbeats come in: health is the point of the panel.
    const { data: agentsBody, error: agentsError, isValidating, mutate: reloadAgents } = useSWR(`/api/attendance/agents${q}`, fetcher, { refreshInterval: 60_000 })
    const { data: devicesBody, error: devicesError, mutate: reloadDevices } = useSWR(agentsBody ? `/api/attendance/devices${q}` : null, fetcher, { refreshInterval: 60_000 })
    const [adding, setAdding] = useState(false)
    const [addingDevice, setAddingDevice] = useState(false)
    const [shownCode, setShownCode] = useState<Shown | null>(null)
    const [shownAddress, setShownAddress] = useState<ShownAddress | null>(null)
    const [shownSettings, setShownSettings] = useState<ShownSettings | null>(null)
    /** The ZKTeco terminal whose office's address is being changed (PR 297). */
    const [officeOf, setOfficeOf] = useState<Device | null>(null)
    /** The terminal being moved to its other way of connecting (PR 298). */
    const [moving, setMoving] = useState<Device | null>(null)
    const [reissuing, setReissuing] = useState<Device | null>(null)
    /** The terminal whose first contacts the Super Admin is reading (§17.8, PR 294). */
    const [contactsOf, setContactsOf] = useState<Device | null>(null)
    const [revoking, setRevoking] = useState<Agent | null>(null)
    const [editing, setEditing] = useState<Device | null>(null)
    const [retiring, setRetiring] = useState<Device | null>(null)
    const [guiding, setGuiding] = useState(false)
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
    const brands: OfferedBrand[] = devicesBody?.data?.brands ?? []
    // Whether the Super Admin has turned terminals straight to Nizmo on for this company (§17.8).
    const directAllowed: boolean = devicesBody?.data?.directAllowed ?? false
    const intl = locale === 'ar' ? 'ar-EG' : 'en-GB'
    const number = (n: number) => n.toLocaleString(intl)
    // Each fact kept apart from the next, so a host name or a version can't
    // swap places with the words beside it in Arabic (audit on part 3c), and
    // all of them in one span: the detail line puts a gap between its
    // children, which put one before each comma.
    const facts = (items: ReactNode[]): ReactNode => (
        <span>{items.filter(Boolean).map((x, i) => <Fragment key={i}>{i > 0 && t('list_separator')}<bdi>{x}</bdi></Fragment>)}</span>
    )

    /** Its brand, the name kept as printed (never machine-translated), or that none is picked yet (§17.9, PR 280). */
    const brandLine = (d: Device): ReactNode => {
        if (!d.brand) return t('att_term_brand_none')
        const [before, after] = t('att_term_brand_line').split('{brand}')
        return <>{before}<bdi translate="no">{d.brand.name}</bdi>{after}</>
    }

    const ago = (iso: string | null) => {
        if (!iso) return t('att_term_never')
        const minutes = Math.max(0, Math.round((now - Date.parse(iso)) / 60_000))
        if (minutes < 1) return t('att_term_just_now')
        if (minutes < 60) return t('att_term_minutes_ago').replace('{n}', number(minutes))
        return new Date(iso).toLocaleString(intl, { dateStyle: 'medium', timeStyle: 'short' })
    }
    /**
     * The time zone a terminal states, where it isn't the company's: written
     * as it is, left to right, in either language (§17.5, PR 293). One
     * piece, so the badge's gap between its pieces doesn't split the
     * sentence around the offset.
     */
    const zoneLine = (minutes: number): ReactNode => {
        const [before, after] = t('att_term_zone_off').split('{zone}')
        return <span>{before}<bdi dir="ltr" translate="no">{utcOffsetLabel(minutes)}</bdi>{after}</span>
    }
    /** Where a terminal straight to Nizmo last called from: an address, left to right and never translated (web audit, PR 292). */
    const callsFrom = (d: Device): ReactNode => {
        if (d.connection !== 'DIRECT' || !d.lastAddress) return null
        const [before, after] = t('att_term_calls_from').split('{address}')
        return <>{before}<bdi dir="ltr" translate="no">{d.lastAddress}</bdi>{after}</>
    }
    /**
     * Where a ZKTeco terminal straight to Nizmo is let in from: its office's
     * addresses, each left to right and never translated, joined by the
     * language's own "and", since the facts around them are joined by commas
     * (web audit, PR 297).
     */
    const officeLine = (d: Device): ReactNode => {
        if (!hasOfficeAddress(d) || !d.allowedAddresses?.length) return null
        const [before, after] = t('att_term_office_line').split('{addresses}')
        const parts = new Intl.ListFormat(intl, { type: 'conjunction' }).formatToParts(d.allowedAddresses)
        return <>{before}{parts.map((p, i) => p.type === 'element' ? <bdi key={i} dir="ltr" translate="no">{p.value}</bdi> : <Fragment key={i}>{p.value}</Fragment>)}{after}</>
    }
    /**
     * What was refused of a terminal's own scans: how many, when last, and
     * why, in words where there are some (§17.5). A call from an address
     * that isn't the office's names it, left to right (PR 297).
     */
    const refusedLine = (d: Device): ReactNode => {
        // None, or a list from before the count was sent: nothing to say.
        if (!(d.refusedCount > 0)) return null
        const words = d.lastRefusal ? refusalWords(d.lastRefusal) : null
        let reason: ReactNode = d.lastRefusal ?? ''
        if (words?.address !== undefined) {
            const [before, after] = t(words.key).split('{address}')
            reason = <>{before}<bdi dir="ltr" translate="no">{words.address}</bdi>{after}</>
        } else if (words) reason = t(words.key).replace('{type}', words.type ?? '')
        const [head, tail] = t('att_term_refused_line').replace('{n}', number(d.refusedCount)).replace('{when}', ago(d.lastRefusedAt)).split('{reason}')
        return <>{head}{reason}{tail}</>
    }
    const drift = (s: number | null) => s === null ? '' : Math.abs(s) < 60 ? t('att_term_drift_s').replace('{n}', number(Math.abs(s))) : t('att_term_drift_m').replace('{n}', number(Math.round(Math.abs(s) / 60)))

    /** Sends one change, then reloads; the server's refusal is shown as it said it. */
    const send = async (url: string, init: RequestInit, done: TranslationKey, then?: (body: { agent?: Agent & { codeExpiresAt: string | null }; code?: string; device?: Pick<Device, 'name' | 'protocol' | 'connection'> & { brand: { id: string } | null }; path?: string | null } | undefined) => void) => {
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
    // What a terminal straight to Nizmo sent in its first requests, for the Super Admin alone (§17.8, PR 294): the server refuses anyone else.
    const contactsItem = (d: Device): MenuItem[] => (superAdmin && keepsFirstContacts(d) ? [{ key: 'contacts', label: t('att_term_contacts'), icon: ListMagnifyingGlassIcon, onSelect: () => setContactsOf(d) }] : [])
    const deviceMenu = (d: Device): MenuItem[] => d.retiredAt
        ? [
            { key: 'restore', label: t('att_term_restore'), icon: ArrowCounterClockwiseIcon, onSelect: () => { void send(`/api/attendance/devices/${d.id}/restore`, { method: 'POST' }, 'att_term_restored') }, disabled: busy },
            ...contactsItem(d),
        ]
        : [
            { key: 'edit', label: t('edit'), icon: PencilSimpleIcon, onSelect: () => setEditing(d) },
            // Where another way is open to it: the other built for its protocol, straight to Nizmo only where the switch is on (PR 298).
            ...(otherConnection(d, directAllowed) ? [{ key: 'connection', label: t('att_term_change_connection'), icon: PlugsConnectedIcon, onSelect: () => setMoving(d) }] : []),
            // A Hikvision terminal straight to Nizmo has an address of its own (§17.2, PR 292).
            ...(hasAddress(d) ? [{ key: 'address', label: t('att_term_new_address'), icon: KeyIcon, onSelect: () => setReissuing(d) }] : []),
            // A ZKTeco terminal straight to Nizmo: what to set on it, again, and where it's let in from (PR 297).
            ...(hasOfficeAddress(d) ? [
                { key: 'settings', label: t('att_term_settings'), icon: WrenchIcon, onSelect: () => setShownSettings({ name: d.name, brandId: d.brand?.id ?? null }) },
                { key: 'office', label: t('att_term_change_office'), icon: GlobeSimpleIcon, onSelect: () => setOfficeOf(d) },
            ] : []),
            ...contactsItem(d),
            { key: 'retire', label: t('att_term_retire'), icon: ProhibitIcon, danger: true, onSelect: () => setRetiring(d) },
        ]
    /**
     * The address just issued, to show once: the path with its secret is kept
     * nowhere else. A ZKTeco terminal just added straight to Nizmo has none:
     * what to set on it is shown instead (PR 297).
     */
    const showAddress = (d: { device?: Pick<Device, 'name' | 'protocol' | 'connection'> & { brand: { id: string } | null }; path?: string | null } | undefined) => {
        if (d?.device && d.path) setShownAddress({ name: d.device.name, path: d.path, brandId: d.device.brand?.id ?? null })
        else if (d?.device && hasOfficeAddress(d.device)) setShownSettings({ name: d.device.name, brandId: d.device.brand?.id ?? null })
    }
    const movingTo = moving ? otherConnection(moving, directAllowed) : null

    return (
        <Card
            title={t('att_term_title')}
            titleAside={<GuideButton label={t('att_guide_button')} onClick={() => setGuiding(true)} />}
            actions={<>
                {/* It asks for a brand, so it waits for the terminals list, which offers them. */}
                <Button icon={PlusIcon} disabled={busy || !devicesBody} onClick={() => setAddingDevice(true)}>{t('att_term_add_device')}</Button>
                <Button variant="primary" icon={PlusIcon} disabled={busy} onClick={() => setAdding(true)}>{t('att_term_add_agent')}</Button>
            </>}
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
                                    {d.health.zoneOff && typeof d.utcOffsetMinutes === 'number' && <>{' '}<StatusBadge tone="waiting">{zoneLine(d.utcOffsetMinutes)}</StatusBadge></>}
                                </>}
                                detail={facts([
                                    `${t('att_term_serial')} ${d.serialNumber}`,
                                    brandLine(d),
                                    d.model,
                                    t('att_term_mode_line').replace('{mode}', t(MODE_LABEL[d.mode])),
                                    d.connection === 'DIRECT' && t('att_term_connection_DIRECT'),
                                    // Added by hand and not heard from yet: what it waits for, in place of "seen never".
                                    d.health.state === 'WAITING'
                                        ? d.connection === 'AGENT' && t('att_term_waiting_agent')
                                        : t('att_term_last_seen').replace('{when}', ago(d.lastSeenAt)),
                                    d.lastPunchAt && t('att_term_last_punch').replace('{when}', ago(d.lastPunchAt)),
                                    callsFrom(d),
                                    officeLine(d),
                                    refusedLine(d),
                                    d.connection === 'AGENT' && !d.reachable && d.lastError,
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
            {addingDevice && (
                <TerminalAddDialog brands={brands} directAllowed={directAllowed} busy={busy} onClose={() => setAddingDevice(false)} onSubmit={async terminal => {
                    await send('/api/attendance/devices', { method: 'POST', body: JSON.stringify({ companyId, ...terminal }) }, 'att_term_device_added', d => {
                        showAddress(d)
                        setAddingDevice(false)
                    })
                }} />
            )}
            {/* What to set on the terminal names this Nizmo's own address, as the page was opened on (§18, 6). */}
            {shownAddress && (
                <TerminalAddressDialog name={shownAddress.name} path={shownAddress.path} host={window.location.host}
                    brand={brands.find(b => b.id === shownAddress.brandId) ?? null} onClose={() => setShownAddress(null)} />
            )}
            {/* What to set on a ZKTeco terminal: this Nizmo's own address, too (§18, 6). */}
            {shownSettings && (
                <TerminalSettingsDialog name={shownSettings.name} host={window.location.host}
                    brand={brands.find(b => b.id === shownSettings.brandId) ?? null} onClose={() => setShownSettings(null)} />
            )}
            {officeOf && (
                <OfficeAddressDialog name={officeOf.name} addresses={officeOf.allowedAddresses ?? []} busy={busy} onClose={() => setOfficeOf(null)} onSubmit={async addresses => {
                    await send(`/api/attendance/devices/${officeOf.id}/office-address`, { method: 'PUT', body: JSON.stringify({ addresses }) }, 'att_term_office_saved', () => setOfficeOf(null))
                }} />
            )}
            {moving && movingTo && (
                <ConnectionDialog name={moving.name} to={movingTo} protocol={moving.protocol} officeAsked={hasOfficeAddress({ protocol: moving.protocol, connection: movingTo })} noAgentReadsIt={movingTo === 'AGENT' && moving.protocol === 'HIKVISION' && !agents.some(a => a.status === 'ACTIVE' && agentReads('HIKVISION', a.agentVersion))} busy={busy} onClose={() => setMoving(null)} onSubmit={async officeAddresses => {
                    await send(`/api/attendance/devices/${moving.id}/connection`, { method: 'PUT', body: JSON.stringify({ connection: movingTo, ...(officeAddresses && { officeAddresses }) }) }, `att_term_moved_${movingTo}`, d => { showAddress(d); setMoving(null) })
                }} />
            )}
            {contactsOf && <TerminalContactsDialog deviceId={contactsOf.id} name={contactsOf.name} protocol={contactsOf.protocol} onClose={() => setContactsOf(null)} />}
            {/* The agent sends to this Nizmo, so its settings name the address it's opened on. */}
            {guiding && <TerminalSetupGuide brands={devicesBody ? brands : null} loadFailed={!!devicesError} superAdmin={superAdmin} directAllowed={directAllowed} server={window.location.origin} onClose={() => setGuiding(false)} />}
            {editing && (
                <TerminalDialog device={editing} brands={brands} busy={busy} onClose={() => setEditing(null)} onSubmit={async change => {
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
            {/* The address it has stops working at once, so it's asked about first; it isn't a loss, so the button isn't the danger one. */}
            <Dialog
                open={!!reissuing}
                onClose={() => { if (!busy) setReissuing(null) }}
                title={t('att_term_new_address_title').replace('{name}', reissuing?.name ?? '')}
                actions={<>
                    <Button onClick={() => setReissuing(null)} disabled={busy}>{t('cancel')}</Button>
                    <Button variant="primary" busy={busy} onClick={() => {
                        if (reissuing) void send(`/api/attendance/devices/${reissuing.id}/address`, { method: 'POST' }, 'att_term_address_issued', d => { showAddress(d); setReissuing(null) })
                    }}>{t('att_term_new_address')}</Button>
                </>}
            >
                <p>{t('att_term_new_address_body')}</p>
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

/**
 * A terminal's name, which it needs, how it reads scans, and its brand
 * (ATTENDANCE_PLAN.md §17.9, PR 280): one of the brands that speak its
 * protocol. A brand retired since stays chosen, marked, and is the only
 * retired one offered (DESIGN.md §5.5); "Not picked yet" is there only
 * until one is.
 */
export function TerminalDialog({ device, brands, busy, onClose, onSubmit }: {
    device: Pick<Device, 'name' | 'mode' | 'protocol' | 'brand'>
    brands: OfferedBrand[]
    busy: boolean
    onClose: () => void
    onSubmit: (change: { name: string; mode: Device['mode']; brandId?: string }) => Promise<void>
}) {
    const { t } = useLanguage()
    const formRef = useRef<HTMLFormElement>(null)
    const [name, setName] = useState(device.name)
    const [mode, setMode] = useState<Device['mode']>(device.mode)
    const [brandId, setBrandId] = useState(device.brand?.id ?? '')
    const [error, setError] = useState<string | undefined>()
    const brandOptions = [
        ...(device.brand ? [] : [{ value: '', label: t('att_term_brand_unpicked') }]),
        ...(device.brand?.retired ? [{ value: device.brand.id, label: t('att_term_brand_retired').replace('{name}', device.brand.name) }] : []),
        ...brands.filter(b => b.protocol === device.protocol).map(b => ({ value: b.id, label: b.name })),
    ]
    const submit = async (e: FormEvent) => {
        e.preventDefault()
        if (!name.trim()) { setError(t('att_term_device_name_required')); focusFirstWrong(formRef.current); return }
        await onSubmit({ name: name.trim(), mode, ...(brandId && { brandId }) })
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
                <Field label={t('att_term_brand')} hint={t('att_term_brand_hint')}>{p => (
                    <Select {...p} name="brand" value={brandId} options={brandOptions} onChange={e => setBrandId(e.target.value)} />
                )}</Field>
                <DialogActions>
                    <Button onClick={onClose} disabled={busy}>{t('cancel')}</Button>
                    <Button type="submit" variant="primary" busy={busy}>{t('save')}</Button>
                </DialogActions>
            </form>
        </Dialog>
    )
}

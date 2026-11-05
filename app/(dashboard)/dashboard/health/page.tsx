'use client'

import { useRef, useState, type ReactNode } from 'react'
import useSWR from 'swr'
import { HourglassIcon, WarningCircleIcon } from '@phosphor-icons/react/ssr'
import AccessDenied from '@/components/AccessDenied'
import BackupPickerModal, { type BackupEntry } from '@/components/BackupPickerModal'
import { answerFor, ConfirmHealthAction, OrphanReport, type OrphanSweep } from '@/components/HealthDialogs'
import JobsCard from '@/components/JobsCard'
import TerminalsHealthCard from '@/components/TerminalsHealthCard'
import { Button, Card, Columns, Details, EmptyState, Field, Page, PageHeader, Section, StatusBadge, TextArea } from '@/components/ui'
import { useLanguage } from '@/context/LanguageContext'
import { useToast } from '@/context/ToastContext'
import { countOf } from '@/lib/plural'
import { fileSize } from '@/lib/record-files'
import { fetcher, fetchRetrying, type SWRError } from '@/lib/swr-fetcher'
import type { TranslationKey } from '@/lib/translations'
import { useBusyAction } from '@/lib/useBusyAction'
import { useViewer } from '@/lib/useCan'

/**
 * System health (UI_PLAN.md §5 step 5, Operations part 3a): what's running,
 * the platform's housekeeping, its backups and recovery, and maintenance
 * mode, each a section on the building blocks. The page was cards of its
 * own making, with emoji for icons, sizes and colours typed in, the old
 * confirmation window, and every result in a window of its own; results
 * are toasts now. Its scheduled jobs card, terminals card and backup
 * picker followed in part 3b.
 */

type Counted = { total: number; prunable: number; retentionDays: number }
type HealthMetrics = {
    auditing: Counted
    notifications: Counted
    storage: { totalFiles: number | null; reachable: boolean }
}
type Settings = { maintenanceMode: boolean; maintenanceMessage: string | null }

/** What's waiting to be asked about, and the backup picked, for a restore of one. */
type Pending =
    | { action: 'DELETE_ORPHANS' | 'PRUNE_LOGS' | 'PRUNE_NOTIFICATIONS' | 'BACKUP' | 'RESTORE_LATEST' | 'MAINTENANCE_ON' | 'MAINTENANCE_OFF' }
    | { action: 'RESTORE_SPECIFIC'; backup: BackupEntry }

/** The words typed before what can't be undone, as the code has them in both languages. */
const RESTORE_WORD = 'RESTORE'
const DELETE_WORD = 'DELETE'
/** The server's own limit (lib/validations/system-settings.schema.ts). */
const MESSAGE_MAX = 500

/** An action's answer, or the status it was refused with (0: no answer at all). */
type Sent = { ok: true; data: any } | { ok: false; status: number }

async function send(url: string, method: 'POST' | 'PUT', body?: unknown): Promise<Sent> {
    try {
        const res = await fetch(url, body === undefined ? { method } : { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
        const result = await res.json().catch(() => null)
        return res.ok && result?.success ? { ok: true, data: result.data } : { ok: false, status: res.status }
    } catch {
        return { ok: false, status: 0 }
    }
}

export default function SystemHealthPage() {
    const { t, locale } = useLanguage()
    const { showToast } = useToast()
    // Who is looking comes from the layout on the first paint, so a Super
    // Admin never sees "Access restricted" while the session loads. It had
    // no check of its own: anyone opening its address saw its cards, empty.
    const viewer = useViewer()
    const isSuperAdmin = viewer?.role === 'SUPER_ADMIN'
    const action = useBusyAction()

    const { data: healthResult, error: healthError, isValidating: healthLoading, mutate: reloadHealth } = useSWR(isSuperAdmin ? '/api/admin/health' : null, fetcher)
    const { data: settingsResult, error: settingsError, isValidating: settingsLoading, mutate: reloadSettings } = useSWR(isSuperAdmin ? '/api/system-settings' : null, fetcher)
    const metrics: HealthMetrics | null = healthResult?.success ? healthResult.data : null
    const settings: Settings | null = settingsResult?.success ? settingsResult.data : null

    const [pending, setPending] = useState<Pending | null>(null)
    const [report, setReport] = useState<OrphanSweep | null>(null)
    // What's typed, once something is; until then the message saved.
    const [message, setMessage] = useState<string | null>(null)
    // Which list was asked for last: only its answer lands, and only while its picker is open.
    const [picker, setPicker] = useState<{ request: number; backups: BackupEntry[]; loading: boolean; error: string | null; reason?: string | null } | null>(null)
    const pickerAsked = useRef(0)

    if (!isSuperAdmin) return <AccessDenied superAdmins />

    const num = (n: number) => n.toLocaleString(locale === 'ar' ? 'ar-EG' : 'en-GB')
    const days = (c: Counted) => num(c.retentionDays)
    const shownMessage = message ?? settings?.maintenanceMessage ?? ''
    const failed = (key: TranslationKey) => showToast(t(key), 'error')

    /** A look at what a sweep would delete, shown under the count. Deletes nothing. */
    const findUnused = () => action.run('scan', async () => {
        const res = await send('/api/admin/maintenance', 'POST', { action: 'CLEANUP_ASSETS', params: { dryRun: true } })
        if (!res.ok) return failed('maintenance_failed')
        setReport(res.data.result)
    })

    const run = (p: Pending) => action.run(p.action, async () => {
        switch (p.action) {
            case 'DELETE_ORPHANS': {
                // confirm lets it past the share of files the server thinks
                // plausible, which a real backlog will always pass, and which
                // only somebody who has read the list can judge.
                const res = await send('/api/admin/maintenance', 'POST', { action: 'CLEANUP_ASSETS', params: { dryRun: false, confirm: true } })
                if (!res.ok) return failed('maintenance_failed')
                const done = res.data.result
                showToast(t('orphans_deleted_msg').replace('{count}', countOf(t, locale, done.deleted ?? 0, 'files')).replace('{size}', fileSize(done.bytes ?? 0, locale)), 'success')
                setReport(null)
                void reloadHealth()
                break
            }
            case 'PRUNE_LOGS':
            case 'PRUNE_NOTIFICATIONS': {
                const res = await send('/api/admin/maintenance', 'POST', { action: p.action })
                if (!res.ok) return failed('maintenance_failed')
                showToast(t('health_deleted').replace('{count}', countOf(t, locale, Number(res.data.result) || 0, p.action === 'PRUNE_LOGS' ? 'logged' : 'notices')), 'success')
                void reloadHealth()
                break
            }
            case 'BACKUP': {
                const res = await send('/api/admin/maintenance/backup', 'POST')
                if (!res.ok) return failed(res.status === 429 ? 'health_backup_too_many' : 'backup_trigger_failed')
                showToast(t('backup_triggered_success'), 'success')
                break
            }
            case 'RESTORE_LATEST':
            case 'RESTORE_SPECIFIC': {
                const res = await send('/api/admin/maintenance/restore', 'POST', p.action === 'RESTORE_SPECIFIC'
                    ? { mode: 'specific', folder: p.backup.folder, baseName: p.backup.baseName }
                    : { mode: 'latest' })
                if (!res.ok) return failed('restore_trigger_failed')
                showToast(t('restore_started_success'), 'success')
                break
            }
            case 'MAINTENANCE_ON':
            case 'MAINTENANCE_OFF': {
                const on = p.action === 'MAINTENANCE_ON'
                const res = await send('/api/system-settings', 'PUT', { maintenanceMode: on, maintenanceMessage: shownMessage.trim() || null })
                if (!res.ok) return failed('maintenance_toggle_failed')
                await reloadSettings({ success: true, data: res.data }, { revalidate: false })
                setMessage(null)
                showToast(t(on ? 'health_maintenance_turned_on' : 'health_maintenance_turned_off'), 'success')
                break
            }
        }
        setPending(null)
    })

    // The backups on Google Drive, for the picker.
    const openPicker = async () => {
        const request = ++pickerAsked.current
        setPicker({ request, backups: [], loading: true, error: null })
        try {
            const res = await fetchRetrying('/api/admin/maintenance/backups')
            const result = await res.json()
            setPicker(p => answerFor(p, result.success
                ? { request, backups: result.data.backups, loading: false, error: null }
                // The server's own words for why, where the picker guessed.
                : { request, backups: [], loading: false, error: t('backup_picker_error'), reason: result.error ?? null }))
        } catch {
            setPicker(p => answerFor(p, { request, backups: [], loading: false, error: t('backup_picker_error') }))
        }
    }

    // What each asks, its button, and the word typed first where it can't be undone.
    const question = (p: Pending): { title: string; body: ReactNode; label: string; word?: string; danger?: boolean } => {
        const a = metrics?.auditing
        const n = metrics?.notifications
        switch (p.action) {
            case 'DELETE_ORPHANS': return {
                title: t('confirm_delete_orphans_title'), label: t('orphan_report_delete'), word: DELETE_WORD, danger: true,
                body: t('confirm_delete_orphans_msg').replace('{count}', countOf(t, locale, report?.orphaned ?? 0, 'files')).replace('{size}', fileSize(report?.bytes ?? 0, locale)),
            }
            case 'PRUNE_LOGS': return {
                title: t('confirm_prune_logs_title'), label: t('health_prune_logs').replace('{days}', a ? days(a) : ''), danger: true,
                body: t('confirm_prune_logs_msg').replace('{count}', countOf(t, locale, a?.prunable ?? 0, 'logged')).replace('{days}', a ? days(a) : ''),
            }
            case 'PRUNE_NOTIFICATIONS': return {
                title: t('confirm_prune_notifications_title'), label: t('health_prune_notifications').replace('{days}', n ? days(n) : ''), danger: true,
                body: t('confirm_prune_notifications_msg').replace('{count}', countOf(t, locale, n?.prunable ?? 0, 'notices')).replace('{days}', n ? days(n) : ''),
            }
            case 'BACKUP': return { title: t('confirm_trigger_backup_title'), body: t('confirm_trigger_backup_msg'), label: t('trigger_backup_now') }
            case 'RESTORE_LATEST': return {
                title: t('confirm_restore_latest_title'), body: t('confirm_restore_latest_msg'), label: t('recover_latest_backup'), word: RESTORE_WORD, danger: true,
            }
            case 'RESTORE_SPECIFIC': {
                // The backup's name, as the file is named: left to right, never translated.
                const [before, after] = t('confirm_restore_specific_msg').split('{name}')
                return {
                    title: t('confirm_restore_specific_title'), label: t('health_restore_this'), word: RESTORE_WORD, danger: true,
                    body: <>{before}<bdi dir="ltr" translate="no">{p.backup.baseName}</bdi>{after}</>,
                }
            }
            case 'MAINTENANCE_ON': return { title: t('confirm_maintenance_on_title'), body: t('confirm_maintenance_on_msg'), label: t('settings_turn_on') }
            case 'MAINTENANCE_OFF': return { title: t('confirm_maintenance_off_title'), body: t('confirm_maintenance_off_msg'), label: t('settings_turn_off') }
        }
    }

    const loading = <div className="ui-panel" role="status"><EmptyState icon={HourglassIcon} title={t('loading')} /></div>
    const didntLoad = (title: TranslationKey, error: unknown, busy: boolean, retry: () => unknown) => (
        <div className="ui-panel">
            <EmptyState icon={WarningCircleIcon} title={t(title)} detail={(error as SWRError).info?.error}
                action={<Button busy={busy} onClick={() => { void retry() }}>{t('try_again')}</Button>} />
        </div>
    )

    // A count, and how many of them are old enough to delete.
    const counted = (c: Counted, total: TranslationKey, older: TranslationKey) => (
        <Details items={[
            { label: t(total), value: <span className="ui-num">{num(c.total)}</span> },
            { label: t(older).replace('{days}', days(c)), value: <span className="ui-num">{num(c.prunable)}</span> },
        ]} />
    )

    const housekeeping = metrics ? (
        <Columns>
            <Card title={t('storage_header')}>
                <p className="ui-card-note">{t('health_storage_note')}</p>
                {metrics.storage.reachable
                    ? <Details items={[{ label: t('health_files'), value: <span className="ui-num">{num(metrics.storage.totalFiles ?? 0)}</span> }]} />
                    : <p className="ui-error" role="status">{t('storage_unreachable')}</p>}
                {report
                    ? <OrphanReport report={report} busy={action.is('DELETE_ORPHANS') ?? false} onDelete={() => setPending({ action: 'DELETE_ORPHANS' })} onClose={() => setReport(null)} />
                    : (
                        <div className="ui-card-actions">
                            <Button onClick={() => { void findUnused() }} disabled={action.running || !metrics.storage.reachable} busy={action.is('scan')}>{t('cleanup_orphaned')}</Button>
                        </div>
                    )}
            </Card>
            <Card title={t('audit_logs')}>
                <p className="ui-card-note">{t('health_audit_note')}</p>
                {counted(metrics.auditing, 'health_entries', 'health_older_than')}
                <div className="ui-card-actions">
                    <Button variant="danger" onClick={() => setPending({ action: 'PRUNE_LOGS' })} disabled={action.running || metrics.auditing.prunable === 0}>
                        {t('health_prune_logs').replace('{days}', days(metrics.auditing))}
                    </Button>
                </div>
            </Card>
            <Card title={t('notifications')}>
                <p className="ui-card-note">{t('health_notifications_note')}</p>
                {counted(metrics.notifications, 'health_sent', 'health_read_older_than')}
                <div className="ui-card-actions">
                    <Button variant="danger" onClick={() => setPending({ action: 'PRUNE_NOTIFICATIONS' })} disabled={action.running || metrics.notifications.prunable === 0}>
                        {t('health_prune_notifications').replace('{days}', days(metrics.notifications))}
                    </Button>
                </div>
            </Card>
        </Columns>
    ) : healthError ? didntLoad('health_load_failed', healthError, healthLoading, reloadHealth) : loading

    const on = !!settings?.maintenanceMode
    const maintenance = settings ? (
        <Card>
            <p className="ui-card-note">{t('maintenance_mode_description')}</p>
            <Field label={t('health_maintenance_message')}
                hint={t('ui_characters_used').replace('{used}', num(shownMessage.length)).replace('{max}', num(MESSAGE_MAX))}>{p => (
                <TextArea {...p} name="maintenanceMessage" dir="auto" rows={2} maxLength={MESSAGE_MAX} placeholder={t('maintenance_message_placeholder')}
                    value={shownMessage} onChange={e => setMessage(e.target.value)} />
            )}</Field>
            <div className="ui-card-actions">
                <Button variant={on ? 'secondary' : 'primary'} onClick={() => setPending({ action: on ? 'MAINTENANCE_OFF' : 'MAINTENANCE_ON' })} disabled={action.running}>
                    {t(on ? 'disable_maintenance_mode' : 'enable_maintenance_mode')}
                </Button>
            </div>
        </Card>
    ) : settingsError ? didntLoad('health_settings_failed', settingsError, settingsLoading, reloadSettings) : loading

    const asked = pending && question(pending)

    return (
        <Page>
            <PageHeader title={t('system_health')} subtitle={t('system_health_subtitle')} />

            {/* Said above everything else while it's on: everyone else is held. */}
            {on && <Card tone="waiting" role="status"><p>{t('maintenance_active_banner')}</p></Card>}

            {/* First, because it says whether the machinery that keeps the rest is alive. */}
            <Section title={t('health_running')}>
                <Columns>
                    <JobsCard />
                    {/* Every company's attendance agents and terminals (ATTENDANCE_PLAN.md §13.2). */}
                    <TerminalsHealthCard />
                </Columns>
            </Section>

            <Section title={t('health_housekeeping')}>{housekeeping}</Section>

            <Section title={t('health_backups')}>
                <Columns>
                    <Card title={t('backups_header')}>
                        <p className="ui-card-note">{t('backups_description')}</p>
                        <div className="ui-card-actions">
                            <Button onClick={() => setPending({ action: 'BACKUP' })} disabled={action.running}>{t('trigger_backup_now')}</Button>
                        </div>
                    </Card>
                    <Card title={t('disaster_recovery_header')}>
                        <p className="ui-card-note">{t('disaster_recovery_description')}</p>
                        <div className="ui-card-actions">
                            <Button onClick={() => { void openPicker() }} disabled={action.running}>{t('choose_backup_to_restore')}</Button>
                            <Button variant="danger" onClick={() => setPending({ action: 'RESTORE_LATEST' })} disabled={action.running}>{t('recover_latest_backup')}</Button>
                        </div>
                    </Card>
                </Columns>
            </Section>

            {/* Named once, its state beside the name: the section's one card was titled the same. */}
            <Section title={t('maintenance_mode_header')}
                action={settings && <StatusBadge tone={on ? 'waiting' : 'neutral'}>{t(on ? 'health_maintenance_on' : 'health_maintenance_off')}</StatusBadge>}>
                {maintenance}
            </Section>

            {pending && asked && (
                <ConfirmHealthAction title={asked.title} body={asked.body} word={asked.word} danger={asked.danger} confirmLabel={asked.label}
                    busy={action.is(pending.action) ?? false} onConfirm={() => { void run(pending) }} onCancel={() => setPending(null)} />
            )}

            <BackupPickerModal
                isOpen={!!picker}
                backups={picker?.backups ?? []}
                loading={picker?.loading ?? false}
                error={picker?.error ?? null}
                reason={picker?.reason ?? null}
                onSelect={backup => {
                    setPicker(null)
                    setPending({ action: 'RESTORE_SPECIFIC', backup })
                }}
                onClose={() => setPicker(null)}
                onRetry={() => { void openPicker() }}
            />
        </Page>
    )
}

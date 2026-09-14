'use client'

import { useState, useEffect, useCallback } from 'react'
import { useLanguage } from '@/context/LanguageContext'
import LoadingSpinner from '@/components/LoadingSpinner'
import ConfirmModal from '@/components/ConfirmModal'
import BackupPickerModal, { BackupEntry } from '@/components/BackupPickerModal'
import { useHeader } from '@/context/HeaderContext'

type HealthMetrics = {
    auditing: {
        total: number
        prunable: number
        retentionDays: number
    }
    notifications: {
        total: number
        prunable: number
        retentionDays: number
    }
    storage: {
        totalFiles: number
    }
}

type PendingAction = 'CLEANUP_ASSETS' | 'DELETE_ORPHANS' | 'PRUNE_LOGS' | 'PRUNE_NOTIFICATIONS' | 'BACKUP' | 'RESTORE_LATEST' | 'RESTORE_SPECIFIC' | 'MAINTENANCE_ON' | 'MAINTENANCE_OFF' | null

const RESTORE_CONFIRM_WORD = 'RESTORE'
const DELETE_CONFIRM_WORD = 'DELETE'

function formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

export default function SystemHealthPage() {
    const { t, locale } = useLanguage()
    const { setTitle, setSubtitle } = useHeader()
    const [metrics, setMetrics] = useState<HealthMetrics | null>(null)
    const [loading, setLoading] = useState(true)
    const [processing, setProcessing] = useState<string | null>(null)
    const [triggeringBackup, setTriggeringBackup] = useState(false)
    const [pendingAction, setPendingAction] = useState<PendingAction>(null)
    // The orphan sweep is two steps: a report, then a confirmed delete. The
    // reference set behind it is a hand-kept list of queries, so the one thing
    // that must not happen is a mass delete nobody looked at first.
    const [orphanReport, setOrphanReport] = useState<
        { orphaned: number; total: number; bytes: number; orphans: string[] } | null
    >(null)
    const [deletingOrphans, setDeletingOrphans] = useState(false)
    const [restoring, setRestoring] = useState(false)
    const [pickerOpen, setPickerOpen] = useState(false)
    const [backups, setBackups] = useState<BackupEntry[]>([])
    const [backupsLoading, setBackupsLoading] = useState(false)
    const [backupsError, setBackupsError] = useState<string | null>(null)
    const [selectedBackup, setSelectedBackup] = useState<BackupEntry | null>(null)
    const [maintenanceMode, setMaintenanceMode] = useState(false)
    const [maintenanceMessage, setMaintenanceMessage] = useState('')
    const [savingMaintenance, setSavingMaintenance] = useState(false)

    useEffect(() => {
        setTitle(t('system_health'))
        setSubtitle(t('system_health_subtitle'))
        return () => {
            setTitle(null)
            setSubtitle(null)
        }
    }, [setTitle, setSubtitle, t])

    const fetchMetrics = useCallback(async () => {
        try {
            const res = await fetch('/api/admin/health')
            if (res.ok) {
                const result = await res.json()
                if (result.success) {
                    setMetrics(result.data)
                }
            }
        } catch (error) {
            console.error('Failed to fetch health metrics', error)
        } finally {
            setLoading(false)
        }
    }, [])

    const fetchSystemSettings = useCallback(async () => {
        try {
            const res = await fetch('/api/system-settings')
            const result = await res.json()
            if (result.success) {
                setMaintenanceMode(!!result.data.maintenanceMode)
                setMaintenanceMessage(result.data.maintenanceMessage || '')
            }
        } catch (error) {
            console.error('Failed to fetch system settings', error)
        }
    }, [])

    useEffect(() => {
        fetchMetrics()
        fetchSystemSettings()
    }, [fetchMetrics, fetchSystemSettings])

    const runMaintenance = async (action: string, params?: Record<string, unknown>) => {
        setProcessing(action)
        try {
            const res = await fetch('/api/admin/maintenance', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(params ? { action, params } : { action })
            })

            const result = await res.json()
            if (result.success) {
                alert(t('maintenance_success' as any))
                fetchMetrics()
            } else {
                alert(t('maintenance_failed' as any) + ': ' + result.error)
            }
        } catch (error) {
            console.error('Maintenance error:', error)
            alert(t('maintenance_failed' as any))
        } finally {
            setProcessing(null)
        }
    }

    /** Step one: ask what a sweep would delete, and show it. Deletes nothing. */
    const previewOrphans = async () => {
        setProcessing('CLEANUP_ASSETS')
        try {
            const res = await fetch('/api/admin/maintenance', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'CLEANUP_ASSETS', params: { dryRun: true } })
            })
            const result = await res.json()
            if (!result.success) {
                alert(t('maintenance_failed' as any) + ': ' + result.error)
                return
            }
            setOrphanReport(result.data.result)
        } catch (error) {
            console.error('Maintenance error:', error)
            alert(t('maintenance_failed' as any))
        } finally {
            setProcessing(null)
        }
    }

    /** Step two, and only from the report: delete what it listed. */
    const deleteOrphans = async () => {
        setDeletingOrphans(true)
        try {
            const res = await fetch('/api/admin/maintenance', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                // confirm authorises going past the plausibility threshold —
                // which a real backlog will always exceed, and which only
                // somebody who has read the list above can judge.
                body: JSON.stringify({ action: 'CLEANUP_ASSETS', params: { dryRun: false, confirm: true } })
            })
            const result = await res.json()
            if (result.success) {
                alert(`${t('maintenance_success' as any)} (${result.data.result.deleted})`)
                setOrphanReport(null)
                fetchMetrics()
            } else {
                alert(t('maintenance_failed' as any) + ': ' + result.error)
            }
        } catch (error) {
            console.error('Maintenance error:', error)
            alert(t('maintenance_failed' as any))
        } finally {
            setDeletingOrphans(false)
        }
    }

    const triggerBackup = async () => {
        setTriggeringBackup(true)
        try {
            const res = await fetch('/api/admin/maintenance/backup', { method: 'POST' })
            const result = await res.json()
            if (result.success) {
                alert(t('backup_triggered_success' as any))
            } else {
                alert(t('backup_trigger_failed' as any) + ': ' + result.error)
            }
        } catch (error) {
            console.error('Backup trigger error:', error)
            alert(t('backup_trigger_failed' as any))
        } finally {
            setTriggeringBackup(false)
        }
    }

    const openBackupPicker = async () => {
        setPickerOpen(true)
        setBackupsLoading(true)
        setBackupsError(null)
        try {
            const res = await fetch('/api/admin/maintenance/backups')
            const result = await res.json()
            if (result.success) {
                setBackups(result.data.backups)
            } else {
                setBackupsError(result.error || t('backup_picker_error' as any))
            }
        } catch (error) {
            console.error('Failed to list backups', error)
            setBackupsError(t('backup_picker_error' as any))
        } finally {
            setBackupsLoading(false)
        }
    }

    const handleSelectBackup = (backup: BackupEntry) => {
        setSelectedBackup(backup)
        setPickerOpen(false)
        setPendingAction('RESTORE_SPECIFIC')
    }

    const runRestore = async (mode: 'latest' | 'specific') => {
        setRestoring(true)
        try {
            const payload = mode === 'specific' && selectedBackup
                ? { mode, folder: selectedBackup.folder, baseName: selectedBackup.baseName }
                : { mode: 'latest' }
            const res = await fetch('/api/admin/maintenance/restore', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            })
            const result = await res.json()
            if (result.success) {
                alert(t('restore_started_success' as any))
            } else {
                alert(t('restore_trigger_failed' as any) + ': ' + result.error)
            }
        } catch (error) {
            console.error('Restore trigger error:', error)
            alert(t('restore_trigger_failed' as any))
        } finally {
            setRestoring(false)
            setSelectedBackup(null)
        }
    }

    const toggleMaintenance = async (next: boolean) => {
        setSavingMaintenance(true)
        try {
            const res = await fetch('/api/system-settings', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ maintenanceMode: next, maintenanceMessage: maintenanceMessage.trim() || null })
            })
            const result = await res.json()
            if (result.success) {
                setMaintenanceMode(!!result.data.maintenanceMode)
                setMaintenanceMessage(result.data.maintenanceMessage || '')
            } else {
                alert(t('maintenance_toggle_failed' as any) + ': ' + result.error)
            }
        } catch (error) {
            console.error('Maintenance toggle error:', error)
            alert(t('maintenance_toggle_failed' as any))
        } finally {
            setSavingMaintenance(false)
        }
    }

    // Confirmation for all six actions runs through one styled modal instead
    // of the browser's native confirm() — the copy per action lives here,
    // keyed off which button was clicked.
    const confirmCopy: Record<Exclude<PendingAction, null>, { title: string; message: string }> = {
        CLEANUP_ASSETS: { title: t('confirm_cleanup_assets_title' as any), message: t('confirm_cleanup_assets_msg' as any) },
        DELETE_ORPHANS: {
            title: t('confirm_delete_orphans_title' as any),
            message: `${t('confirm_delete_orphans_msg' as any)} (${orphanReport?.orphaned ?? 0} · ${formatBytes(orphanReport?.bytes ?? 0)})`
        },
        PRUNE_LOGS: { title: t('confirm_prune_logs_title' as any), message: t('confirm_prune_logs_msg' as any) },
        PRUNE_NOTIFICATIONS: { title: t('confirm_prune_notifications_title' as any), message: t('confirm_prune_notifications_msg' as any) },
        BACKUP: { title: t('confirm_trigger_backup_title' as any), message: t('confirm_trigger_backup_msg' as any) },
        RESTORE_LATEST: { title: t('confirm_restore_latest_title' as any), message: t('confirm_restore_latest_msg' as any) },
        RESTORE_SPECIFIC: {
            title: t('confirm_restore_specific_title' as any),
            message: `${t('confirm_restore_specific_msg' as any)} ${selectedBackup?.baseName || ''}`
        },
        MAINTENANCE_ON: { title: t('confirm_maintenance_on_title' as any), message: t('confirm_maintenance_on_msg' as any) },
        MAINTENANCE_OFF: { title: t('confirm_maintenance_off_title' as any), message: t('confirm_maintenance_off_msg' as any) },
    }

    const handleConfirm = () => {
        const action = pendingAction
        setPendingAction(null)
        if (!action) return
        if (action === 'BACKUP') {
            triggerBackup()
        } else if (action === 'RESTORE_LATEST') {
            runRestore('latest')
        } else if (action === 'RESTORE_SPECIFIC') {
            runRestore('specific')
        } else if (action === 'MAINTENANCE_ON') {
            toggleMaintenance(true)
        } else if (action === 'MAINTENANCE_OFF') {
            toggleMaintenance(false)
        } else if (action === 'CLEANUP_ASSETS') {
            previewOrphans()
        } else if (action === 'DELETE_ORPHANS') {
            deleteOrphans()
        } else {
            runMaintenance(action)
        }
    }

    if (loading) {
        return (
            <div style={{ display: 'flex', justifyContent: 'center', padding: '4rem' }}>
                <LoadingSpinner message={t('loading_data')} />
            </div>
        )
    }

    return (
        <div className="animate-fade-in" style={{ direction: locale === 'ar' ? 'rtl' : 'ltr', padding: '0.5rem' }}>

            {maintenanceMode && (
                <div style={{
                    display: 'flex', alignItems: 'center', gap: '0.75rem',
                    background: 'var(--warn-bg-yellow-subtle)', border: '1px solid var(--warn-border-yellow)', color: 'var(--warn-fg)',
                    borderRadius: '0.75rem', padding: '0.85rem 1.25rem', marginBottom: '1.5rem',
                    fontWeight: 700, fontSize: '0.9rem'
                }}>
                    <span style={{ fontSize: '1.3rem' }}>🔧</span>
                    {t('maintenance_active_banner' as any)}
                </div>
            )}

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '1.5rem', marginBottom: '2rem' }}>

                {/* Storage Card */}
                <div className="glass-card" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                        <span style={{ fontSize: '2rem' }}>📁</span>
                        <div>
                            <h3 style={{ margin: 0, fontSize: '1.1rem', color: 'var(--text-main)' }}>{t('storage_header' as any)}</h3>
                            <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--text-muted)' }}>{t('total_assets' as any)}</p>
                        </div>
                    </div>
                    <div style={{ fontSize: '2.5rem', fontWeight: '800', color: 'var(--brand-primary)', textAlign: 'center', margin: '1rem 0' }}>
                        {metrics?.storage.totalFiles}
                    </div>
                    <button
                        onClick={() => setPendingAction('CLEANUP_ASSETS')}
                        disabled={!!processing}
                        className="btn"
                        style={{ width: '100%', marginTop: 'auto' }}
                    >
                        {processing === 'CLEANUP_ASSETS' ? (locale === 'ar' ? 'جاري الفحص...' : 'Scanning...') : t('cleanup_orphaned' as any)}
                    </button>

                    {/* The report. Shown in place rather than in the confirm
                        dialog because the point is that somebody reads the
                        paths before agreeing to delete them, and a dialog is
                        the wrong shape for a scrollable list. */}
                    {orphanReport && (
                        <div style={{
                            border: '1px solid var(--border)', borderRadius: '0.75rem',
                            padding: '0.85rem', background: 'var(--surface-sunk, var(--surface))',
                            textAlign: locale === 'ar' ? 'right' : 'left'
                        }}>
                            <div style={{ fontWeight: 600, fontSize: '0.9rem', marginBottom: '0.2rem' }}>
                                {t('orphan_report_title' as any)}
                            </div>
                            <div style={{ fontSize: '0.82rem', color: 'var(--text-soft)', marginBottom: '0.6rem' }}>
                                {orphanReport.orphaned} / {orphanReport.total} · {formatBytes(orphanReport.bytes)}
                            </div>

                            {orphanReport.orphaned === 0 ? (
                                <div style={{ fontSize: '0.85rem', color: 'var(--text-soft)' }}>
                                    {t('orphan_report_none' as any)}
                                </div>
                            ) : (
                                <>
                                    <div style={{
                                        maxHeight: '9rem', overflowY: 'auto', fontFamily: 'monospace',
                                        fontSize: '0.72rem', lineHeight: 1.6, color: 'var(--text-soft)',
                                        direction: 'ltr', textAlign: 'left', wordBreak: 'break-all'
                                    }}>
                                        {orphanReport.orphans.map(path => <div key={path}>{path}</div>)}
                                    </div>
                                    <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.75rem' }}>
                                        <button className="btn" style={{ flex: 1 }}
                                            onClick={() => setOrphanReport(null)} disabled={deletingOrphans}>
                                            {t('cancel')}
                                        </button>
                                        <button className="btn" style={{ flex: 1, background: 'var(--danger-solid)', color: 'var(--text-on-accent)' }}
                                            onClick={() => setPendingAction('DELETE_ORPHANS')} disabled={deletingOrphans}>
                                            {deletingOrphans ? t('saving') : t('orphan_report_delete' as any)}
                                        </button>
                                    </div>
                                </>
                            )}
                        </div>
                    )}
                </div>

                {/* Auditing Card */}
                <div className="glass-card" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                        <span style={{ fontSize: '2rem' }}>📜</span>
                        <div>
                            <h3 style={{ margin: 0, fontSize: '1.1rem', color: 'var(--text-main)' }}>{t('auditing_header' as any)}</h3>
                            <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--text-muted)' }}>{t('audit_logs')}</p>
                        </div>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-around', margin: '1rem 0' }}>
                        <div style={{ textAlign: 'center' }}>
                            <div style={{ fontSize: '1.5rem', fontWeight: '800', color: 'var(--text-main)' }}>{metrics?.auditing.total}</div>
                            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>{t('total_label' as any)}</div>
                        </div>
                        <div style={{ textAlign: 'center' }}>
                            <div style={{ fontSize: '1.5rem', fontWeight: '800', color: 'var(--danger-solid)' }}>{metrics?.auditing.prunable}</div>
                            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>{t('prunable_logs' as any)}</div>
                        </div>
                    </div>
                    <button
                        onClick={() => setPendingAction('PRUNE_LOGS')}
                        disabled={!!processing || metrics?.auditing.prunable === 0}
                        className="btn"
                        style={{ width: '100%', marginTop: 'auto', background: metrics?.auditing.prunable === 0 ? 'var(--surface-sunk)' : undefined, color: metrics?.auditing.prunable === 0 ? 'var(--text-faint)' : undefined }}
                    >
                        {processing === 'PRUNE_LOGS' ? (locale === 'ar' ? 'جاري الحذف...' : 'Pruning...') : t('prune_logs_btn' as any)}
                    </button>
                </div>

                {/* Notifications Card */}
                <div className="glass-card" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                        <span style={{ fontSize: '2rem' }}>🔔</span>
                        <div>
                            <h3 style={{ margin: 0, fontSize: '1.1rem', color: 'var(--text-main)' }}>{t('notifications')}</h3>
                            <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--text-muted)' }}>{t('system_activity' as any)}</p>
                        </div>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-around', margin: '1rem 0' }}>
                        <div style={{ textAlign: 'center' }}>
                            <div style={{ fontSize: '1.5rem', fontWeight: '800', color: 'var(--text-main)' }}>{metrics?.notifications.total}</div>
                            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>{t('total_label' as any)}</div>
                        </div>
                        <div style={{ textAlign: 'center' }}>
                            <div style={{ fontSize: '1.5rem', fontWeight: '800', color: 'var(--warn-solid)' }}>{metrics?.notifications.prunable}</div>
                            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>{t('prunable_notifications' as any)}</div>
                        </div>
                    </div>
                    <button
                        onClick={() => setPendingAction('PRUNE_NOTIFICATIONS')}
                        disabled={!!processing || metrics?.notifications.prunable === 0}
                        className="btn"
                        style={{ width: '100%', marginTop: 'auto', background: metrics?.notifications.prunable === 0 ? 'var(--surface-sunk)' : undefined, color: metrics?.notifications.prunable === 0 ? 'var(--text-faint)' : undefined }}
                    >
                        {processing === 'PRUNE_NOTIFICATIONS' ? (locale === 'ar' ? 'جاري الحذف...' : 'Pruning...') : t('prune_notifications_btn' as any)}
                    </button>
                </div>

                {/* Backups Card */}
                <div className="glass-card" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                        <span style={{ fontSize: '2rem' }}>💾</span>
                        <div>
                            <h3 style={{ margin: 0, fontSize: '1.1rem', color: 'var(--text-main)' }}>{t('backups_header' as any)}</h3>
                            <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--text-muted)' }}>{t('backups_subtitle' as any)}</p>
                        </div>
                    </div>
                    <p style={{ margin: '0.5rem 0', fontSize: '0.85rem', color: 'var(--text-muted)', flexGrow: 1 }}>
                        {t('backups_description' as any)}
                    </p>
                    <button
                        onClick={() => setPendingAction('BACKUP')}
                        disabled={triggeringBackup}
                        className="btn"
                        style={{ width: '100%', marginTop: 'auto' }}
                    >
                        {triggeringBackup ? t('triggering_backup' as any) : t('trigger_backup_now' as any)}
                    </button>
                </div>

                {/* Disaster Recovery Card */}
                <div className="glass-card" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                        <span style={{ fontSize: '2rem' }}>🧯</span>
                        <div>
                            <h3 style={{ margin: 0, fontSize: '1.1rem', color: 'var(--text-main)' }}>{t('disaster_recovery_header' as any)}</h3>
                            <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--text-muted)' }}>{t('disaster_recovery_subtitle' as any)}</p>
                        </div>
                    </div>
                    <p style={{ margin: '0.5rem 0', fontSize: '0.85rem', color: 'var(--text-muted)', flexGrow: 1 }}>
                        {t('disaster_recovery_description' as any)}
                    </p>
                    <button
                        onClick={() => setPendingAction('RESTORE_LATEST')}
                        disabled={restoring}
                        className="btn"
                        style={{ width: '100%', background: 'var(--danger-bg)', color: 'var(--danger-fg)', border: '1px solid var(--danger-border)' }}
                    >
                        {restoring ? t('restoring' as any) : t('recover_latest_backup' as any)}
                    </button>
                    <button
                        onClick={openBackupPicker}
                        disabled={restoring}
                        className="btn"
                        style={{ width: '100%' }}
                    >
                        {t('choose_backup_to_restore' as any)}
                    </button>
                </div>

                {/* Maintenance Mode Card */}
                <div className="glass-card" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                        <span style={{ fontSize: '2rem' }}>🔧</span>
                        <div>
                            <h3 style={{ margin: 0, fontSize: '1.1rem', color: 'var(--text-main)' }}>{t('maintenance_mode_header' as any)}</h3>
                            <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                                {maintenanceMode ? t('maintenance_status_on' as any) : t('maintenance_status_off' as any)}
                            </p>
                        </div>
                    </div>
                    <p style={{ margin: '0.5rem 0', fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                        {t('maintenance_mode_description' as any)}
                    </p>
                    <textarea
                        value={maintenanceMessage}
                        onChange={(e) => setMaintenanceMessage(e.target.value)}
                        placeholder={t('maintenance_message_placeholder' as any)}
                        maxLength={500}
                        rows={2}
                        style={{
                            width: '100%', resize: 'vertical', padding: '0.6rem 0.75rem',
                            border: '1px solid var(--border)', borderRadius: '0.5rem', fontSize: '0.85rem',
                            fontFamily: 'inherit'
                        }}
                    />
                    <button
                        onClick={() => setPendingAction(maintenanceMode ? 'MAINTENANCE_OFF' : 'MAINTENANCE_ON')}
                        disabled={savingMaintenance}
                        className="btn"
                        style={{
                            width: '100%', marginTop: 'auto',
                            background: maintenanceMode ? 'var(--ok-bg)' : 'var(--danger-bg)',
                            color: maintenanceMode ? 'var(--ok-fg)' : 'var(--danger-fg)',
                            border: `1px solid ${maintenanceMode ? 'var(--ok-bg-strong)' : 'var(--danger-border)'}`
                        }}
                    >
                        {savingMaintenance
                            ? t('maintenance_saving' as any)
                            : maintenanceMode ? t('disable_maintenance_mode' as any) : t('enable_maintenance_mode' as any)}
                    </button>
                </div>

            </div>

            <ConfirmModal
                isOpen={!!pendingAction}
                title={pendingAction ? confirmCopy[pendingAction].title : ''}
                message={pendingAction ? confirmCopy[pendingAction].message : ''}
                variant={pendingAction === 'BACKUP' ? 'info' : (pendingAction === 'RESTORE_LATEST' || pendingAction === 'RESTORE_SPECIFIC' || pendingAction === 'DELETE_ORPHANS') ? 'danger' : 'warning'}
                requireTypedText={
                    (pendingAction === 'RESTORE_LATEST' || pendingAction === 'RESTORE_SPECIFIC')
                        ? RESTORE_CONFIRM_WORD
                        : pendingAction === 'DELETE_ORPHANS' ? DELETE_CONFIRM_WORD : undefined
                }
                onConfirm={handleConfirm}
                onCancel={() => { setPendingAction(null); setSelectedBackup(null) }}
            />

            <BackupPickerModal
                isOpen={pickerOpen}
                backups={backups}
                loading={backupsLoading}
                error={backupsError}
                onSelect={handleSelectBackup}
                onClose={() => setPickerOpen(false)}
            />
        </div>
    )
}

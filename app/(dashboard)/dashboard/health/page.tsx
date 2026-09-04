'use client'

import { useState, useEffect, useCallback } from 'react'
import { useLanguage } from '@/context/LanguageContext'
import LoadingSpinner from '@/components/LoadingSpinner'
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

export default function SystemHealthPage() {
    const { t, locale } = useLanguage()
    const { setTitle, setSubtitle } = useHeader()
    const [metrics, setMetrics] = useState<HealthMetrics | null>(null)
    const [loading, setLoading] = useState(true)
    const [processing, setProcessing] = useState<string | null>(null)
    const [triggeringBackup, setTriggeringBackup] = useState(false)

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

    useEffect(() => {
        fetchMetrics()
    }, [fetchMetrics])

    const runMaintenance = async (action: string) => {
        if (!confirm(t('confirm' as any))) return

        setProcessing(action)
        try {
            const res = await fetch('/api/admin/maintenance', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action })
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

    const triggerBackup = async () => {
        if (!confirm(t('confirm' as any))) return

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

    if (loading) {
        return (
            <div style={{ display: 'flex', justifyContent: 'center', padding: '4rem' }}>
                <LoadingSpinner message={t('loading_data')} />
            </div>
        )
    }

    return (
        <div className="animate-fade-in" style={{ direction: locale === 'ar' ? 'rtl' : 'ltr', padding: '0.5rem' }}>
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
                    <div style={{ fontSize: '2.5rem', fontWeight: '800', color: 'var(--accent-primary)', textAlign: 'center', margin: '1rem 0' }}>
                        {metrics?.storage.totalFiles}
                    </div>
                    <button
                        onClick={() => runMaintenance('CLEANUP_ASSETS')}
                        disabled={!!processing}
                        className="btn"
                        style={{ width: '100%', marginTop: 'auto' }}
                    >
                        {processing === 'CLEANUP_ASSETS' ? (locale === 'ar' ? 'جاري التنظيف...' : 'Cleaning...') : t('cleanup_orphaned' as any)}
                    </button>
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
                            <div style={{ fontSize: '1.5rem', fontWeight: '800', color: '#ef4444' }}>{metrics?.auditing.prunable}</div>
                            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>{t('prunable_logs' as any)}</div>
                        </div>
                    </div>
                    <button
                        onClick={() => runMaintenance('PRUNE_LOGS')}
                        disabled={!!processing || metrics?.auditing.prunable === 0}
                        className="btn"
                        style={{ width: '100%', marginTop: 'auto', background: metrics?.auditing.prunable === 0 ? '#f1f5f9' : undefined, color: metrics?.auditing.prunable === 0 ? '#94a3b8' : undefined }}
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
                            <div style={{ fontSize: '1.5rem', fontWeight: '800', color: '#f59e0b' }}>{metrics?.notifications.prunable}</div>
                            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>{t('prunable_notifications' as any)}</div>
                        </div>
                    </div>
                    <button
                        onClick={() => runMaintenance('PRUNE_NOTIFICATIONS')}
                        disabled={!!processing || metrics?.notifications.prunable === 0}
                        className="btn"
                        style={{ width: '100%', marginTop: 'auto', background: metrics?.notifications.prunable === 0 ? '#f1f5f9' : undefined, color: metrics?.notifications.prunable === 0 ? '#94a3b8' : undefined }}
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
                        onClick={triggerBackup}
                        disabled={triggeringBackup}
                        className="btn"
                        style={{ width: '100%', marginTop: 'auto' }}
                    >
                        {triggeringBackup ? t('triggering_backup' as any) : t('trigger_backup_now' as any)}
                    </button>
                </div>

            </div>
        </div>
    )
}

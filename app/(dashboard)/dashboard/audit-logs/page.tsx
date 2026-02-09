'use client'

import { useState, useEffect, useCallback } from 'react'
import Pagination from '@/components/Pagination'
import { useLanguage } from '@/context/LanguageContext'
import LoadingSpinner from '@/components/LoadingSpinner'

type AuditLog = {
    id: string
    action: string
    entityType: string
    entityId: string
    userId: string | null
    superAdminId: string | null
    details: string | null
    createdAt: string
    user?: {
        firstName: string
        lastName: string
        email: string
        role: string
    }
    superAdmin?: {
        firstName: string
        lastName: string
        email: string
    }
}

export default function AuditLogsPage() {
    const { t, locale } = useLanguage()
    const [logs, setLogs] = useState<AuditLog[]>([])
    const [loading, setLoading] = useState(true)
    const [page, setPage] = useState(1)
    const [totalPages, setTotalPages] = useState(0)
    const [filters, setFilters] = useState({ entityType: '', action: '' })
    const limit = 20

    const fetchLogs = useCallback(async () => {
        setLoading(true)
        try {
            const queryParams = new URLSearchParams()
            queryParams.set('page', page.toString())
            queryParams.set('limit', limit.toString())
            if (filters.entityType) queryParams.set('entityType', filters.entityType)
            if (filters.action) queryParams.set('action', filters.action)

            const res = await fetch(`/api/admin/audit-logs?${queryParams.toString()}`)
            if (res.ok) {
                const result = await res.json()
                setLogs(result.data.data || [])
                setTotalPages(result.data.totalPages || 0)
            }
        } catch (error) {
            console.error('Failed to fetch audit logs', error)
        } finally {
            setLoading(false)
        }
    }, [page, filters])

    useEffect(() => {
        fetchLogs()
    }, [fetchLogs])

    const formatDate = (dateString: string) => {
        const date = new Date(dateString)
        return new Intl.DateTimeFormat(locale === 'ar' ? 'ar-EG' : 'en-US', {
            dateStyle: 'medium',
            timeStyle: 'short'
        }).format(date)
    }

    const renderDetails = (details: string | null) => {
        if (!details) return '-'
        try {
            const parsed = JSON.parse(details)
            return (
                <div style={{ fontSize: '0.8rem', color: '#64748b', maxWidth: '300px', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {Object.entries(parsed).map(([key, value]) => (
                        <div key={key}>
                            <span style={{ fontWeight: '600' }}>{key}:</span> {String(value)}
                        </div>
                    ))}
                </div>
            )
        } catch {
            return details
        }
    }

    const getPerformerName = (log: AuditLog) => {
        if (log.superAdmin) {
            return `${log.superAdmin.firstName} ${log.superAdmin.lastName} (Super Admin)`
        }
        if (log.user) {
            return `${log.user.firstName} ${log.user.lastName} (${log.user.role})`
        }
        return 'System'
    }

    return (
        <div style={{ direction: locale === 'ar' ? 'rtl' : 'ltr', padding: '1.5rem' }}>
            <div style={{ marginBottom: '2rem' }}>
                <h1 style={{ fontSize: '1.8rem', fontWeight: 'bold', color: '#0f172a' }}>{t('audit_logs')}</h1>
                <p style={{ color: '#64748b' }}>{t('audit_logs_subtitle')}</p>
            </div>

            {/* Simple Filters */}
            <div style={{ display: 'flex', gap: '1rem', marginBottom: '2rem', flexWrap: 'wrap' }}>
                <input
                    type="text"
                    placeholder={locale === 'ar' ? 'تصفية حسب الكيان...' : 'Filter by Entity...'}
                    value={filters.entityType}
                    onChange={(e) => setFilters(f => ({ ...f, entityType: e.target.value }))}
                    style={{ padding: '0.5rem 1rem', borderRadius: '8px', border: '1px solid #e2e8f0', minWidth: '200px' }}
                />
                <input
                    type="text"
                    placeholder={locale === 'ar' ? 'تصفية حسب الإجراء...' : 'Filter by Action...'}
                    value={filters.action}
                    onChange={(e) => setFilters(f => ({ ...f, action: e.target.value }))}
                    style={{ padding: '0.5rem 1rem', borderRadius: '8px', border: '1px solid #e2e8f0', minWidth: '200px' }}
                />
                <button
                    onClick={() => { setFilters({ entityType: '', action: '' }); setPage(1); }}
                    className="btn"
                    style={{ background: '#f1f5f9', color: '#475569' }}
                >
                    {t('reset_filters' as any) || 'Reset'}
                </button>
            </div>

            {loading ? (
                <LoadingSpinner message={t('loading_data')} />
            ) : (
                <>
                    <div style={{ background: 'white', borderRadius: '12px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)', overflowX: 'auto' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '800px' }}>
                            <thead style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
                                <tr>
                                    <th style={{ textAlign: locale === 'ar' ? 'right' : 'left', padding: '1rem', color: '#64748b', fontSize: '0.875rem' }}>{t('timestamp')}</th>
                                    <th style={{ textAlign: locale === 'ar' ? 'right' : 'left', padding: '1rem', color: '#64748b', fontSize: '0.875rem' }}>{t('action')}</th>
                                    <th style={{ textAlign: locale === 'ar' ? 'right' : 'left', padding: '1rem', color: '#64748b', fontSize: '0.875rem' }}>{t('entity')}</th>
                                    <th style={{ textAlign: locale === 'ar' ? 'right' : 'left', padding: '1rem', color: '#64748b', fontSize: '0.875rem' }}>{t('performed_by')}</th>
                                    <th style={{ textAlign: locale === 'ar' ? 'right' : 'left', padding: '1rem', color: '#64748b', fontSize: '0.875rem' }}>{t('details')}</th>
                                </tr>
                            </thead>
                            <tbody>
                                {logs.map((log) => (
                                    <tr key={log.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                                        <td style={{ padding: '1rem', fontSize: '0.875rem', color: '#475569' }}>
                                            {formatDate(log.createdAt)}
                                        </td>
                                        <td style={{ padding: '1rem' }}>
                                            <span style={{
                                                fontSize: '0.75rem',
                                                fontWeight: '600',
                                                padding: '0.2rem 0.5rem',
                                                borderRadius: '4px',
                                                background: '#f1f5f9',
                                                color: '#475569'
                                            }}>
                                                {log.action}
                                            </span>
                                        </td>
                                        <td style={{ padding: '1rem', fontSize: '0.875rem', color: '#475569' }}>
                                            {log.entityType} ({log.entityId.slice(0, 8)}...)
                                        </td>
                                        <td style={{ padding: '1rem', fontSize: '0.875rem', color: '#475569' }}>
                                            {getPerformerName(log)}
                                        </td>
                                        <td style={{ padding: '1rem' }}>
                                            {renderDetails(log.details)}
                                        </td>
                                    </tr>
                                ))}
                                {logs.length === 0 && (
                                    <tr>
                                        <td colSpan={5} style={{ padding: '3rem', textAlign: 'center', color: '#94a3b8' }}>
                                            {t('no_audit_logs_found')}
                                        </td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>

                    <Pagination
                        currentPage={page}
                        totalPages={totalPages}
                        onPageChange={setPage}
                    />
                </>
            )}
        </div>
    )
}

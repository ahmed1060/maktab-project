'use client'

import { useState, useEffect, useCallback } from 'react'
import Pagination from '@/components/Pagination'
import { useLanguage } from '@/context/LanguageContext'
import LoadingSpinner from '@/components/LoadingSpinner'
import { useHeader } from '@/context/HeaderContext'

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
    const { setTitle, setSubtitle } = useHeader()
    const [logs, setLogs] = useState<AuditLog[]>([])
    const [loading, setLoading] = useState(true)
    const [page, setPage] = useState(1)
    const [totalPages, setTotalPages] = useState(0)
    const [filters, setFilters] = useState({ entityType: '', action: '' })
    const limit = 20

    useEffect(() => {
        setTitle(t('audit_logs'))
        setSubtitle(t('audit_logs_subtitle'))
        return () => {
            setTitle(null)
            setSubtitle(null)
        }
    }, [setTitle, setSubtitle, t])

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
                // Assuming result.data follows { data: AuditLog[], totalPages: number }
                setLogs(result.data?.data || [])
                setTotalPages(result.data?.totalPages || 0)
            }
        } catch (error) {
            console.error('Failed to fetch audit logs', error)
        } finally {
            setLoading(false)
        }
    }, [page, filters, limit])

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
                <div style={{ fontSize: '0.75rem', color: '#64748b' }}>
                    <pre style={{ margin: 0, whiteSpace: 'pre-wrap', fontFamily: 'monospace', maxHeight: '100px', overflowY: 'auto' }}>
                        {JSON.stringify(parsed, null, 2)}
                    </pre>
                </div>
            )
        } catch (e) {
            return <span style={{ fontSize: '0.75rem', color: '#94a3b8' }}>{String(details)}</span>
        }
    }

    return (
        <div className="animate-fade-in" style={{ direction: locale === 'ar' ? 'rtl' : 'ltr', padding: '0.5rem', minHeight: '100vh' }}>
            {/* Filters Section */}
            <section className="glass-card" style={{ marginBottom: '2rem', display: 'flex', gap: '1rem', flexWrap: 'wrap', alignItems: 'center' }}>
                <div style={{ flex: 1, minWidth: '200px' }}>
                    <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: '700', textTransform: 'uppercase', color: '#64748b', marginBottom: '0.5rem', marginInlineStart: '0.5rem' }}>
                        {locale === 'ar' ? 'الكيان' : 'Entity Type'}
                    </label>
                    <input
                        type="text"
                        className="input"
                        placeholder={locale === 'ar' ? 'تصفية حسب الكيان...' : 'Filter by Entity...'}
                        value={filters.entityType}
                        onChange={(e) => setFilters(f => ({ ...f, entityType: e.target.value }))}
                    />
                </div>
                <div style={{ flex: 1, minWidth: '200px' }}>
                    <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: '700', textTransform: 'uppercase', color: '#64748b', marginBottom: '0.5rem', marginInlineStart: '0.5rem' }}>
                        {locale === 'ar' ? 'الإجراء' : 'Action'}
                    </label>
                    <input
                        type="text"
                        className="input"
                        placeholder={locale === 'ar' ? 'تصفية حسب الإجراء...' : 'Filter by Action...'}
                        value={filters.action}
                        onChange={(e) => setFilters(f => ({ ...f, action: e.target.value }))}
                    />
                </div>
                <div style={{ alignSelf: 'flex-end', paddingTop: '1.5rem' }}>
                    <button
                        onClick={() => { setFilters({ entityType: '', action: '' }); setPage(1); }}
                        className="btn"
                        style={{ background: 'rgba(255,255,255,0.4)', color: '#475569', border: '1px solid rgba(255,255,255,0.5)' }}
                    >
                        {t('reset_filters' as any) || 'Reset'}
                    </button>
                </div>
            </section>

            {loading ? (
                <div style={{ display: 'flex', justifyContent: 'center', padding: '4rem' }}>
                    <LoadingSpinner message={t('loading_data')} />
                </div>
            ) : (
                <>
                    <section className="glass-card" style={{ padding: 0, overflow: 'hidden' }}>
                        <div style={{ overflowX: 'auto' }}>
                            <table style={{ width: '100%', borderCollapse: 'separate', borderSpacing: 0 }}>
                                <thead>
                                    <tr style={{ background: 'rgba(241, 245, 249, 0.4)' }}>
                                        <th style={{ textAlign: locale === 'ar' ? 'right' : 'left', padding: '1.25rem 1.5rem', color: '#475569', fontSize: '0.75rem', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{t('timestamp')}</th>
                                        <th style={{ textAlign: locale === 'ar' ? 'right' : 'left', padding: '1.25rem 1.5rem', color: '#475569', fontSize: '0.75rem', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{t('action')}</th>
                                        <th style={{ textAlign: locale === 'ar' ? 'right' : 'left', padding: '1.25rem 1.5rem', color: '#475569', fontSize: '0.75rem', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{t('entity')}</th>
                                        <th style={{ textAlign: locale === 'ar' ? 'right' : 'left', padding: '1.25rem 1.5rem', color: '#475569', fontSize: '0.75rem', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{t('performed_by')}</th>
                                        <th style={{ textAlign: locale === 'ar' ? 'right' : 'left', padding: '1.25rem 1.5rem', color: '#475569', fontSize: '0.75rem', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{t('details')}</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {logs.map((log) => {
                                        const isDelete = log.action.includes('DELETE')
                                        const isCreate = log.action.includes('CREATE')
                                        const isUpdate = log.action.includes('UPDATE')
                                        const isAuth = log.action.includes('LOGIN') || log.action.includes('LOGOUT')

                                        return (
                                            <tr key={log.id} className="hover:bg-white/30 transition-colors" style={{ borderBottom: '1px solid rgba(226, 232, 240, 0.4)' }}>
                                                <td style={{ padding: '1.25rem 1.5rem', fontSize: '0.875rem', color: '#1e293b', fontWeight: '500' }}>
                                                    {formatDate(log.createdAt)}
                                                </td>
                                                <td style={{ padding: '1.25rem 1.5rem' }}>
                                                    <span className="badge" style={{
                                                        fontSize: '0.65rem',
                                                        fontWeight: '800',
                                                        background: isDelete ? '#fee2e2' : isCreate ? '#dcfce7' : isUpdate ? '#e0e7ff' : isAuth ? '#fef3c7' : '#f1f5f9',
                                                        color: isDelete ? '#991b1b' : isCreate ? '#166534' : isUpdate ? '#3730a3' : isAuth ? '#92400e' : '#475569',
                                                        border: 'none',
                                                        padding: '0.25rem 0.6rem'
                                                    }}>
                                                        {log.action}
                                                    </span>
                                                </td>
                                                <td style={{ padding: '1.25rem 1.5rem', fontSize: '0.875rem' }}>
                                                    <div style={{ color: '#1e293b', fontWeight: '600' }}>{log.entityType}</div>
                                                    <div style={{ color: '#94a3b8', fontSize: '0.75rem', fontFamily: 'monospace' }}>{log.entityId?.slice(0, 12)}...</div>
                                                </td>
                                                <td style={{ padding: '1.25rem 1.5rem', fontSize: '0.875rem' }}>
                                                    <div style={{ color: '#1e293b', fontWeight: '600' }}>
                                                        {log.superAdmin ? `${log.superAdmin.firstName} ${log.superAdmin.lastName}` : log.user ? `${log.user.firstName} ${log.user.lastName}` : 'System'}
                                                    </div>
                                                    <div style={{ color: '#64748b', fontSize: '0.75rem' }}>
                                                        {log.superAdmin ? 'Super Admin' : log.user ? log.user.role : 'Automated Task'}
                                                    </div>
                                                </td>
                                                <td style={{ padding: '1.25rem 1.5rem' }}>
                                                    {renderDetails(log.details)}
                                                </td>
                                            </tr>
                                        )
                                    })}
                                    {logs.length === 0 && (
                                        <tr>
                                            <td colSpan={5} style={{ padding: '5rem', textAlign: 'center' }}>
                                                <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>🔍</div>
                                                <div style={{ color: '#94a3b8', fontWeight: '500' }}>{t('no_audit_logs_found')}</div>
                                            </td>
                                        </tr>
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </section>

                    <footer style={{ marginTop: '2rem' }}>
                        <Pagination
                            currentPage={page}
                            totalPages={totalPages}
                            onPageChange={setPage}
                        />
                    </footer>
                </>
            )}
        </div>
    )
}

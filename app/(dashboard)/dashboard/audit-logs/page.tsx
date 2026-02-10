'use client'

import { useState, useEffect, useCallback } from 'react'
import Pagination from '@/components/Pagination'
import { useLanguage } from '@/context/LanguageContext'
import LoadingSpinner from '@/components/LoadingSpinner'
import { useHeader } from '@/context/HeaderContext'
import { useCompany } from '@/context/CompanyContext'

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
    const { selectedCompanyId } = useCompany()
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
            if (selectedCompanyId) queryParams.set('companyId', selectedCompanyId)

            const res = await fetch(`/api/admin/audit-logs?${queryParams.toString()}`)
            if (res.ok) {
                const result = await res.json()
                setLogs(result.data?.data || [])
                setTotalPages(result.data?.totalPages || 0)
            }
        } catch (error) {
            console.error('Failed to fetch audit logs', error)
        } finally {
            setLoading(false)
        }
    }, [page, filters.entityType, filters.action, limit, selectedCompanyId])

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
                    <pre style={{
                        margin: 0,
                        whiteSpace: 'pre-wrap',
                        fontFamily: 'monospace',
                        maxHeight: '120px',
                        overflowY: 'auto',
                        background: '#f8fafc',
                        padding: '0.5rem',
                        borderRadius: '0.5rem',
                        border: '1px solid #e2e8f0'
                    }}>
                        {JSON.stringify(parsed, null, 2)}
                    </pre>
                </div>
            )
        } catch {
            return <span style={{ fontSize: '0.75rem', color: '#94a3b8' }}>{String(details)}</span>
        }
    }

    const entityTypes = ['TASK', 'OBLIGATION', 'CLIENT', 'SECTION', 'NOTE', 'USER', 'COMPANY', 'SALARY', 'DAY_OFF_REQUEST', 'COMPANY_PAYMENT', 'AUTH']
    const actions = ['CREATE', 'UPDATE', 'DELETE', 'LOGIN', 'LOGOUT', 'APPROVE', 'REJECT', 'REVIEW', 'TRANSFER', 'REVERT', 'APPLY_PENALTY']

    return (
        <div className="animate-fade-in" style={{ direction: locale === 'ar' ? 'rtl' : 'ltr' }}>
            {/* Standard Filter Bar (Compact View) */}
            <div className="glass-card" style={{
                marginBottom: '1.5rem',
                display: 'flex',
                flexWrap: 'wrap',
                gap: '1rem',
                alignItems: 'center',
                padding: '1.25rem'
            }}>
                <div style={{ flex: 1, minWidth: '200px' }}>
                    <div style={{ fontSize: '0.7rem', fontWeight: '800', color: '#64748b', textTransform: 'uppercase', marginBottom: '0.4rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path></svg>
                        {locale === 'ar' ? 'نوع الكيان' : 'Entity Type'}
                    </div>
                    <select
                        className="input"
                        value={filters.entityType}
                        onChange={(e) => { setFilters(f => ({ ...f, entityType: e.target.value })); setPage(1); }}
                        style={{ height: '42px', fontSize: '0.85rem' }}
                    >
                        <option value="">{locale === 'ar' ? 'جميع الكيانات' : 'All Entities'}</option>
                        {entityTypes.sort().map(et => (
                            <option key={et} value={et}>{et}</option>
                        ))}
                    </select>
                </div>

                <div style={{ flex: 1, minWidth: '200px' }}>
                    <div style={{ fontSize: '0.7rem', fontWeight: '800', color: '#64748b', textTransform: 'uppercase', marginBottom: '0.4rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"></polyline></svg>
                        {locale === 'ar' ? 'الإجراء' : 'Action'}
                    </div>
                    <select
                        className="input"
                        value={filters.action}
                        onChange={(e) => { setFilters(f => ({ ...f, action: e.target.value })); setPage(1); }}
                        style={{ height: '42px', fontSize: '0.85rem' }}
                    >
                        <option value="">{locale === 'ar' ? 'جميع الإجراءات' : 'All Actions'}</option>
                        {actions.sort().map(a => (
                            <option key={a} value={a}>{a}</option>
                        ))}
                    </select>
                </div>

                <div style={{ display: 'flex', alignItems: 'flex-end', height: '100%', alignSelf: 'flex-end' }}>
                    <button
                        onClick={() => { setFilters({ entityType: '', action: '' }); setPage(1); }}
                        className="btn"
                        style={{
                            height: '42px',
                            padding: '0 1.25rem',
                            background: 'white',
                            color: '#475569',
                            border: '1px solid #e2e8f0',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '0.5rem',
                            fontSize: '0.85rem',
                            fontWeight: '600'
                        }}
                    >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"></path><polyline points="3 3 3 8 8 8"></polyline></svg>
                        {locale === 'ar' ? 'إعادة تعيين' : 'Reset'}
                    </button>
                </div>
            </div>

            {loading ? (
                <div style={{ display: 'flex', justifyContent: 'center', padding: '4rem' }}>
                    <LoadingSpinner message={t('loading_data')} />
                </div>
            ) : (
                <>
                    <div className="glass-card" style={{ padding: 0, overflow: 'hidden' }}>
                        <div style={{ overflowX: 'auto' }}>
                            <table style={{ width: '100%', borderCollapse: 'separate', borderSpacing: 0 }}>
                                <thead>
                                    <tr style={{ background: '#f8fafc' }}>
                                        <th style={{ textAlign: locale === 'ar' ? 'right' : 'left', padding: '1rem 1.25rem', color: '#64748b', fontSize: '0.7rem', fontWeight: '800', textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: '1px solid #e2e8f0' }}>{t('timestamp')}</th>
                                        <th style={{ textAlign: locale === 'ar' ? 'right' : 'left', padding: '1rem 1.25rem', color: '#64748b', fontSize: '0.7rem', fontWeight: '800', textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: '1px solid #e2e8f0' }}>{t('action')}</th>
                                        <th style={{ textAlign: locale === 'ar' ? 'right' : 'left', padding: '1rem 1.25rem', color: '#64748b', fontSize: '0.7rem', fontWeight: '800', textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: '1px solid #e2e8f0' }}>{t('entity')}</th>
                                        <th style={{ textAlign: locale === 'ar' ? 'right' : 'left', padding: '1rem 1.25rem', color: '#64748b', fontSize: '0.7rem', fontWeight: '800', textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: '1px solid #e2e8f0' }}>{t('performed_by')}</th>
                                        <th style={{ textAlign: locale === 'ar' ? 'right' : 'left', padding: '1rem 1.25rem', color: '#64748b', fontSize: '0.7rem', fontWeight: '800', textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: '1px solid #e2e8f0' }}>{t('details')}</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {logs.map((log) => {
                                        const isDelete = log.action.includes('DELETE')
                                        const isCreate = log.action.includes('CREATE')
                                        const isUpdate = log.action.includes('UPDATE')
                                        const isAuth = log.action.includes('LOGIN') || log.action.includes('LOGOUT')

                                        return (
                                            <tr key={log.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                                                <td style={{ padding: '1.25rem', fontSize: '0.85rem', color: '#1e293b', fontWeight: '600' }}>
                                                    {formatDate(log.createdAt)}
                                                </td>
                                                <td style={{ padding: '1.25rem' }}>
                                                    <span className="badge" style={{
                                                        fontSize: '0.6rem',
                                                        fontWeight: '900',
                                                        background: isDelete ? '#fee2e2' : isCreate ? '#dcfce7' : isUpdate ? '#e0e7ff' : isAuth ? '#fef3c7' : '#f1f5f9',
                                                        color: isDelete ? '#991b1b' : isCreate ? '#166534' : isUpdate ? '#3730a3' : isAuth ? '#92400e' : '#475569',
                                                        border: 'none',
                                                        padding: '0.3rem 0.6rem'
                                                    }}>
                                                        {log.action}
                                                    </span>
                                                </td>
                                                <td style={{ padding: '1.25rem', fontSize: '0.85rem' }}>
                                                    <div style={{ color: '#1e293b', fontWeight: '700' }}>{log.entityType}</div>
                                                    <div style={{ color: '#94a3b8', fontSize: '0.7rem', fontFamily: 'monospace', marginTop: '0.2rem' }}>{log.entityId?.slice(0, 12)}...</div>
                                                </td>
                                                <td style={{ padding: '1.25rem', fontSize: '0.85rem' }}>
                                                    <div style={{ color: '#1e293b', fontWeight: '700' }}>
                                                        {log.superAdmin ? `${log.superAdmin.firstName} ${log.superAdmin.lastName}` : log.user ? `${log.user.firstName} ${log.user.lastName}` : 'System'}
                                                    </div>
                                                    <div style={{ color: '#64748b', fontSize: '0.7rem', marginTop: '0.2rem' }}>
                                                        {log.superAdmin ? 'Super Admin' : log.user ? log.user.role : 'Automated Task'}
                                                    </div>
                                                </td>
                                                <td style={{ padding: '1.25rem', minWidth: '300px' }}>
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
                    </div>

                    <div style={{ marginTop: '2rem' }}>
                        <Pagination
                            currentPage={page}
                            totalPages={totalPages}
                            onPageChange={setPage}
                        />
                    </div>
                </>
            )}
        </div>
    )
}

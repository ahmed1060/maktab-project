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
            if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
                const entries = Object.entries(parsed)
                return (
                    <div style={{
                        background: '#f8fafc',
                        padding: '0.5rem',
                        borderRadius: '0.5rem',
                        border: '1px solid #e2e8f0',
                        fontSize: '0.7rem',
                        fontFamily: 'monospace',
                        maxHeight: '120px',
                        overflowY: 'auto'
                    }}>
                        <div style={{ color: '#94a3b8', marginBottom: '4px' }}>{'{'}</div>
                        {entries.map(([key, value], i) => (
                            <div key={key} style={{
                                display: 'flex',
                                gap: '6px',
                                paddingLeft: '0.75rem',
                                marginBottom: i === entries.length - 1 ? '4px' : '2px'
                            }}>
                                <span style={{ color: '#475569', fontWeight: 'bold', whiteSpace: 'nowrap' }}>&quot;{key}&quot;:</span>
                                <span style={{
                                    color: '#1e293b',
                                    wordBreak: 'break-all',
                                    flex: 1
                                }}>
                                    {typeof value === 'string' ? <>&quot;{value}&quot;</> : JSON.stringify(value)}
                                    {i < entries.length - 1 ? ',' : ''}
                                </span>
                            </div>
                        ))}
                        <div style={{ color: '#94a3b8' }}>{'}'}</div>
                    </div>
                )
            }
            return (
                <div style={{ fontSize: '0.7rem' }}>
                    <pre style={{
                        margin: 0,
                        whiteSpace: 'pre-wrap',
                        fontFamily: 'monospace',
                        maxHeight: '120px',
                        overflowY: 'auto',
                        background: '#f8fafc',
                        padding: '0.5rem',
                        borderRadius: '0.5rem',
                        border: '1px solid #e2e8f0',
                        fontSize: '0.7rem'
                    }}>
                        {JSON.stringify(parsed, null, 2)}
                    </pre>
                </div>
            )
        } catch {
            return <span style={{ fontSize: '0.7rem', color: '#94a3b8', wordBreak: 'break-all' }}>{String(details)}</span>
        }
    }

    const entityTypes = ['TASK', 'OBLIGATION', 'CLIENT', 'SECTION', 'NOTE', 'USER', 'COMPANY', 'SALARY', 'DAY_OFF_REQUEST', 'COMPANY_PAYMENT', 'AUTH']
    const actions = ['CREATE', 'UPDATE', 'DELETE', 'LOGIN', 'LOGOUT', 'APPROVE', 'REJECT', 'REVIEW', 'TRANSFER', 'REVERT', 'APPLY_PENALTY']

    return (
        <div className="animate-fade-in" style={{ direction: locale === 'ar' ? 'rtl' : 'ltr' }}>
            {/* Standard Filter Bar */}
            <div className="glass-card" style={{
                marginBottom: '1.5rem',
                display: 'flex',
                alignItems: 'center',
                gap: '1rem',
                padding: '1rem',
                flexWrap: 'wrap'
            }}>
                <div style={{ flex: 1, minWidth: '200px' }}>
                    <label style={{ fontSize: '0.7rem', fontWeight: '800', color: '#64748b', textTransform: 'uppercase', marginBottom: '0.4rem', display: 'block' }}>
                        {locale === 'ar' ? 'نوع الكيان' : 'Entity Type'}
                    </label>
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
                    <label style={{ fontSize: '0.7rem', fontWeight: '800', color: '#64748b', textTransform: 'uppercase', marginBottom: '0.4rem', display: 'block' }}>
                        {locale === 'ar' ? 'الإجراء' : 'Action'}
                    </label>
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

                <div style={{ alignSelf: 'flex-end' }}>
                    <button
                        onClick={() => { setFilters({ entityType: '', action: '' }); setPage(1); }}
                        className="btn"
                        style={{ height: '42px', padding: '0 1.25rem', background: 'white', color: '#64748b', border: '1px solid #e2e8f0' }}
                    >
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
                    <div style={{ background: 'white', borderRadius: '12px', overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.1)', border: '1px solid #e2e8f0' }}>
                        <div style={{ overflowX: 'auto' }}>
                            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                                <thead>
                                    <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
                                        <th style={{ textAlign: locale === 'ar' ? 'right' : 'left', padding: '1rem', color: '#64748b', fontSize: '0.75rem', fontWeight: '800', textTransform: 'uppercase', minWidth: '160px' }}>{t('timestamp')}</th>
                                        <th style={{ textAlign: locale === 'ar' ? 'right' : 'left', padding: '1rem', color: '#64748b', fontSize: '0.75rem', fontWeight: '800', textTransform: 'uppercase', minWidth: '120px' }}>{t('action')}</th>
                                        <th style={{ textAlign: locale === 'ar' ? 'right' : 'left', padding: '1rem', color: '#64748b', fontSize: '0.75rem', fontWeight: '800', textTransform: 'uppercase', minWidth: '130px' }}>{t('entity')}</th>
                                        <th style={{ textAlign: locale === 'ar' ? 'right' : 'left', padding: '1rem', color: '#64748b', fontSize: '0.75rem', fontWeight: '800', textTransform: 'uppercase', minWidth: '180px' }}>{t('performed_by')}</th>
                                        <th style={{ textAlign: locale === 'ar' ? 'right' : 'left', padding: '1rem', color: '#64748b', fontSize: '0.75rem', fontWeight: '800', textTransform: 'uppercase', minWidth: '300px' }}>{t('details')}</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {logs.map((log) => (
                                        <tr key={log.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                                            <td style={{ padding: '1rem', fontSize: '0.8rem', color: '#64748b' }}>
                                                {formatDate(log.createdAt)}
                                            </td>
                                            <td style={{ padding: '1rem' }}>
                                                <span style={{
                                                    fontSize: '0.65rem',
                                                    fontWeight: '700',
                                                    background: log.action.includes('DELETE') ? '#fee2e2' : log.action.includes('CREATE') ? '#dcfce7' : '#e0e7ff',
                                                    color: log.action.includes('DELETE') ? '#991b1b' : log.action.includes('CREATE') ? '#166534' : '#3730a3',
                                                    padding: '0.2rem 0.4rem',
                                                    borderRadius: '4px',
                                                    display: 'inline-block',
                                                    whiteSpace: 'nowrap'
                                                }}>
                                                    {log.action}
                                                </span>
                                            </td>
                                            <td style={{ padding: '1rem', fontSize: '0.8rem' }}>
                                                <div style={{ fontWeight: '600', color: '#1e293b' }}>{log.entityType}</div>
                                                <div style={{ color: '#94a3b8', fontSize: '0.7rem', fontFamily: 'monospace' }}>{log.entityId?.slice(0, 8)}...</div>
                                            </td>
                                            <td style={{ padding: '1rem', fontSize: '0.8rem' }}>
                                                <div style={{ fontWeight: '600', color: '#1e293b' }}>
                                                    {log.superAdmin ? `${log.superAdmin.firstName} ${log.superAdmin.lastName}` : log.user ? `${log.user.firstName} ${log.user.lastName}` : 'System'}
                                                </div>
                                                <div style={{ color: '#64748b', fontSize: '0.7rem' }}>
                                                    {log.superAdmin ? 'Super Admin' : log.user ? log.user.role : 'Automated Task'}
                                                </div>
                                            </td>
                                            <td style={{ padding: '1rem', verticalAlign: 'top' }}>
                                                {renderDetails(log.details)}
                                            </td>
                                        </tr>
                                    ))}
                                    {logs.length === 0 && (
                                        <tr>
                                            <td colSpan={5} style={{ padding: '4rem', textAlign: 'center', color: '#94a3b8' }}>
                                                {t('no_audit_logs_found')}
                                            </td>
                                        </tr>
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </div>

                    <div style={{ marginTop: '1.5rem' }}>
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

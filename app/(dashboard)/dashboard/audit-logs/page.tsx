'use client'

import { useState, useEffect } from 'react'
import useSWR from 'swr'
import Pagination from '@/components/Pagination'
import { useLanguage } from '@/context/LanguageContext'
import LoadingSpinner from '@/components/LoadingSpinner'
import { useHeader } from '@/context/HeaderContext'
import { useCompany } from '@/context/CompanyContext'
import AuditLogFilter from '@/components/AuditLogFilter'
import { fetcher } from '@/lib/swr-fetcher'

type AuditLog = {
    id: string
    action: string
    entityType: string
    entityId: string
    userId: string | null
    superAdminId: string | null
    details: any // F-12: Json on the backend, not a JSON-in-string column
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
    const [page, setPage] = useState(1)
    const [filters, setFilters] = useState({
        entityType: '',
        action: '',
        startDate: '',
        endDate: '',
        entityId: '',
        performedById: ''
    })
    const limit = 20

    // "Performed By" filter options — fetched once, doesn't depend on
    // anything that changes on this page.
    const { data: usersResult } = useSWR('/api/all-users?limit=1000', fetcher)
    const users: { id: string, firstName: string, lastName: string, role: string }[] = usersResult?.data?.users || []

    const entityTypes = [
        'USER', 'TASK', 'SUPER_ADMIN', 'SECTION', 'SALARY',
        'REQUEST', 'OBLIGATION', 'NOTE', 'SYSTEM',
        'DAY_OFF_REQUEST', 'COMPANY', 'COMPANY_PAYMENT', 'CLIENT'
    ]
    const actionGroups = ['CREATE', 'UPDATE', 'DELETE', 'SYSTEM']
    const specificActions = [
        'LOGIN', 'LOGIN_FAILURE', 'APPROVE_PROFILE_UPDATE', 'REJECT_PROFILE_UPDATE',
        'APPROVE_DAY_OFF_REQUEST', 'REJECT_DAY_OFF_REQUEST', 'REEVALUATE_DAY_OFF_REQUEST',
        'CONFIRM_COMPANY_PAYMENT', 'CREATE_DAY_OFF', 'CREATE_DAY_OFF_REQUEST',
        'BULK_CREATE_TASK', 'BULK_CREATE_TASKS', 'BULK_UPDATE_PAYMENT', 'BULK_UPDATE_PAYMENT_STATUS',
        'UPDATE_PAYMENT_STATUS', 'UPDATE_TASK_DETAILS', 'UPDATE_OBLIGATION', 'UPDATE_REQUEST_STATUS',
        'DELETE_TASK_ITEM', 'VERIFY_LOCATION', 'ACKNOWLEDGE_TASK_EDIT',
        'REVEAL_PASSWORD', 'ADMIN_UNBLOCK_RATE_LIMIT',
        'UPDATE_TASK_PROGRESS', 'UPDATE_OBLIGATION_PROGRESS',
        'UPDATE_USER_STATUS', 'RESET_USER_POINTS', 'RESET_ALL_POINTS',
        'SUBMIT_TASK', 'REVIEW_TASK', 'TRANSFER_TASK', 'REVERT_TASK', 'REVERT_OBLIGATION',
        'APPLY_TASK_PENALTY', 'ADD_BONUS', 'ADD_DEDUCTION', 'ROLLBACK_SALARY_ADJUSTMENT'
    ]

    useEffect(() => {
        setTitle(t('audit_logs'))
        setSubtitle(t('audit_logs_subtitle'))
        return () => {
            setTitle(null)
            setSubtitle(null)
        }
    }, [setTitle, setSubtitle, t])

    const logsQuery = (() => {
        const queryParams = new URLSearchParams()
        queryParams.set('page', page.toString())
        queryParams.set('limit', limit.toString())
        if (filters.entityType) queryParams.set('entityType', filters.entityType)
        if (filters.action) queryParams.set('action', filters.action)
        if (filters.startDate) queryParams.set('startDate', filters.startDate)
        if (filters.endDate) queryParams.set('endDate', filters.endDate)
        if (filters.entityId) queryParams.set('entityId', filters.entityId)
        if (filters.performedById) queryParams.set('performedById', filters.performedById)
        if (selectedCompanyId) queryParams.set('companyId', selectedCompanyId)
        return `/api/admin/audit-logs?${queryParams.toString()}`
    })()
    const { data: logsResult, isLoading: loading } = useSWR(logsQuery, fetcher)
    const logs: AuditLog[] = logsResult?.data?.data || []
    const totalPages: number = logsResult?.data?.totalPages || 0

    const handleFilterChange = (newFilters: typeof filters) => {
        setFilters(newFilters)
        setPage(1)
    }

    const formatDate = (dateString: string) => {
        const date = new Date(dateString)
        return new Intl.DateTimeFormat(locale === 'ar' ? 'ar-EG' : 'en-US', {
            dateStyle: 'medium',
            timeStyle: 'short'
        }).format(date)
    }

    // details arrives already parsed (F-12: AuditLog.details is Json, not a
    // JSON-in-string column) — no JSON.parse needed here anymore.
    const renderDetails = (details: any) => {
        if (details === null || details === undefined) return '-'
        try {
            const parsed = details
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
                                    overflowWrap: 'anywhere',
                                    flex: 1
                                }}>
                                    {typeof value === 'string' ? <>&quot;{value}&quot;</> : JSON.stringify(value).replace(/,/g, ', ')}
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
                        fontSize: '0.7rem',
                        overflowWrap: 'break-word'
                    }}>
                        {JSON.stringify(parsed, null, 2)}
                    </pre>
                </div>
            )
        } catch {
            return <span style={{ fontSize: '0.7rem', color: '#94a3b8', overflowWrap: 'anywhere' }}>{String(details)}</span>
        }
    }

    return (
        <div className="animate-fade-in" style={{ direction: locale === 'ar' ? 'rtl' : 'ltr' }}>
            <AuditLogFilter
                filters={filters}
                onFilterChange={handleFilterChange}
                totalCount={logs.length > 0 ? (totalPages * limit) : 0} // Approximate total for UI badge
                users={users}
                entityTypes={entityTypes}
                actionGroups={actionGroups}
                specificActions={specificActions}
            />

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
                                                    {(t as any)(`audit_action_${log.action}`) || log.action}
                                                </span>
                                            </td>
                                            <td style={{ padding: '1rem', fontSize: '0.8rem' }}>
                                                <div style={{ fontWeight: '600', color: '#1e293b' }}>
                                                    {(t as any)(`audit_entity_${log.entityType}`) || log.entityType}
                                                </div>
                                                <div style={{
                                                    color: '#94a3b8',
                                                    fontSize: '0.7rem',
                                                    fontFamily: 'monospace',
                                                    overflowWrap: 'anywhere',
                                                    maxWidth: '120px'
                                                }}>
                                                    {log.entityId}
                                                </div>
                                            </td>
                                            <td style={{ padding: '1rem', fontSize: '0.8rem' }}>
                                                <div style={{ fontWeight: '600', color: '#1e293b' }}>
                                                    {log.superAdmin ? `${log.superAdmin.firstName} ${log.superAdmin.lastName}` : log.user ? `${log.user.firstName} ${log.user.lastName}` : (locale === 'ar' ? 'النظام' : 'System')}
                                                </div>
                                                <div style={{ color: '#64748b', fontSize: '0.7rem' }}>
                                                    {log.superAdmin ? (locale === 'ar' ? 'مسؤول عام' : 'Super Admin') : log.user ? log.user.role : (locale === 'ar' ? 'مهمة تلقائية' : 'Automated Task')}
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

'use client'
import { useState, useEffect } from 'react'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { useLanguage } from '@/context/LanguageContext'
import { useSession } from 'next-auth/react'
import LoadingSpinner from '@/components/LoadingSpinner'

interface SalaryRecord {
    id: string
    month: number
    year: number
    totalDays: number
    deductions: number // Deductions in DAYS
    baseSalary: number
    bonusDays: number // Bonus in DAYS
    createdAt: string
}

interface DayOffRequest {
    id: string
    type: string
    date: string
    daysDeducted: number
    deductionType: string
    reason?: string
}

interface DayOffCreditSnapshot {
    id: string
    year: number
    baseCredit: number
    remainingCredit: number
}

interface DayOffHistoryYear {
    year: number
    snapshot: DayOffCreditSnapshot | null
    requests: DayOffRequest[]
}

interface SalaryAdjustment {
    id: string
    type: 'BONUS' | 'DEDUCTION'
    amount: number
    reason?: string
    status: 'ACTIVE' | 'ROLLED_BACK'
    createdAt: string
}

interface Employee {
    id: string
    firstName: string
    lastName: string
    salary?: number
}

export default function EmployeeHistoryPage() {
    const { t, locale } = useLanguage()
    const params = useParams()
    const router = useRouter()
    const { data: session } = useSession()
    const isAdmin = ['ADMIN', 'SUPER_ADMIN'].includes((session?.user as any)?.role || '')

    const [records, setRecords] = useState<SalaryRecord[]>([])
    const [employee, setEmployee] = useState<Employee | null>(null)
    const [loading, setLoading] = useState(true)
    const [isAdjustmentsModalOpen, setIsAdjustmentsModalOpen] = useState(false)
    const [adjustments, setAdjustments] = useState<SalaryAdjustment[]>([])
    const [rollbackLoading, setRollbackLoading] = useState<string | null>(null)
    const [alert, setAlert] = useState<{ type: 'success' | 'error'; message: string } | null>(null)
    const [activeTab, setActiveTab] = useState<'SALARY' | 'DAY_OFF'>('SALARY')
    const [dayOffHistory, setDayOffHistory] = useState<{ baseCredit: number, remainingCredit: number, history: DayOffHistoryYear[] } | null>(null)
    const [isReevaluateModalOpen, setIsReevaluateModalOpen] = useState(false)
    const [selectedRequest, setSelectedRequest] = useState<DayOffRequest | null>(null)
    const [reevaluateValue, setReevaluateValue] = useState('')
    const [isManageDeductionsOpen, setIsManageDeductionsOpen] = useState(false)
    const searchParams = useSearchParams()
    const highlightId = searchParams.get('highlight')

    const fetchData = async () => {
        try {
            setLoading(true)
            // Fetch Employee Details (Use query param for ID)
            const userRes = await fetch(`/api/users?id=${params.id}`)
            if (userRes.ok) {
                const userData = await userRes.json()
                setEmployee(userData)
            }

            // Fetch Salary History
            const historyRes = await fetch(`/api/users/${params.id}/salary-history`)
            if (historyRes.ok) {
                const historyData = await historyRes.json()
                setRecords(historyData)
            }

            // Fetch Day Off History
            const dayOffRes = await fetch(`/api/users/${params.id}/day-off-history`)
            if (dayOffRes.ok) {
                const dayOffData = await dayOffRes.json()
                setDayOffHistory(dayOffData)
            }
        } catch (error) {
            console.error('Error fetching data:', error)
        } finally {
            setLoading(false)
        }
    }

    useEffect(() => {
        if (params.id) {
            fetchData()
        }
    }, [params.id])

    useEffect(() => {
        if (highlightId && params.id) {
            // Check if highlightId might be an adjustment
            // We can fetch adjustments and see if it's there
            fetchAdjustments().then(() => {
                setIsAdjustmentsModalOpen(true)
            })
        }
    }, [highlightId, params.id])

    const fetchAdjustments = async () => {
        try {
            const res = await fetch(`/api/users/${params.id}/adjustments`)
            if (res.ok) {
                const data = await res.json()
                setAdjustments(data)
            }
        } catch (error) {
            console.error('Error fetching adjustments:', error)
        }
    }

    // Scroll to highlighted adjustment inside modal
    useEffect(() => {
        if (highlightId && isAdjustmentsModalOpen && adjustments.length > 0) {
            // Use a small timeout to ensure the modal content is rendered
            const timer = setTimeout(() => {
                const element = document.getElementById(`adj-${highlightId}`);
                if (element) {
                    element.scrollIntoView({ behavior: 'smooth', block: 'center' });
                }
            }, 100);
            return () => clearTimeout(timer);
        }
    }, [highlightId, isAdjustmentsModalOpen, adjustments]);

    const handleRollback = async (adjId: string) => {
        setRollbackLoading(adjId)
        try {
            const res = await fetch(`/api/users/${params.id}/adjustments/${adjId}/rollback`, {
                method: 'POST'
            })
            if (res.ok) {
                setAlert({ type: 'success', message: t('rollback_success' as any) })
                fetchAdjustments()
                // Refresh records too
                const historyRes = await fetch(`/api/users/${params.id}/salary-history`)
                if (historyRes.ok) {
                    const historyData = await historyRes.json()
                    setRecords(historyData)
                }
            } else {
                setAlert({ type: 'error', message: t('failed_rollback' as any) })
            }
        } catch (error) {
            console.error('Error rolling back:', error)
            setAlert({ type: 'error', message: t('failed_rollback' as any) })
        } finally {
            setRollbackLoading(null)
            setTimeout(() => setAlert(null), 3000)
        }
    }

    const handleReevaluate = async () => {
        if (!selectedRequest || !reevaluateValue) return

        try {
            setLoading(true)
            const res = await fetch(`/api/admin/day-off-requests/${selectedRequest.id}/reevaluate`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ newDays: parseFloat(reevaluateValue) })
            })

            if (res.ok) {
                setAlert({ type: 'success', message: t('update_success' as any) || 'Re-evaluation successful' })
                await fetchData()
                setIsReevaluateModalOpen(false)
            } else {
                const err = await res.text()
                setAlert({ type: 'error', message: err || t('update_failed' as any) })
            }
        } catch (error) {
            setAlert({ type: 'error', message: t('update_failed' as any) })
        } finally {
            setLoading(false)
            setTimeout(() => setAlert(null), 3000)
        }
    }

    const getMonthName = (month: number) => {
        return new Date(2000, month - 1).toLocaleString(locale === 'ar' ? 'ar-EG' : 'en-US', { month: 'long' })
    }

    const formatDays = (days: number) => {
        if (locale === 'ar') {
            if (days === 1) return t('day_singular' as any)
            if (days === 2) return t('day_dual' as any)
            return `${days} ${t('days_label')}`
        }
        return `${days} ${days === 1 ? t('day_singular' as any) : t('days_label')}`
    }

    if (loading) return <LoadingSpinner />

    return (
        <div style={{ direction: locale === 'ar' ? 'rtl' : 'ltr' }}>
            <div style={{ marginBottom: '2rem' }}>
                <button
                    onClick={() => router.back()}
                    className="glass"
                    style={{
                        width: '40px',
                        height: '40px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        marginBottom: '0.75rem',
                        color: 'var(--primary)',
                        textDecoration: 'none',
                        transition: 'all 0.3s ease',
                        border: '1px solid rgba(255, 255, 255, 0.4)',
                        transform: `translateY(-2px)${locale === 'ar' ? ' scaleX(-1)' : ''}`,
                        float: locale === 'ar' ? 'right' : 'left',
                        marginInlineEnd: '1.25rem',
                        cursor: 'pointer',
                        padding: 0
                    }}
                    onMouseOver={(e) => {
                        e.currentTarget.style.transform = `translateY(-4px)${locale === 'ar' ? ' scaleX(-1)' : ''}`
                        e.currentTarget.style.background = 'rgba(255, 255, 255, 0.9)'
                    }}
                    onMouseOut={(e) => {
                        e.currentTarget.style.transform = `translateY(-2px)${locale === 'ar' ? ' scaleX(-1)' : ''}`
                        e.currentTarget.style.background = 'rgba(255, 255, 255, 0.7)'
                    }}
                    title={t('back_to_employees')}
                >
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <line x1="19" y1="12" x2="5" y2="12"></line>
                        <polyline points="12 19 5 12 12 5"></polyline>
                    </svg>
                </button>
                <div style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: '1rem',
                    flexWrap: 'wrap',
                    marginBottom: '1rem'
                }}>
                    <div style={{ display: 'flex', gap: '0.5rem' }}>
                        <button
                            onClick={() => setActiveTab('SALARY')}
                            className={`btn ${activeTab === 'SALARY' ? 'btn-primary' : 'glass'}`}
                            style={{ borderRadius: '1rem', padding: '0.5rem 1.5rem', height: '42px' }}
                        >
                            {isAdmin ? t('salary_label' as any) : t('history')}
                        </button>
                        <button
                            onClick={() => setActiveTab('DAY_OFF')}
                            className={`btn ${activeTab === 'DAY_OFF' ? 'btn-primary' : 'glass'}`}
                            style={{ borderRadius: '1rem', padding: '0.5rem 1.5rem', height: '42px' }}
                        >
                            {t('day_off_credit_tab' as any) || 'Day Off Credit'}
                        </button>
                    </div>
                    {isAdmin && activeTab === 'SALARY' && (
                        <button
                            onClick={() => { setIsAdjustmentsModalOpen(true); fetchAdjustments(); }}
                            className="btn btn-primary"
                        >
                            {t('manage_adjustments' as any)}
                        </button>
                    )}
                    {isAdmin && activeTab === 'DAY_OFF' && (
                        <button
                            onClick={() => setIsManageDeductionsOpen(true)}
                            className="btn btn-primary"
                        >
                            {t('manage_deductions' as any) || 'Manage Deductions'}
                        </button>
                    )}
                </div>
                {employee && (
                    <div style={{ fontSize: '1.2rem', color: '#475569', textAlign: locale === 'ar' ? 'right' : 'left' }}>
                        <p style={{ margin: 0 }}>{t('for_label')}: <strong>{employee.firstName} {employee.lastName}</strong></p>
                        {activeTab === 'SALARY' ? (
                            employee.salary !== undefined && (
                                <p style={{ margin: '0.25rem 0 0 0', fontSize: '1rem' }}>{t('current_base_salary')}: <strong>{employee.salary} {t('egp')}</strong></p>
                            )
                        ) : (
                            dayOffHistory && (
                                <p style={{ margin: '0.25rem 0 0 0', fontSize: '1rem' }}>
                                    {t('assigned_day_off_credit_label' as any) || 'Assigned Credit'}: <strong>{dayOffHistory.baseCredit}</strong> |
                                    {t('remaining_day_off_credit_label' as any) || ' Remaining'}: <strong style={{ color: '#166534' }}>{dayOffHistory.remainingCredit}</strong>
                                </p>
                            )
                        )}
                    </div>
                )}
            </div>

            {/* Alert Toast */}
            {alert && (
                <div style={{
                    position: 'fixed',
                    top: '2rem',
                    right: '2rem',
                    zIndex: 2000,
                    padding: '1rem 1.5rem',
                    borderRadius: '1rem',
                    background: alert.type === 'success' ? '#dcfce7' : '#fee2e2',
                    color: alert.type === 'success' ? '#166534' : '#991b1b',
                    boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1)',
                    border: `1px solid ${alert.type === 'success' ? '#16653433' : '#991b1b33'}`,
                    animation: 'slideInRight 0.3s ease-out'
                }}>
                    {alert.message}
                </div>
            )}

            {activeTab === 'SALARY' ? (
                <div className="card" style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '800px' }}>
                        <thead>
                            <tr style={{ background: '#f8fafc', borderBottom: '2px solid #e2e8f0' }}>
                                <th style={{ padding: '1rem', textAlign: locale === 'ar' ? 'right' : 'left' }}>{t('month_year_column')}</th>
                                <th style={{ padding: '1rem', textAlign: locale === 'ar' ? 'right' : 'left' }}>{t('base_salary_column')}</th>
                                <th style={{ padding: '1rem', textAlign: locale === 'ar' ? 'right' : 'left' }}>{t('values_net_total_column')}</th>
                                <th style={{ padding: '1rem', textAlign: locale === 'ar' ? 'right' : 'left' }}>{t('deduction_days_column')}</th>
                                <th style={{ padding: '1rem', textAlign: locale === 'ar' ? 'right' : 'left' }}>{t('bonus_days_column')}</th>
                                <th style={{ padding: '1rem', textAlign: locale === 'ar' ? 'right' : 'left' }}>{t('calculated_salary_column')}</th>
                                <th style={{ padding: '1rem', textAlign: locale === 'ar' ? 'right' : 'left' }}>{t('details_column')}</th>
                            </tr>
                        </thead>
                        <tbody>
                            {records.length === 0 ? (
                                <tr>
                                    <td colSpan={7} style={{ padding: '2rem', textAlign: 'center', color: '#64748b' }}>
                                        {t('no_records_found')}
                                    </td>
                                </tr>
                            ) : (
                                records.map(record => {
                                    // Net Days = Total - Deductions
                                    const netDays = record.totalDays - record.deductions
                                    const fractionDisplay = netDays % 1 !== 0 ? netDays.toFixed(2) : netDays

                                    // Calculate Salary: (Base / Total) * (Total - Deductions + BonusDays)
                                    // Effectively: (Base / Total) * (NetDays + BonusDays)

                                    const baseSalaryToUse = record.baseSalary || employee?.salary || 0
                                    let calculatedSalary = 0

                                    const totalPayableDays = netDays + (record.bonusDays || 0)

                                    if (baseSalaryToUse > 0 && record.totalDays > 0) {
                                        calculatedSalary = (baseSalaryToUse / record.totalDays) * totalPayableDays
                                    }

                                    const formattedCalculated = new Intl.NumberFormat(locale === 'ar' ? 'ar-EG' : 'en-EG', { style: 'currency', currency: 'EGP' }).format(calculatedSalary)
                                    const formattedBase = new Intl.NumberFormat(locale === 'ar' ? 'ar-EG' : 'en-EG', { style: 'currency', currency: 'EGP' }).format(baseSalaryToUse)

                                    return (
                                        <tr key={record.id} style={{ borderBottom: '1px solid #e2e8f0' }}>
                                            <td style={{ padding: '1rem', fontWeight: '500', textAlign: locale === 'ar' ? 'right' : 'left' }}>
                                                {getMonthName(record.month)} {record.year}
                                            </td>
                                            <td style={{ padding: '1rem', color: '#475569', textAlign: locale === 'ar' ? 'right' : 'left' }}>
                                                {formattedBase}
                                            </td>
                                            <td style={{ padding: '1rem', fontSize: '1.1rem', color: '#0f172a', textAlign: locale === 'ar' ? 'right' : 'left' }}>
                                                <span style={{ fontWeight: 'bold' }}>{fractionDisplay}</span>
                                                <span style={{ color: '#94a3b8' }}> / {record.totalDays}</span>
                                            </td>
                                            <td style={{ padding: '1rem', color: '#dc2626', fontWeight: '500', textAlign: locale === 'ar' ? 'right' : 'left' }}>
                                                {record.deductions > 0 ? `-${formatDays(record.deductions)}` : '-'}
                                            </td>
                                            <td style={{ padding: '1rem', color: '#7c3aed', fontWeight: '500', textAlign: locale === 'ar' ? 'right' : 'left' }}>
                                                {record.bonusDays ? `+${formatDays(record.bonusDays)}` : '-'}
                                            </td>
                                            <td style={{ padding: '1rem', fontWeight: '600', color: '#166534', textAlign: locale === 'ar' ? 'right' : 'left' }}>
                                                {formattedCalculated}
                                            </td>
                                            <td style={{ padding: '1rem', color: '#64748b', fontSize: '0.875rem', textAlign: locale === 'ar' ? 'right' : 'left' }}>
                                                {t('created_label')}: {new Date(record.createdAt).toLocaleDateString(locale === 'ar' ? 'ar-EG' : 'en-US')}
                                            </td>
                                        </tr>
                                    )
                                })
                            )}
                        </tbody>
                    </table>
                </div>
            ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
                    {dayOffHistory?.history.map(yearData => (
                        <div key={yearData.year} className="card" style={{ overflowX: 'auto', padding: '1.5rem', background: 'rgba(255, 255, 255, 0.7)' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem', borderBottom: '1px solid #e2e8f0', paddingBottom: '0.75rem' }}>
                                <h2 style={{ margin: 0 }}>{yearData.year}</h2>
                                {yearData.snapshot && (
                                    <div style={{ fontSize: '0.9rem', color: '#64748b' }}>
                                        {t('base_credit' as any) || 'Base'}: <strong>{yearData.snapshot.baseCredit}</strong> |
                                        {t('remaining_before_reset' as any) || ' Remaining (End of Year)'}: <strong>{yearData.snapshot.remainingCredit}</strong>
                                    </div>
                                )}
                            </div>
                            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                                <thead>
                                    <tr style={{ background: '#f8fafc', borderBottom: '2px solid #e2e8f0' }}>
                                        <th style={{ padding: '0.75rem', textAlign: locale === 'ar' ? 'right' : 'left' }}>{t('date_label')}</th>
                                        <th style={{ padding: '0.75rem', textAlign: locale === 'ar' ? 'right' : 'left' }}>{t('type_label')}</th>
                                        <th style={{ padding: '0.75rem', textAlign: locale === 'ar' ? 'right' : 'left' }}>{t('reason_label')}</th>
                                        <th style={{ padding: '0.75rem', textAlign: locale === 'ar' ? 'right' : 'left' }}>{t('days_label')}</th>
                                        <th style={{ padding: '0.75rem', textAlign: locale === 'ar' ? 'right' : 'left' }}>{t('deducted_from' as any) || 'Deducted From'}</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {yearData.requests.length === 0 ? (
                                        <tr><td colSpan={5} style={{ padding: '2rem', textAlign: 'center', color: '#64748b' }}>{t('no_records_found')}</td></tr>
                                    ) : (
                                        yearData.requests.map(req => (
                                            <tr key={req.id} style={{ borderBottom: '1px solid #e2e8f0' }}>
                                                <td style={{ padding: '0.75rem', textAlign: locale === 'ar' ? 'right' : 'left' }}>{new Date(req.date).toLocaleDateString(locale)}</td>
                                                <td style={{ padding: '0.75rem', textAlign: locale === 'ar' ? 'right' : 'left' }}>{t(req.type as any) || req.type}</td>
                                                <td style={{ padding: '0.75rem', textAlign: locale === 'ar' ? 'right' : 'left' }}>{req.reason || '-'}</td>
                                                <td style={{ padding: '0.75rem', textAlign: locale === 'ar' ? 'right' : 'left', fontWeight: 'bold' }}>{req.daysDeducted}</td>
                                                <td style={{ padding: '0.75rem', textAlign: locale === 'ar' ? 'right' : 'left' }}>{req.deductionType === 'CREDIT' ? t('day_off_credit') : t('salary_label' as any)}</td>
                                            </tr>
                                        ))
                                    )}
                                </tbody>
                            </table>
                        </div>
                    ))}
                </div>
            )}

            {/* Adjustments Modal */}
            {isAdjustmentsModalOpen && (
                <div style={{
                    position: 'fixed',
                    inset: 0,
                    zIndex: 1000,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    background: 'rgba(0,0,0,0.4)',
                    backdropFilter: 'blur(4px)',
                    padding: '1rem'
                }}>
                    <div className="glass" style={{
                        width: '100%',
                        maxWidth: '600px',
                        maxHeight: '80vh',
                        overflowY: 'auto',
                        padding: '2rem',
                        position: 'relative',
                        background: 'rgba(255, 255, 255, 0.95)'
                    }}>
                        <button
                            onClick={() => setIsAdjustmentsModalOpen(false)}
                            style={{
                                position: 'absolute',
                                top: '1rem',
                                [locale === 'ar' ? 'left' : 'right']: '1rem',
                                border: 'none',
                                background: 'none',
                                fontSize: '1.5rem',
                                cursor: 'pointer',
                                color: '#64748b'
                            }}
                        >
                            ×
                        </button>
                        <h2 style={{ marginBottom: '1.5rem' }}>{t('adjustment_history' as any)}</h2>

                        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                            {adjustments.length === 0 ? (
                                <p style={{ textAlign: 'center', color: '#64748b' }}>{t('no_adjustments_found' as any)}</p>
                            ) : (
                                adjustments.map(adj => (
                                    <div
                                        key={adj.id}
                                        id={`adj-${adj.id}`}
                                        className={highlightId === adj.id ? 'highlight-shading' : ''}
                                        style={{
                                            position: 'relative',
                                            padding: '1.25rem',
                                            borderRadius: '1rem',
                                            background: 'white',
                                            border: '1px solid #e2e8f0',
                                            display: 'flex',
                                            justifyContent: 'space-between',
                                            alignItems: 'center'
                                        }}
                                    >
                                        {/* Strikethrough Line */}
                                        {adj.status === 'ROLLED_BACK' && (
                                            <div style={{
                                                position: 'absolute',
                                                top: '50%',
                                                left: '-5px',
                                                right: '-5px',
                                                height: '2px',
                                                background: '#ef4444',
                                                transform: 'rotate(-2deg)',
                                                zIndex: 5,
                                                opacity: 0.8,
                                                pointerEvents: 'none'
                                            }} />
                                        )}

                                        <div style={{ opacity: adj.status === 'ROLLED_BACK' ? 0.6 : 1 }}>
                                            <div style={{ fontWeight: 'bold', fontSize: '1.1rem', color: adj.type === 'BONUS' ? '#7c3aed' : '#dc2626' }}>
                                                {adj.type === 'BONUS' ? '+' : '-'}{formatDays(adj.amount)}
                                            </div>
                                            {adj.reason && (
                                                <div style={{ fontSize: '0.9rem', color: '#475569', marginTop: '0.25rem', maxWidth: '300px' }}>
                                                    {adj.reason}
                                                </div>
                                            )}
                                            <div style={{ fontSize: '0.875rem', color: '#94a3b8', marginTop: '0.25rem' }}>
                                                {new Date(adj.createdAt).toLocaleString(locale)}
                                            </div>
                                        </div>

                                        {adj.status === 'ACTIVE' && (
                                            <button
                                                onClick={() => handleRollback(adj.id)}
                                                disabled={!!rollbackLoading}
                                                className="btn"
                                                style={{
                                                    background: '#fee2e2',
                                                    color: '#991b1b',
                                                    fontSize: '0.875rem',
                                                    padding: '0.5rem 1rem'
                                                }}
                                            >
                                                {rollbackLoading === adj.id ? '...' : t('rollback_adjustment' as any)}
                                            </button>
                                        )}
                                        {adj.status === 'ROLLED_BACK' && (
                                            <span style={{ fontSize: '0.8rem', color: '#ef4444', fontWeight: 'bold' }}>
                                                {t('rollback_adjustment' as any)}
                                            </span>
                                        )}
                                    </div>
                                ))
                            )}
                        </div>
                    </div>
                </div>
            )}
            {/* ReEvaluate Modal */}
            {isReevaluateModalOpen && selectedRequest && (
                <div style={{
                    position: 'fixed',
                    inset: 0,
                    zIndex: 1100,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    background: 'rgba(0,0,0,0.4)',
                    backdropFilter: 'blur(4px)',
                    padding: '1rem'
                }}>
                    <div className="glass" style={{
                        width: '100%',
                        maxWidth: '400px',
                        padding: '2rem',
                        background: 'rgba(255, 255, 255, 0.95)',
                        borderRadius: '1.5rem',
                        boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1)',
                        direction: locale === 'ar' ? 'rtl' : 'ltr'
                    }}>
                        <h2 style={{ marginBottom: '1rem' }}>{t('reevaluate')}</h2>
                        <p style={{ color: '#64748b', fontSize: '0.9rem', marginBottom: '1.5rem' }}>
                            {new Date(selectedRequest.date).toLocaleDateString(locale)} - {t(selectedRequest.type as any) || selectedRequest.type}
                        </p>
                        <div style={{ marginBottom: '1.5rem' }}>
                            <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: '500', color: '#475569', marginBottom: '0.5rem' }}>
                                {t('days_label')}
                            </label>
                            <input
                                type="number"
                                step="0.5"
                                value={reevaluateValue}
                                onChange={(e) => setReevaluateValue(e.target.value)}
                                className="input"
                                style={{ width: '100%' }}
                                autoFocus
                            />
                        </div>
                        <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end' }}>
                            <button onClick={() => setIsReevaluateModalOpen(false)} className="btn glass">{t('cancel_button')}</button>
                            <button
                                onClick={handleReevaluate}
                                className="btn btn-primary"
                                disabled={loading}
                            >
                                {t('confirm')}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Manage Deductions Modal */}
            {isManageDeductionsOpen && (
                <div style={{
                    position: 'fixed',
                    inset: 0,
                    zIndex: 1000,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    background: 'rgba(0,0,0,0.4)',
                    backdropFilter: 'blur(4px)',
                    padding: '1rem'
                }}>
                    <div className="glass" style={{
                        width: '100%',
                        maxWidth: '700px',
                        maxHeight: '85vh',
                        overflowY: 'auto',
                        padding: '2rem',
                        background: 'rgba(255, 255, 255, 0.95)',
                        borderRadius: '2rem',
                        direction: locale === 'ar' ? 'rtl' : 'ltr'
                    }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
                            <h2 style={{ margin: 0 }}>{t('manage_deductions')}</h2>
                            <button onClick={() => setIsManageDeductionsOpen(false)} style={{ border: 'none', background: 'none', fontSize: '1.5rem', cursor: 'pointer', color: '#64748b' }}>×</button>
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                            {dayOffHistory?.history.flatMap(y => y.requests).filter(r => r.deductionType === 'CREDIT').length === 0 ? (
                                <p style={{ textAlign: 'center', color: '#64748b' }}>{t('no_records_found')}</p>
                            ) : (
                                dayOffHistory?.history.flatMap(y => y.requests).filter(r => r.deductionType === 'CREDIT')
                                    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
                                    .map(req => (
                                        <div key={req.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '1.25rem', background: 'white', borderRadius: '1.25rem', border: '1px solid #e2e8f0' }}>
                                            <div>
                                                <div style={{ fontWeight: 'bold', fontSize: '1.05rem' }}>{t(req.type as any) || req.type}</div>
                                                <div style={{ fontSize: '0.85rem', color: '#64748b' }}>{new Date(req.date).toLocaleDateString(locale)}</div>
                                                {req.reason && <div style={{ fontSize: '0.85rem', color: '#94a3b8', fontStyle: 'italic' }}>{req.reason}</div>}
                                            </div>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                                                <div style={{ fontWeight: '800', fontSize: '1.2rem', color: '#dc2626' }}>-{req.daysDeducted}</div>
                                                <button
                                                    onClick={() => { setSelectedRequest(req); setReevaluateValue(req.daysDeducted.toString()); setIsReevaluateModalOpen(true); }}
                                                    className="btn glass"
                                                    style={{ fontSize: '0.85rem' }}
                                                >
                                                    {t('reevaluate')}
                                                </button>
                                            </div>
                                        </div>
                                    ))
                            )}
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}

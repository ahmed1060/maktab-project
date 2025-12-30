'use client'
import { useState, useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { useLanguage } from '@/context/LanguageContext'
import { useSession } from 'next-auth/react'

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

interface SalaryAdjustment {
    id: string
    type: 'BONUS' | 'DEDUCTION'
    amount: number
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

    useEffect(() => {
        const fetchData = async () => {
            try {
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
            } catch (error) {
                console.error('Error fetching data:', error)
            } finally {
                setLoading(false)
            }
        }

        if (params.id) {
            fetchData()
        }
    }, [params.id])

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

    const getMonthName = (month: number) => {
        return new Date(2000, month - 1).toLocaleString(locale === 'ar' ? 'ar-EG' : 'en-US', { month: 'long' })
    }

    if (loading) return <div style={{ padding: '2rem', textAlign: locale === 'ar' ? 'right' : 'left' }}>{t('loading_filters')}</div>

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
                    <h1 style={{ margin: 0 }}>{t('salary_history')}</h1>
                    {isAdmin && (
                        <button
                            onClick={() => { setIsAdjustmentsModalOpen(true); fetchAdjustments(); }}
                            className="btn btn-primary"
                        >
                            {t('manage_adjustments' as any)}
                        </button>
                    )}
                </div>
                {employee && (
                    <div style={{ fontSize: '1.2rem', color: '#475569', textAlign: locale === 'ar' ? 'right' : 'left' }}>
                        <p style={{ margin: 0 }}>{t('for_label')}: <strong>{employee.firstName} {employee.lastName}</strong></p>
                        {employee.salary !== undefined && (
                            <p style={{ margin: '0.25rem 0 0 0', fontSize: '1rem' }}>{t('current_base_salary')}: <strong>{employee.salary} {t('egp')}</strong></p>
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
                                            {record.deductions > 0 ? `-${record.deductions} ${t('days_label')}` : '-'}
                                        </td>
                                        <td style={{ padding: '1rem', color: '#7c3aed', fontWeight: '500', textAlign: locale === 'ar' ? 'right' : 'left' }}>
                                            {record.bonusDays ? `+${record.bonusDays} ${t('days_label')}` : '-'}
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
                                    <div key={adj.id} style={{
                                        position: 'relative',
                                        padding: '1.25rem',
                                        borderRadius: '1rem',
                                        background: 'white',
                                        border: '1px solid #e2e8f0',
                                        display: 'flex',
                                        justifyContent: 'space-between',
                                        alignItems: 'center'
                                    }}>
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
                                                {adj.type === 'BONUS' ? `+${adj.amount}` : `-${adj.amount}`} {t('days_label')}
                                            </div>
                                            <div style={{ fontSize: '0.875rem', color: '#64748b' }}>
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
        </div>
    )
}

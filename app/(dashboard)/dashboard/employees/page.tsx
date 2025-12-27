'use client'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { useSession } from 'next-auth/react'
import SortControl from '@/components/SortControl'
import { useCompany } from '@/context/CompanyContext'
import AccessDenied from '@/components/AccessDenied'
import Modal from '@/components/Modal'
import { useLanguage } from '@/context/LanguageContext'

interface Employee {
    id: string
    firstName: string
    lastName: string
    email: string
    role: string
    status: string
    totalDifficultyPoints: number
    gender?: string
    avatar?: string | null
}

export default function EmployeesPage() {
    const { t, locale } = useLanguage()
    const [employees, setEmployees] = useState<Employee[]>([])
    const [loading, setLoading] = useState(true)
    const router = useRouter()
    const { data: session } = useSession()
    const userRole = session?.user?.role || ''
    const { selectedCompanyId } = useCompany()

    const fetchEmployees = async () => {
        const query = selectedCompanyId ? `?companyId=${selectedCompanyId}` : ''
        const res = await fetch(`/api/users${query}`, { cache: 'no-store' })
        const data = await res.json()
        const filteredData = data.filter((u: Employee) => u.id !== (session?.user?.id || '') && u.role !== 'SUPER_ADMIN')
        setEmployees(filteredData)
        setLoading(false)
    }

    const [sortBy, setSortBy] = useState('name')
    const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc')
    const [searchQuery, setSearchQuery] = useState('')
    const [roleFilter, setRoleFilter] = useState('')
    const [alert, setAlert] = useState<{ type: 'success' | 'error'; message: string } | null>(null)
    const [deleteConfirm, setDeleteConfirm] = useState<{ id: string; name: string } | null>(null)
    const [resettingPoints, setResettingPoints] = useState<string | null>(null)
    const [deletingUser, setDeletingUser] = useState<string | null>(null)
    const [togglingStatus, setTogglingStatus] = useState<string | null>(null)

    const filteredEmployees = employees.filter(emp => {
        if (roleFilter && emp.role !== roleFilter) return false
        if (searchQuery) {
            const query = searchQuery.toLowerCase()
            return (
                emp.firstName.toLowerCase().includes(query) ||
                emp.lastName.toLowerCase().includes(query) ||
                emp.email.toLowerCase().includes(query)
            )
        }
        return true
    })

    const sortedEmployees = [...filteredEmployees].sort((a, b) => {
        let comparison = 0
        switch (sortBy) {
            case 'name':
                comparison = a.firstName.localeCompare(b.firstName)
                break
            case 'role':
                const rolePriority: { [key: string]: number } = {
                    'EMPLOYEE': 1, 'TEAM_LEADER': 2, 'ADMIN': 3, 'SUPER_ADMIN': 4
                }
                comparison = (rolePriority[a.role] || 99) - (rolePriority[b.role] || 99)
                break
            case 'points':
                comparison = (a.totalDifficultyPoints || 0) - (b.totalDifficultyPoints || 0)
                break
            default:
                comparison = 0
        }
        return sortOrder === 'asc' ? comparison : -comparison
    })

    useEffect(() => {
        if (session?.user) {
            fetchEmployees()
        }
    }, [session, selectedCompanyId])

    const handleDelete = async (id: string, name: string) => {
        setDeleteConfirm({ id, name })
    }

    const confirmDelete = async () => {
        if (!deleteConfirm) return

        setDeletingUser(deleteConfirm.id)
        try {
            const res = await fetch(`/api/users?id=${deleteConfirm.id}`, {
                method: 'DELETE'
            })

            if (res.ok) {
                setEmployees(prev => prev.filter(emp => emp.id !== deleteConfirm.id))
                setDeleteConfirm(null)
            } else {
                const data = await res.json()
                window.alert(data.error || t('error_generic'))
            }
        } catch (err) {
            console.error('Delete error:', err)
            window.alert(t('error_generic'))
        } finally {
            setDeletingUser(null)
            setDeleteConfirm(null)
        }
    }

    const handleResetPoints = async (id: string) => {
        setResettingPoints(id)
        try {
            const res = await fetch(`/api/users/${id}/reset-points`, {
                method: 'POST'
            })

            if (res.ok) {
                setEmployees(prevEmployees =>
                    prevEmployees.map(emp =>
                        emp.id === id ? { ...emp, totalDifficultyPoints: 0 } : emp
                    )
                )
                setAlert({ type: 'success', message: t('points_reset_success') })
                setTimeout(() => setAlert(null), 3000)
            } else {
                const data = await res.json()
                setAlert({ type: 'error', message: data.error || t('points_reset_failed') })
                setTimeout(() => setAlert(null), 5000)
            }
        } catch (err) {
            console.error('Reset points error:', err)
            setAlert({ type: 'error', message: t('error_generic') })
            setTimeout(() => setAlert(null), 5000)
        } finally {
            setResettingPoints(null)
        }
    }

    const handleStatusToggle = async (id: string, currentStatus: string) => {
        const newStatus = currentStatus === 'ACTIVE' ? 'SUSPENDED' : 'ACTIVE'
        setTogglingStatus(id)
        try {
            const res = await fetch('/api/users', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id, status: newStatus })
            })
            if (res.ok) {
                setEmployees(prev => prev.map(emp =>
                    emp.id === id ? { ...emp, status: newStatus } : emp
                ))
            } else {
                window.alert(t('error_generic'))
            }
        } catch (err) {
            console.error('Status toggle error:', err)
            window.alert(t('error_generic'))
        } finally {
            setTogglingStatus(null)
        }
    }

    const getRoleStyles = (role: string) => {
        switch (role) {
            case 'ADMIN':
                return { background: '#fef3c7', color: '#92400e' }
            case 'TEAM_LEADER':
                return { background: '#ede9fe', color: '#5b21b6' }
            case 'EMPLOYEE':
                return { background: '#f1f5f9', color: '#475569' }
            default:
                return { background: '#f1f5f9', color: '#475569' }
        }
    }

    if (loading) {
        return <div>{t('loading_filters')}</div>
    }

    if (userRole === 'EMPLOYEE') {
        return <AccessDenied />
    }

    return (
        <div>
            {alert && (
                <div style={{
                    position: 'fixed',
                    top: '2rem',
                    right: locale === 'ar' ? 'auto' : '2rem',
                    left: locale === 'ar' ? '2rem' : 'auto',
                    padding: '0.75rem 1.25rem',
                    borderRadius: '0.5rem',
                    background: alert.type === 'success' ? '#dcfce7' : '#fee2e2',
                    color: alert.type === 'success' ? '#166534' : '#991b1b',
                    border: `1px solid ${alert.type === 'success' ? '#86efac' : '#fca5a5'}`,
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.5rem',
                    fontSize: '0.875rem',
                    fontWeight: '500',
                    boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)',
                    zIndex: 1000,
                    minWidth: '250px',
                    maxWidth: '350px',
                    animation: 'slideInRight 0.3s ease-out'
                }}>
                    <span style={{ fontSize: '1rem' }}>
                        {alert.type === 'success' ? '✓' : '✕'}
                    </span>
                    {alert.message}
                </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', marginBottom: '1.5rem' }}>
                {['ADMIN', 'SUPER_ADMIN'].includes(userRole) && (
                    <Link href="/dashboard/employees/new" className="btn btn-primary" style={{ textDecoration: 'none' }}>
                        {t('add_employee')}
                    </Link>
                )}
            </div>

            <div style={{
                marginBottom: '2rem',
                display: 'flex',
                gap: '1rem',
                flexWrap: 'wrap',
                alignItems: 'center'
            }}>
                <div style={{
                    background: 'white',
                    padding: '0.5rem',
                    borderRadius: '1rem',
                    border: '1px solid #e2e8f0',
                    boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
                    width: '300px',
                    position: 'relative'
                }}>
                    <div style={{ position: 'absolute', [locale === 'ar' ? 'right' : 'left']: '1rem', top: '50%', transform: 'translateY(-50%)', color: '#94a3b8' }}>
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <circle cx="11" cy="11" r="8"></circle>
                            <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
                        </svg>
                    </div>
                    <input
                        type="text"
                        placeholder={t('search_employees')}
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        style={{
                            width: '100%',
                            padding: locale === 'ar' ? '0.75rem 3rem 0.75rem 1rem' : '0.75rem 1rem 0.75rem 3rem',
                            borderRadius: '0.75rem',
                            border: 'none',
                            fontSize: '1rem',
                            outline: 'none',
                            background: 'transparent',
                            textAlign: locale === 'ar' ? 'right' : 'left'
                        }}
                    />
                </div>

                <div style={{
                    background: 'white',
                    padding: '0.5rem',
                    borderRadius: '1rem',
                    border: '1px solid #e2e8f0',
                    boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
                    position: 'relative',
                    minWidth: '200px'
                }}>
                    <div style={{ position: 'absolute', [locale === 'ar' ? 'right' : 'left']: '1rem', top: '50%', transform: 'translateY(-50%)', color: '#64748b' }}>
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
                            <circle cx="12" cy="7" r="4"></circle>
                        </svg>
                    </div>
                    <select
                        value={roleFilter}
                        onChange={(e) => setRoleFilter(e.target.value)}
                        style={{
                            width: '100%',
                            padding: locale === 'ar' ? '0.75rem 3rem 0.75rem 2.5rem' : '0.75rem 2.5rem 0.75rem 3rem',
                            borderRadius: '0.75rem',
                            border: 'none',
                            fontSize: '0.875rem',
                            outline: 'none',
                            backgroundColor: 'transparent',
                            cursor: 'pointer',
                            appearance: 'none',
                            backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 24 24' stroke='%2364748b'%3E%3Cpath stroke-linecap='round' stroke-linejoin='round' stroke-width='2' d='M19 9l-7 7-7-7'%3E%3C/path%3E%3C/svg%3E")`,
                            backgroundRepeat: 'no-repeat',
                            backgroundPosition: locale === 'ar' ? 'left 1rem center' : 'right 1rem center',
                            backgroundSize: '1.25rem',
                            textAlign: locale === 'ar' ? 'right' : 'left'
                        }}
                    >
                        <option value="">{t('all_roles')}</option>
                        <option value="EMPLOYEE">{t('role_employee')}</option>
                        <option value="TEAM_LEADER">{t('role_team_leader')}</option>
                        <option value="ADMIN">{t('role_admin')}</option>
                    </select>
                </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '1.5rem' }}>
                <SortControl
                    options={[
                        { label: t('name_label'), value: 'name' },
                        { label: t('role_admin'), value: 'role' },
                        { label: t('points_label'), value: 'points' },
                    ]}
                    sortBy={sortBy}
                    sortOrder={sortOrder}
                    onSortChange={(field, order) => { setSortBy(field); setSortOrder(order) }}
                />
            </div>

            <div style={{ display: 'grid', gap: '1rem' }}>
                {sortedEmployees.length === 0 ? (
                    <p>{t('no_employees_found')}</p>
                ) : (
                    sortedEmployees.map(emp => (
                        <div key={emp.id} className="card">
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                <div style={{ flex: 1 }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                                        <div
                                            onClick={() => userRole === 'SUPER_ADMIN' && handleStatusToggle(emp.id, emp.status || 'OFFLINE')}
                                            title={userRole === 'SUPER_ADMIN' ? (emp.status === 'SUSPENDED' ? t('status_suspended_msg') : emp.status === 'ACTIVE' ? t('status_online_msg') : t('status_offline_msg')) : (emp.status === 'SUSPENDED' ? t('status_suspended_msg') : emp.status === 'ACTIVE' ? t('status_online_msg') : t('status_offline_msg'))}
                                            style={{
                                                width: '12px',
                                                height: '12px',
                                                borderRadius: '50%',
                                                background: emp.status === 'SUSPENDED' ? '#ef4444' : emp.status === 'ACTIVE' ? '#22c55e' : emp.status === 'OFFLINE' ? '#f59e0b' : '#94a3b8',
                                                cursor: userRole === 'SUPER_ADMIN' ? 'pointer' : 'default',
                                                flexShrink: 0,
                                                boxShadow: `0 0 0 2px ${emp.status === 'SUSPENDED' ? '#fecaca' : emp.status === 'ACTIVE' ? '#bbf7d0' : emp.status === 'OFFLINE' ? '#fef9c3' : '#e2e8f0'}`
                                            }}
                                        />
                                        <Link href={`/dashboard/employees/${emp.id}?mode=view`} style={{ textDecoration: 'none', color: 'inherit' }}>
                                            <h3 style={{ margin: 0, cursor: 'pointer' }} className="hover:text-blue-600 transition-colors">
                                                {emp.firstName} {emp.lastName}
                                            </h3>
                                        </Link>
                                        <span style={{
                                            padding: '0.25rem 0.75rem',
                                            borderRadius: '9999px',
                                            background: '#dbeafe',
                                            color: '#1e40af',
                                            fontSize: '0.875rem',
                                            fontWeight: '600'
                                        }}>
                                            {emp.totalDifficultyPoints || 0} {t('pts')}
                                        </span>
                                    </div>
                                    <p style={{ margin: '0.5rem 0 0 0', color: '#64748b', fontSize: '0.875rem' }}>{emp.email}</p>
                                    {emp.role && (
                                        <span style={{
                                            display: 'inline-block',
                                            marginTop: '0.25rem',
                                            padding: '0.125rem 0.5rem',
                                            borderRadius: '0.25rem',
                                            fontSize: '0.75rem',
                                            fontWeight: 'bold',
                                            ...getRoleStyles(emp.role)
                                        }}>
                                            {t(`role_${emp.role.toLowerCase()}` as any) || emp.role}
                                        </span>
                                    )}
                                </div>
                                <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                                    {['ADMIN', 'SUPER_ADMIN'].includes(userRole) && (
                                        <>
                                            <Link
                                                href={`/dashboard/employees/${emp.id}`}
                                                className="btn"
                                                style={{
                                                    background: '#dbeafe',
                                                    color: '#1e40af',
                                                    padding: '0.5rem 1rem',
                                                    fontSize: '0.875rem',
                                                    textDecoration: 'none'
                                                }}
                                            >
                                                {t('edit')}
                                            </Link>
                                            <Link
                                                href={`/dashboard/employees/${emp.id}/history`}
                                                className="btn"
                                                style={{
                                                    background: '#dcfce7',
                                                    color: '#166534',
                                                    padding: '0.5rem 1rem',
                                                    fontSize: '0.875rem',
                                                    textDecoration: 'none'
                                                }}
                                            >
                                                {t('history')}
                                            </Link>
                                            <Link
                                                href={`/dashboard/employees/${emp.id}/bonus`}
                                                className="btn"
                                                style={{
                                                    background: '#ede9fe',
                                                    color: '#5b21b6',
                                                    padding: '0.5rem 1rem',
                                                    fontSize: '0.875rem',
                                                    textDecoration: 'none'
                                                }}
                                            >
                                                {t('add_bonus')}
                                            </Link>
                                            <Link
                                                href={`/dashboard/employees/${emp.id}/deduction`}
                                                className="btn"
                                                style={{
                                                    background: '#fee2e2',
                                                    color: '#991b1b',
                                                    padding: '0.5rem 1rem',
                                                    fontSize: '0.875rem',
                                                    textDecoration: 'none'
                                                }}
                                            >
                                                {t('add_deduction')}
                                            </Link>
                                            <button
                                                onClick={() => handleResetPoints(emp.id)}
                                                disabled={resettingPoints === emp.id}
                                                className="btn"
                                                style={{
                                                    background: resettingPoints === emp.id ? '#fde68a' : '#fef3c7',
                                                    color: '#92400e',
                                                    padding: '0.5rem 1rem',
                                                    fontSize: '0.875rem',
                                                    cursor: resettingPoints === emp.id ? 'not-allowed' : 'pointer',
                                                    opacity: resettingPoints === emp.id ? 0.7 : 1
                                                }}
                                            >
                                                {resettingPoints === emp.id ? t('resetting') : t('reset_points')}
                                            </button>
                                            {emp.role !== 'SUPER_ADMIN' && (
                                                <button
                                                    onClick={() => handleDelete(emp.id, `${emp.firstName} ${emp.lastName}`)}
                                                    disabled={deletingUser === emp.id}
                                                    className="btn"
                                                    style={{
                                                        background: deletingUser === emp.id ? '#fca5a5' : '#fee2e2',
                                                        color: '#991b1b',
                                                        padding: '0.5rem 1rem',
                                                        fontSize: '0.875rem',
                                                        cursor: deletingUser === emp.id ? 'not-allowed' : 'pointer',
                                                        opacity: deletingUser === emp.id ? 0.7 : 1
                                                    }}
                                                >
                                                    {deletingUser === emp.id ? t('deleting') : t('delete')}
                                                </button>
                                            )}
                                        </>
                                    )}
                                </div>
                            </div>
                        </div>
                    ))
                )}
            </div>

            <Modal
                isOpen={!!deleteConfirm}
                onClose={() => setDeleteConfirm(null)}
                title={t('confirm_delete')}
                hideFooter={true}
            >
                <div>
                    <p style={{ margin: '0 0 1rem 0', color: '#64748b' }}>
                        {t('delete_warning')} <strong>{deleteConfirm?.name}</strong>?
                    </p>
                    <p style={{ color: '#991b1b', fontSize: '0.875rem', marginBottom: '1.5rem', background: '#fee2e2', padding: '0.5rem', borderRadius: '0.25rem' }}>
                        {t('undone_warning')}
                    </p>
                    <div style={{ display: 'flex', gap: '1rem', justifyContent: 'flex-end' }}>
                        <button
                            onClick={() => setDeleteConfirm(null)}
                            className="btn"
                            style={{ background: '#e2e8f0', color: '#0f172a' }}
                        >
                            {t('cancel')}
                        </button>
                        <button
                            onClick={confirmDelete}
                            className="btn"
                            style={{ background: '#dc2626', color: 'white' }}
                        >
                            {t('delete_employee')}
                        </button>
                    </div>
                </div>
            </Modal>
        </div>
    )
}

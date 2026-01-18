'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { useSession } from 'next-auth/react'
import EmployeeFilter from '@/components/EmployeeFilter'
import { useCompany } from '@/context/CompanyContext'
import AccessDenied from '@/components/AccessDenied'
import Modal from '@/components/Modal'
import Pagination from '@/components/Pagination'
import { useLanguage } from '@/context/LanguageContext'
import LoadingSpinner from '@/components/LoadingSpinner'

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
    const { data: session } = useSession()
    const userRole = session?.user?.role || ''
    const { selectedCompanyId } = useCompany()

    const [page, setPage] = useState(1)
    const [totalPages, setTotalPages] = useState(0)
    const [totalEmployees, setTotalEmployees] = useState(0)
    const limit = 10

    const [sortBy, setSortBy] = useState('name')
    const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc')
    const [searchQuery, setSearchQuery] = useState('')
    const [roleFilter, setRoleFilter] = useState('')
    const [filters, setFilters] = useState({ search: '', status: '', dateFrom: '', dateTo: '', employeeId: '' })
    const [alert, setAlert] = useState<{ type: 'success' | 'error'; message: string } | null>(null)
    const [deleteConfirm, setDeleteConfirm] = useState<{ id: string; name: string } | null>(null)
    const [resettingPoints, setResettingPoints] = useState<string | null>(null)
    const [deletingUser, setDeletingUser] = useState<string | null>(null)
    const [togglingStatus, setTogglingStatus] = useState<string | null>(null)

    const fetchEmployees = useCallback(async () => {
        setLoading(true)
        const queryParams = new URLSearchParams()
        if (selectedCompanyId) queryParams.set('companyId', selectedCompanyId)
        queryParams.set('page', page.toString())
        queryParams.set('limit', limit.toString())
        queryParams.set('excludeRole', 'SUPER_ADMIN')
        if (session?.user?.role === 'TEAM_LEADER') {
            queryParams.set('excludeRole', 'ADMIN,SUPER_ADMIN')
        }
        if (session?.user?.id) queryParams.set('excludeUserId', (session.user as any).id)
        if (filters.search) queryParams.set('search', filters.search)
        if (filters.status) queryParams.set('status', filters.status)

        try {
            const res = await fetch(`/api/users?${queryParams.toString()}`, { cache: 'no-store' })
            const result = await res.json()
            setEmployees(result.data)
            setTotalPages(result.totalPages)
            setTotalEmployees(result.total)
        } catch (error) {
            console.error('Fetch error:', error)
        } finally {
            setLoading(false)
        }
    }, [selectedCompanyId, page, limit, session?.user?.id, filters.search, filters.status])

    const filteredEmployees = employees

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
    }, [session, selectedCompanyId, page, filters.search, filters.status])

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

    if (loading && employees.length === 0) {
        return <LoadingSpinner message={t('loading_users')} />
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

            <EmployeeFilter
                onFilterChange={(newFilters) => {
                    setFilters(prev => ({ ...prev, ...newFilters }))
                    setSearchQuery(newFilters.search)
                    setPage(1)
                }}
                selectedEmployeeId={''}
                hideEmployeeFilter={true}
                hideDateFilter={true}
                dateFrom={''}
                dateTo={''}
                selectedStatus={filters.status}
                searchQuery={searchQuery}
                placeholder={locale === 'ar' ? 'بحث بالاسم أو البريد الإلكتروني' : 'Search Name or Email'}
                totalCount={totalEmployees}
                showRoleFilter={true}
                selectedRole={roleFilter}
                onRoleChange={setRoleFilter}
                sortBy={sortBy}
                sortOrder={sortOrder}
                onSortChange={(field, order) => { setSortBy(field); setSortOrder(order) }}
                sortOptions={[
                    { label: t('name_label'), value: 'name' },
                    { label: t('role_label' as any) || 'Role', value: 'role' },
                    { label: t('points_label'), value: 'points' },
                ]}
                statusOptions={[
                    { label: t('status_online'), value: 'ACTIVE' },
                    { label: t('status_offline'), value: 'OFFLINE' },
                    ...(userRole === 'SUPER_ADMIN' ? [{ label: t('status_suspended'), value: 'SUSPENDED' }] : [])
                ]}
                primaryAction={
                    ['ADMIN', 'SUPER_ADMIN'].includes(userRole) && (
                        <Link href="/dashboard/employees/new" className="btn btn-primary" style={{ height: '48px', display: 'flex', alignItems: 'center', borderRadius: '1.25rem', textDecoration: 'none' }}>
                            {t('add_employee')}
                        </Link>
                    )
                }
            />

            <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(350px, 1fr))',
                gap: '1rem',
                marginBottom: '2rem',
                opacity: loading ? 0.6 : 1,
                pointerEvents: loading ? 'none' : 'auto',
                transition: 'opacity 0.2s ease-in-out'
            }}>
                {sortedEmployees.length === 0 ? (
                    <div className="glass-card flex flex-col items-center justify-center py-16 text-center text-slate-500 col-span-full">
                        <span className="text-5xl mb-4">👥</span>
                        <h3 className="text-xl font-bold text-slate-800">{t('no_employees_found')}</h3>
                    </div>
                ) : (
                    sortedEmployees.map((emp, index) => (
                        <div
                            key={emp.id}
                            className="glass-card hover:bg-white/60 transition-all duration-300 p-5 border border-white/40 shadow-sm relative overflow-hidden flex flex-col gap-4"
                            style={{
                                animation: 'fadeIn 0.4s ease-out forwards',
                                animationDelay: `${index * 50}ms`
                            }}
                        >
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                                    <div
                                        onClick={() => userRole === 'SUPER_ADMIN' && handleStatusToggle(emp.id, emp.status || 'OFFLINE')}
                                        title={emp.status === 'SUSPENDED' ? t('status_suspended_msg') : emp.status === 'ACTIVE' ? t('status_online_msg') : t('status_offline_msg')}
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
                                    <div style={{ display: 'flex', flexDirection: 'column' }}>
                                        <Link href={`/dashboard/employees/${emp.id}?mode=view`} style={{ textDecoration: 'none', color: 'inherit' }}>
                                            <h3 className="text-lg font-bold text-slate-800 leading-tight hover:text-blue-600 transition-colors">
                                                {emp.firstName} {emp.lastName}
                                            </h3>
                                        </Link>
                                        <p style={{ margin: 0, color: '#64748b', fontSize: '0.85rem' }}>{emp.email}</p>
                                    </div>
                                </div>
                                {emp.role !== 'ADMIN' && (
                                    <span style={{
                                        padding: '0.375rem 0.75rem',
                                        borderRadius: '1rem',
                                        background: '#eff6ff',
                                        color: '#1e40af',
                                        fontSize: '0.85rem',
                                        fontWeight: '800'
                                    }}>
                                        {emp.totalDifficultyPoints || 0} {t('pts')}
                                    </span>
                                )}
                            </div>

                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                <span style={{
                                    display: 'inline-block',
                                    padding: '0.25rem 0.625rem',
                                    borderRadius: '0.5rem',
                                    fontSize: '0.75rem',
                                    fontWeight: '800',
                                    textTransform: 'uppercase',
                                    letterSpacing: '0.025em',
                                    ...getRoleStyles(emp.role)
                                }}>
                                    {t(`role_${emp.role.toLowerCase()}` as any) || emp.role}
                                </span>
                                {emp.status === 'SUSPENDED' && (
                                    <span style={{
                                        padding: '0.25rem 0.625rem',
                                        borderRadius: '0.5rem',
                                        fontSize: '0.75rem',
                                        fontWeight: '800',
                                        background: '#fee2e2',
                                        color: '#991b1b',
                                        textTransform: 'uppercase'
                                    }}>
                                        {t('suspended' as any)}
                                    </span>
                                )}
                            </div>

                            {['ADMIN', 'SUPER_ADMIN'].includes(userRole) && (
                                <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginTop: 'auto', paddingTop: '1rem', borderTop: '1px dashed #e2e8f0' }}>
                                    {(emp.role !== 'ADMIN' || userRole === 'SUPER_ADMIN') && (
                                        <Link
                                            href={`/dashboard/employees/${emp.id}`}
                                            className="btn"
                                            style={{
                                                background: '#f8fafc',
                                                color: '#475569',
                                                padding: '0.5rem 0.75rem',
                                                fontSize: '0.8rem',
                                                fontWeight: '700',
                                                textDecoration: 'none',
                                                borderRadius: '0.75rem',
                                                border: '1px solid #e2e8f0',
                                                flex: 1,
                                                textAlign: 'center'
                                            }}
                                        >
                                            {t('edit')}
                                        </Link>
                                    )}
                                    {emp.role !== 'ADMIN' && (
                                        <Link
                                            href={`/dashboard/employees/${emp.id}/history`}
                                            className="btn"
                                            style={{
                                                background: '#f8fafc',
                                                color: '#475569',
                                                padding: '0.5rem 0.75rem',
                                                fontSize: '0.8rem',
                                                fontWeight: '700',
                                                textDecoration: 'none',
                                                borderRadius: '0.75rem',
                                                border: '1px solid #e2e8f0',
                                                flex: 1,
                                                textAlign: 'center'
                                            }}
                                        >
                                            {t('history')}
                                        </Link>
                                    )}
                                    {emp.role !== 'ADMIN' && (
                                        <>
                                            <div style={{ display: 'flex', gap: '0.5rem', width: '100%' }}>
                                                <Link
                                                    href={`/dashboard/employees/${emp.id}/bonus`}
                                                    className="btn"
                                                    style={{
                                                        background: '#f0fdf4',
                                                        color: '#166534',
                                                        padding: '0.5rem 0.75rem',
                                                        fontSize: '0.8rem',
                                                        fontWeight: '800',
                                                        textDecoration: 'none',
                                                        borderRadius: '0.75rem',
                                                        flex: 1,
                                                        textAlign: 'center'
                                                    }}
                                                >
                                                    + {t('add_bonus')}
                                                </Link>
                                                <Link
                                                    href={`/dashboard/employees/${emp.id}/deduction`}
                                                    className="btn"
                                                    style={{
                                                        background: '#fef2f2',
                                                        color: '#991b1b',
                                                        padding: '0.5rem 0.75rem',
                                                        fontSize: '0.8rem',
                                                        fontWeight: '800',
                                                        textDecoration: 'none',
                                                        borderRadius: '0.75rem',
                                                        flex: 1,
                                                        textAlign: 'center'
                                                    }}
                                                >
                                                    - {t('add_deduction')}
                                                </Link>
                                            </div>
                                            <button
                                                onClick={() => handleResetPoints(emp.id)}
                                                disabled={resettingPoints === emp.id}
                                                className="btn"
                                                style={{
                                                    background: '#fffbeb',
                                                    color: '#92400e',
                                                    padding: '0.5rem 0.75rem',
                                                    fontSize: '0.8rem',
                                                    fontWeight: '700',
                                                    borderRadius: '0.75rem',
                                                    flex: 1,
                                                    opacity: resettingPoints === emp.id ? 0.7 : 1
                                                }}
                                            >
                                                {resettingPoints === emp.id ? t('resetting') : t('reset_points')}
                                            </button>
                                        </>
                                    )}
                                    {emp.role !== 'SUPER_ADMIN' && (
                                        <button
                                            onClick={() => handleDelete(emp.id, `${emp.firstName} ${emp.lastName}`)}
                                            disabled={deletingUser === emp.id}
                                            className="btn"
                                            style={{
                                                background: '#fee2e2',
                                                color: '#dc2626',
                                                padding: '0.5rem 0.75rem',
                                                fontSize: '0.8rem',
                                                fontWeight: '700',
                                                borderRadius: '0.75rem',
                                                flex: 1,
                                                opacity: deletingUser === emp.id ? 0.7 : 1
                                            }}
                                        >
                                            {deletingUser === emp.id ? t('deleting') : t('delete')}
                                        </button>
                                    )}
                                </div>
                            )}
                        </div>
                    ))
                )}
            </div>

            <Pagination
                currentPage={page}
                totalPages={totalPages}
                onPageChange={(p) => setPage(p)}
            />

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

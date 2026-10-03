'use client'

import { useState, useEffect } from 'react'
import useSWR from 'swr'
import Link from 'next/link'
import { useSession } from 'next-auth/react'
import EmployeeFilter from '@/components/EmployeeFilter'
import { useCompany } from '@/context/CompanyContext'
import AccessDenied from '@/components/AccessDenied'
import Modal from '@/components/Modal'
import Pagination from '@/components/Pagination'
import { useLanguage } from '@/context/LanguageContext'
import { useModules } from '@/lib/useModules'
import { useHeader } from '@/context/HeaderContext'
import LoadingSpinner from '@/components/LoadingSpinner'
import { fetcher } from '@/lib/swr-fetcher'
import NoticeModal, { Notice } from '@/components/NoticeModal'
import { useCan } from '@/lib/useCan'

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
    username?: string
    teamLeaderId?: string | null
    // Just the name. The API selects these three fields rather than the
    // relation, so a colleague's whole row does not ride along in a list that
    // only prints a name.
    teamLeader?: { id: string; firstName: string; lastName: string } | null
}

export default function EmployeesPage() {
    const { t, locale } = useLanguage()
    const { setTitle, setSubtitle } = useHeader()
    const modules = useModules()
    const { data: session } = useSession()
    const userRole = session?.user?.role || ''
    const { can, companyWide } = useCan()
    // The actions under each person, each offered with the permission its
    // route checks; the row of them is shown when any is.
    const canActOnPeople = can('employees.edit') || can('salary.view') || can('salary_adjustments.manage')
        || can('requests.reset_points') || can('employees.delete')
    const { selectedCompanyId } = useCompany()

    const [page, setPage] = useState(1)
    const limit = 10

    const [sortBy, setSortBy] = useState('name')
    const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc')
    const [searchQuery, setSearchQuery] = useState('')
    const [roleFilter, setRoleFilter] = useState('')
    const [filters, setFilters] = useState({ search: '', status: '', dateFrom: '', dateTo: '', employeeId: '' })
    const [alert, setAlert] = useState<{ type: 'success' | 'error'; message: string } | null>(null)
    // Bulk team assignment. A Set rather than an array because the only two
    // operations are "is this one picked" and "toggle it".
    const [picked, setPicked] = useState<Set<string>>(new Set())
    const [bulkLeaderId, setBulkLeaderId] = useState('')
    const [bulkSaving, setBulkSaving] = useState(false)
    const [teamFilter, setTeamFilter] = useState('')
    const [teamLeaders, setTeamLeaders] = useState<{ id: string; firstName: string; lastName: string }[]>([])
    const [deleteConfirm, setDeleteConfirm] = useState<{ id: string; name: string } | null>(null)
    // Replaces alert(): a native dialog ignores the palette entirely, and it
    // blocks the main thread for as long as it is up.
    const [notice, setNotice] = useState<Notice | null>(null)
    const [resettingPoints, setResettingPoints] = useState<string | null>(null)
    const [deletingUser, setDeletingUser] = useState<string | null>(null)
    const [, setTogglingStatus] = useState<string | null>(null)

    // F-25: was a useState + useCallback + useEffect fetch cycle. SWR keys
    // on this query string, so any change to page/filters/company below
    // automatically triggers a re-fetch — no manual dependency array to
    // keep in sync.
    const queryKey = (() => {
        if (!session?.user) return null
        const queryParams = new URLSearchParams()
        if (selectedCompanyId) queryParams.set('companyId', selectedCompanyId)
        queryParams.set('page', page.toString())
        queryParams.set('limit', limit.toString())
        // Someone who sees only a team does not list the company's Admins.
        queryParams.set('excludeRole', can('employees.view') && !companyWide('employees.view') ? 'ADMIN,SUPER_ADMIN' : 'SUPER_ADMIN')
        if ((session.user as any).id) queryParams.set('excludeUserId', (session.user as any).id)
        if (filters.search) queryParams.set('search', filters.search)
        if (filters.status) queryParams.set('status', filters.status)
        // Filtering rather than grouping, deliberately. This list is paginated,
        // and a team's members do not fall on one page — a grouped view would
        // show the same team heading on page one and page three with different
        // people under it. Filtering asks the server for one team and pages
        // through that, which is the question an Admin actually has.
        if (teamFilter) queryParams.set('teamLeaderId', teamFilter)
        return `/api/users?${queryParams.toString()}`
    })()

    const { data: result, isLoading, isValidating, mutate } = useSWR(queryKey, fetcher)
    const employees: Employee[] = result?.data?.data || []
    const totalPages: number = result?.data?.totalPages || 0
    const totalEmployees: number = result?.data?.total || 0
    const loading = isLoading || isValidating

    const canAssignTeams = can('employees.assign_team')

    useEffect(() => {
        if (!canAssignTeams) return
        fetch('/api/users?role=TEAM_LEADER&limit=1000')
            .then(r => r.json())
            .then(d => setTeamLeaders(d.data?.data || []))
            .catch(() => { /* the picker simply stays empty */ })
    }, [canAssignTeams])

    const togglePicked = (id: string) => {
        setPicked(prev => {
            const next = new Set(prev)
            if (next.has(id)) next.delete(id)
            else next.add(id)
            return next
        })
    }

    const applyBulkTeam = async () => {
        setBulkSaving(true)
        try {
            const res = await fetch('/api/users/team', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                // Empty option means unassign, so it goes as null — the same
                // three states the single-employee form and the server use.
                body: JSON.stringify({ userIds: [...picked], teamLeaderId: bulkLeaderId || null }),
            })
            const body = await res.json().catch(() => null)
            if (!res.ok) {
                setAlert({ type: 'error', message: body?.error || t('error_generic') })
                setTimeout(() => setAlert(null), 5000)
                return
            }
            setAlert({ type: 'success', message: t('bulk_assign_done').replace('{count}', String(body?.data?.updated ?? picked.size)) })
            setTimeout(() => setAlert(null), 3000)
            setPicked(new Set())
            setBulkLeaderId('')
            mutate()
        } catch {
            setAlert({ type: 'error', message: t('error_generic') })
            setTimeout(() => setAlert(null), 5000)
        } finally {
            setBulkSaving(false)
        }
    }

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
        setTitle(modules.label('employees'))
        setSubtitle(t('employees_subtitle' as any))
        return () => {
            setTitle(null)
            setSubtitle(null)
        }
    }, [setTitle, setSubtitle, t, modules])

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
                mutate()
                setDeleteConfirm(null)
            } else {
                const data = await res.json()
                setNotice({ variant: 'error', title: t('error_generic'), detail: data.error })
            }
        } catch (err) {
            console.error('Delete error:', err)
            setNotice({ variant: 'error', title: t('error_generic') })
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
                mutate()
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
        // An ended contract is not toggled back on by clicking a dot. It is
        // reinstated from the profile screen, deliberately, and that records
        // why — the timeline is meant to be readable back as what happened.
        if (currentStatus === 'ARCHIVED') return
        const newStatus = currentStatus === 'ACTIVE' ? 'SUSPENDED' : 'ACTIVE'
        setTogglingStatus(id)
        try {
            const res = await fetch('/api/users', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id, status: newStatus })
            })
            if (res.ok) {
                mutate()
            } else {
                setNotice({ variant: 'error', title: t('error_generic') })
            }
        } catch (err) {
            console.error('Status toggle error:', err)
            setNotice({ variant: 'error', title: t('error_generic') })
        } finally {
            setTogglingStatus(null)
        }
    }

    const getRoleStyles = (role: string) => {
        switch (role) {
            case 'ADMIN':
                return { background: 'var(--warn-bg)', color: 'var(--warn-fg)' }
            case 'TEAM_LEADER':
                return { background: 'var(--lifetime-bg)', color: 'var(--accent-fg)' }
            case 'EMPLOYEE':
                return { background: 'var(--surface-sunk)', color: 'var(--text-muted)' }
            default:
                return { background: 'var(--surface-sunk)', color: 'var(--text-muted)' }
        }
    }

    if (loading && employees.length === 0) {
        return <LoadingSpinner message={t('loading_users')} />
    }

    // Once the session is known: before it loads nobody holds anything, and
    // this would flash "access denied" at everyone on the way in.
    if (session?.user && !can('employees.view')) {
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
                    background: alert.type === 'success' ? 'var(--ok-bg)' : 'var(--danger-bg)',
                    color: alert.type === 'success' ? 'var(--ok-fg)' : 'var(--danger-fg)',
                    border: `1px solid ${alert.type === 'success' ? 'var(--ok-border)' : 'var(--danger-border-firm)'}`,
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.5rem',
                    fontSize: '0.875rem',
                    fontWeight: '500',
                    boxShadow: '0 4px 6px -1px var(--shadow-weak), 0 2px 4px -1px var(--shadow-faint)',
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
                teamOptions={canAssignTeams ? teamLeaders : []}
                selectedTeam={teamFilter}
                onTeamChange={(v) => { setTeamFilter(v); setPage(1) }}
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
                    can('employees.create') && (
                        <Link href="/dashboard/employees/new" className="btn btn-primary" style={{ height: '48px', display: 'flex', alignItems: 'center', borderRadius: '1.25rem', textDecoration: 'none' }}>
                            {t('add_employee')}
                        </Link>
                    )
                }
            />

            {canAssignTeams && picked.size > 0 && (
                <div className="card" style={{
                    display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '0.75rem',
                    padding: '0.75rem 1rem', marginBottom: '1rem',
                }}>
                    <strong style={{ whiteSpace: 'nowrap' }}>
                        {t('bulk_selected').replace('{count}', String(picked.size))}
                    </strong>
                    <select
                        aria-label={t('team_leader_label')}
                        className="input"
                        value={bulkLeaderId}
                        onChange={e => setBulkLeaderId(e.target.value)}
                        style={{ flex: '1 1 12rem', minWidth: 0, textAlign: locale === 'ar' ? 'right' : 'left' }}
                    >
                        <option value="">{t('team_leader_none')}</option>
                        {teamLeaders.map(l => (
                            <option key={l.id} value={l.id}>{l.firstName} {l.lastName}</option>
                        ))}
                    </select>
                    <button className="btn btn-primary" onClick={applyBulkTeam} disabled={bulkSaving}>
                        {bulkSaving ? t('saving') : t('bulk_assign_apply')}
                    </button>
                    <button className="btn" onClick={() => setPicked(new Set())} disabled={bulkSaving}>
                        {t('bulk_assign_clear')}
                    </button>
                </div>
            )}

            <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(min(350px, 100%), 1fr))',
                gap: '1rem',
                marginBottom: '2rem',
                opacity: loading ? 0.6 : 1,
                pointerEvents: loading ? 'none' : 'auto',
                transition: 'opacity 0.2s ease-in-out'
            }}>
                {sortedEmployees.length === 0 ? (
                    <div className="glass-card flex flex-col items-center justify-center py-16 text-center text-slate-500 col-span-full">
                        <span className="text-5xl mb-4">{modules.icon('employees')}</span>
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
                                    {/* Only employees have a team, so only
                                        employees are selectable. Offering a
                                        checkbox on a leader's card would
                                        promise something the server refuses. */}
                                    {canAssignTeams && emp.role === 'EMPLOYEE' && (
                                        <input
                                            type="checkbox"
                                            id={`pick-${emp.id}`}
                                            checked={picked.has(emp.id)}
                                            onChange={() => togglePicked(emp.id)}
                                            aria-label={`${emp.firstName} ${emp.lastName}`}
                                            style={{ width: '1rem', height: '1rem', cursor: 'pointer', flexShrink: 0 }}
                                        />
                                    )}
                                    <div
                                        onClick={() => userRole === 'SUPER_ADMIN' && handleStatusToggle(emp.id, emp.status || 'OFFLINE')}
                                        title={emp.status === 'SUSPENDED' ? t('status_suspended_msg') : emp.status === 'ACTIVE' ? t('status_online_msg') : t('status_offline_msg')}
                                        style={{
                                            width: '12px',
                                            height: '12px',
                                            borderRadius: '50%',
                                            background: emp.status === 'SUSPENDED' ? 'var(--danger-fill)' : emp.status === 'ACTIVE' ? 'var(--ok-fill-alt)' : emp.status === 'OFFLINE' ? 'var(--warn-fill)' : 'var(--text-faint)',
                                            cursor: userRole === 'SUPER_ADMIN' ? 'pointer' : 'default',
                                            flexShrink: 0,
                                            boxShadow: `0 0 0 2px ${emp.status === 'SUSPENDED' ? 'var(--danger-border)' : emp.status === 'ACTIVE' ? 'var(--ok-bg-strong)' : emp.status === 'OFFLINE' ? 'var(--warn-bg-yellow)' : 'var(--border)'}`
                                        }}
                                    />
                                    <div style={{ display: 'flex', flexDirection: 'column' }}>
                                        <Link href={`/dashboard/employees/${emp.id}?mode=view`} prefetch={false} style={{ textDecoration: 'none', color: 'inherit' }}>
                                            <h3 className="text-lg font-bold text-slate-800 leading-tight hover:text-blue-600 transition-colors">
                                                {emp.firstName} {emp.lastName}
                                            </h3>
                                        </Link>
                                        <p style={{ margin: 0, color: 'var(--text-soft)', fontSize: '0.85rem' }}>{emp.email}</p>
                                    </div>
                                </div>
                                {emp.role !== 'ADMIN' && (
                                    <span style={{
                                        padding: '0.375rem 0.75rem',
                                        borderRadius: '1rem',
                                        background: 'var(--info-bg-subtle)',
                                        color: 'var(--info-fg-indigo)',
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
                                {emp.username && (
                                    <span style={{
                                        display: 'inline-block',
                                        padding: '0.25rem 0.625rem',
                                        borderRadius: '0.5rem',
                                        fontSize: '0.75rem',
                                        fontWeight: '700',
                                        background: 'var(--surface-subtle)',
                                        color: 'var(--text-soft)',
                                        border: '1px solid var(--border)'
                                    }}>
                                        @{emp.username}
                                    </span>
                                )}
                                {/* Only employees have one, and unassigned is
                                    shown rather than left blank: it is a state
                                    an Admin has to clear, and a gap on a card
                                    reads as "not loaded" instead of "nobody". */}
                                {emp.role === 'EMPLOYEE' && (
                                    <span
                                        title={t('team_leader_label')}
                                        style={{
                                            display: 'inline-block',
                                            padding: '0.25rem 0.625rem',
                                            borderRadius: '0.5rem',
                                            fontSize: '0.75rem',
                                            fontWeight: '700',
                                            background: emp.teamLeader ? 'var(--surface-subtle)' : 'var(--warn-bg-yellow)',
                                            color: emp.teamLeader ? 'var(--text-soft)' : 'var(--warn-fg)',
                                            border: '1px solid var(--border)'
                                        }}
                                    >
                                        {emp.teamLeader
                                            ? `${emp.teamLeader.firstName} ${emp.teamLeader.lastName}`
                                            : t('team_unassigned')}
                                    </span>
                                )}
                                {emp.status === 'SUSPENDED' && (
                                    <span style={{
                                        padding: '0.25rem 0.625rem',
                                        borderRadius: '0.5rem',
                                        fontSize: '0.75rem',
                                        fontWeight: '800',
                                        background: 'var(--danger-bg)',
                                        color: 'var(--danger-fg)',
                                        textTransform: 'uppercase'
                                    }}>
                                        {t('status_suspended')}
                                    </span>
                                )}
                                {emp.status === 'ARCHIVED' && (
                                    <span style={{
                                        padding: '0.25rem 0.625rem',
                                        borderRadius: '0.5rem',
                                        fontSize: '0.75rem',
                                        fontWeight: '800',
                                        background: 'var(--surface-sunk)',
                                        color: 'var(--text-muted)',
                                        textTransform: 'uppercase'
                                    }}>
                                        {t('status_archived')}
                                    </span>
                                )}
                            </div>

                            {canActOnPeople && (
                                <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginTop: 'auto', paddingTop: '1rem', borderTop: '1px dashed var(--border)' }}>
                                    {can('employees.edit') && (emp.role !== 'ADMIN' || userRole === 'SUPER_ADMIN') && (
                                        <Link
                                            href={`/dashboard/employees/${emp.id}`}
                                            prefetch={false}
                                            className="btn"
                                            style={{
                                                background: 'var(--surface-subtle)',
                                                color: 'var(--text-muted)',
                                                padding: '0.5rem 0.75rem',
                                                fontSize: '0.8rem',
                                                fontWeight: '700',
                                                textDecoration: 'none',
                                                borderRadius: '0.75rem',
                                                border: '1px solid var(--border)',
                                                flex: 1,
                                                textAlign: 'center'
                                            }}
                                        >
                                            {t('edit')}
                                        </Link>
                                    )}
                                    {can('salary.view') && emp.role !== 'ADMIN' && (
                                        <Link
                                            href={`/dashboard/employees/${emp.id}/history`}
                                            prefetch={false}
                                            className="btn"
                                            style={{
                                                background: 'var(--surface-subtle)',
                                                color: 'var(--text-muted)',
                                                padding: '0.5rem 0.75rem',
                                                fontSize: '0.8rem',
                                                fontWeight: '700',
                                                textDecoration: 'none',
                                                borderRadius: '0.75rem',
                                                border: '1px solid var(--border)',
                                                flex: 1,
                                                textAlign: 'center'
                                            }}
                                        >
                                            {t('history')}
                                        </Link>
                                    )}
                                    {emp.role !== 'ADMIN' && (
                                        <>
                                            {can('salary_adjustments.manage') && (
                                                <div style={{ display: 'flex', gap: '0.5rem', width: '100%' }}>
                                                    <Link
                                                        href={`/dashboard/employees/${emp.id}/bonus`}
                                                        prefetch={false}
                                                        className="btn"
                                                        style={{
                                                            background: 'var(--ok-bg-subtle)',
                                                            color: 'var(--ok-fg)',
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
                                                        prefetch={false}
                                                        className="btn"
                                                        style={{
                                                            background: 'var(--danger-bg-subtle)',
                                                            color: 'var(--danger-fg)',
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
                                            )}
                                            {can('requests.reset_points') && (
                                                <button
                                                    onClick={() => handleResetPoints(emp.id)}
                                                    disabled={resettingPoints === emp.id}
                                                    className="btn"
                                                    style={{
                                                        background: 'var(--warn-bg-yellow-subtle)',
                                                        color: 'var(--warn-fg)',
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
                                            )}
                                        </>
                                    )}
                                    {can('employees.delete') && emp.role !== 'SUPER_ADMIN' && (
                                        <button
                                            onClick={() => handleDelete(emp.id, `${emp.firstName} ${emp.lastName}`)}
                                            disabled={deletingUser === emp.id}
                                            className="btn"
                                            style={{
                                                background: 'var(--danger-bg)',
                                                color: 'var(--danger-solid-hover)',
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
                    <p style={{ margin: '0 0 1rem 0', color: 'var(--text-soft)' }}>
                        {t('delete_warning')} <strong>{deleteConfirm?.name}</strong>?
                    </p>
                    <p style={{ color: 'var(--danger-fg)', fontSize: '0.875rem', marginBottom: '1.5rem', background: 'var(--danger-bg)', padding: '0.5rem', borderRadius: '0.25rem' }}>
                        {t('undone_warning')}
                    </p>
                    <div style={{ display: 'flex', gap: '1rem', justifyContent: 'flex-end' }}>
                        <button
                            onClick={() => setDeleteConfirm(null)}
                            className="btn"
                            style={{ background: 'var(--border)', color: 'var(--text-strong)' }}
                        >
                            {t('cancel')}
                        </button>
                        <button
                            onClick={confirmDelete}
                            className="btn"
                            style={{ background: 'var(--danger-fill-hover)', color: 'var(--text-on-accent)' }}
                        >
                            {t('delete_employee')}
                        </button>
                    </div>
                </div>
            </Modal>
            <NoticeModal notice={notice} onClose={() => setNotice(null)} />
        </div>
    )
}

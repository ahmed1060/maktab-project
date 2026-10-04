'use client'

import { useState, useEffect } from 'react'
import useSWR from 'swr'
import Pagination from '@/components/Pagination'
import EmployeeFilter from '@/components/EmployeeFilter'
import EmployeeProfileForm from '@/components/EmployeeProfileForm'
import ConfirmModal from '@/components/ConfirmModal'
import Modal from '@/components/Modal'
import { useLanguage } from '@/context/LanguageContext'
import LoadingSpinner from '@/components/LoadingSpinner'
import { useHeader } from '@/context/HeaderContext'
import { fetcher } from '@/lib/swr-fetcher'
import { useAdjustOnChange } from '@/lib/useAdjustOnChange'
import { apiErrorText } from "@/lib/api-error-text"
import { useDialog } from '@/lib/useDialog'

type User = {
    id: string
    firstName: string
    lastName: string
    email: string
    username?: string | null
    role: string
    status: string
    totalDifficultyPoints: number
    gender?: string
    company?: {
        id: string
        name: string
    }
}

type Company = {
    id: string
    name: string
}

export default function AllUsersPage() {
    const { t, locale } = useLanguage()
    const { setTitle, setSubtitle } = useHeader()
    const [filters, setFilters] = useState({ search: '', status: '', companyId: '' })
    const [showExUsersModal, setShowExUsersModal] = useState(false)
    const exUsersDialog = useDialog(showExUsersModal, () => setShowExUsersModal(false), { label: t('ex_users_archive_title') })
    const [viewingProfileId, setViewingProfileId] = useState<string | null>(null)
    const [permanentDeleteConfirm, setPermanentDeleteConfirm] = useState<{ isOpen: boolean, user: User | null }>({ isOpen: false, user: null })
    const [errorModal, setErrorModal] = useState<{ isOpen: boolean, title: string, message: string }>({ isOpen: false, title: '', message: '' })

    const [deletedPage, setDeletedPage] = useState(1)
    const [page, setPage] = useState(1)
    const limit = 10

    // F-25: was one fetchData() doing Promise.all([users, companies,
    // super-admins]) behind a single loading flag, plus two more
    // useEffect+fetch cycles for the ex-users modal and the deleted-user
    // count badge. Split into independently-keyed SWR resources instead —
    // each revalidates only on the inputs it actually depends on, and
    // companies/super-admins (which don't depend on `page`) are no longer
    // artificially tied to the users pagination request the way the old
    // "only fetch super-admins on page === 1" special case needed.
    const usersQuery = (() => {
        const queryParams = new URLSearchParams()
        queryParams.set('includeDeleted', 'false')
        queryParams.set('page', page.toString())
        queryParams.set('limit', limit.toString())
        if (filters.companyId) queryParams.set('companyId', filters.companyId)
        if (filters.search) queryParams.set('search', filters.search)
        return `/api/users?${queryParams.toString()}`
    })()
    const { data: usersResult, isLoading: usersLoading, isValidating: usersValidating, mutate: mutateUsers } = useSWR(usersQuery, fetcher)
    const users: User[] = usersResult?.data?.data || []
    const total: number = usersResult?.data?.total || 0
    const totalPages: number = usersResult?.data?.totalPages || 0

    const { data: companiesResult, isLoading: companiesLoading } = useSWR('/api/companies?limit=100', fetcher)
    const companies: Company[] = companiesResult?.data?.data || companiesResult?.data || []

    const superAdminsQuery = `/api/super-admins?search=${encodeURIComponent(filters.search)}`
    const { data: superAdminsResult, isLoading: superAdminsLoading } = useSWR(superAdminsQuery, fetcher)
    const superAdminsList: User[] = superAdminsResult?.data?.data || []
    const superAdminsTotal: number = superAdminsResult?.data?.total || 0

    const loading = usersLoading || usersValidating || companiesLoading || superAdminsLoading

    useEffect(() => {
        setTitle(t('all_users'))
        setSubtitle(t('all_users_subtitle' as any))
        return () => {
            setTitle(null)
            setSubtitle(null)
        }
    }, [setTitle, setSubtitle, t])

    // Back to page 1 in the same render the filters change, so the first
    // fetch for the new filters already asks for page 1. As an effect this
    // fetched the old page of the new results first, then page 1 — two
    // requests, and a list and pager that disagreed if they came back out of
    // order. See lib/useAdjustOnChange.ts.
    useAdjustOnChange([filters], () => setPage(1))

    const deletedUsersQuery = showExUsersModal
        ? (() => {
            const queryParams = new URLSearchParams()
            queryParams.set('status', 'DELETED')
            if (filters.companyId) queryParams.set('companyId', filters.companyId)
            queryParams.set('page', deletedPage.toString())
            queryParams.set('limit', '10')
            return `/api/users?${queryParams.toString()}`
        })()
        : null
    const { data: deletedUsersResult, isLoading: loadingDeleted, mutate: mutateDeletedUsers } = useSWR(deletedUsersQuery, fetcher)
    const deletedUsersList: User[] = deletedUsersResult?.data?.data || []
    const deletedTotalPages: number = deletedUsersResult?.data?.totalPages || 0

    const deletedCountQuery = `/api/users?countOnly=deleted${filters.companyId ? `&companyId=${filters.companyId}` : ''}`
    const { data: deletedCountResult, mutate: mutateDeletedCount } = useSWR(deletedCountQuery, fetcher)
    const realDeletedCount: number = deletedCountResult?.data?.total || 0

    const superAdmins = superAdminsList
    const activeRegularUsers = users.filter((u: User) => u.status !== 'DELETED')
    const hasAnyDeleted = realDeletedCount > 0

    const filteredUsers = activeRegularUsers.filter((user: User) => {
        if (filters.companyId && user.company?.id !== filters.companyId) return false
        if (filters.search) {
            const query = filters.search.toLowerCase()
            return (
                user.id.toLowerCase().includes(query) ||
                user.firstName.toLowerCase().includes(query) ||
                user.lastName.toLowerCase().includes(query) ||
                user.email.toLowerCase().includes(query) ||
                (user.company?.name && user.company.name.toLowerCase().includes(query))
            )
        }
        return true
    })

    const usersByCompany: { [key: string]: { name: string, users: User[] } } = {}

    filteredUsers.forEach((user: User) => {
        const companyId = user.company?.id || 'unknown'
        const companyName = user.company?.name || t('no_company_label')

        if (!usersByCompany[companyId]) {
            usersByCompany[companyId] = { name: companyName, users: [] }
        }
        usersByCompany[companyId].users.push(user)
    })

    const companySections = Object.values(usersByCompany).sort((a, b) => a.name.localeCompare(b.name))

    const showSuperAdmins = page === 1 && !filters.companyId && (!filters.search ||
        t('super_administrators_label').toLowerCase().includes(filters.search.toLowerCase()) ||
        "shsd".includes(filters.search.toLowerCase()))

    const getStatusKey = (status: string) => {
        switch (status) {
            case 'ACTIVE': return 'status_online'
            case 'OFFLINE': return 'status_offline'
            case 'SUSPENDED':
            case 'BANNED': return 'status_banned'
            case 'DELETED': return 'delete'
            case 'ARCHIVED': return 'status_archived'
            default: return 'status_pending'
        }
    }

    const getStatusStyles = (status: string) => {
        switch (status) {
            case 'ACTIVE':
                return { background: 'var(--ok-bg)', color: 'var(--ok-fg)' }
            case 'OFFLINE':
                return { background: 'var(--warn-bg-yellow)', color: 'var(--warn-fg-yellow)' }
            case 'SUSPENDED':
            case 'BANNED':
                return { background: 'var(--danger-bg)', color: 'var(--danger-fg)' }
            default:
                return { background: 'var(--surface-sunk)', color: 'var(--text-muted)' }
        }
    }

    const getRoleKey = (role: string) => {
        switch (role) {
            case 'EMPLOYEE': return 'role_employee'
            case 'TEAM_LEADER': return 'role_team_leader'
            case 'ADMIN': return 'role_admin'
            case 'SUPER_ADMIN': return 'super_admins'
            default: return 'role_employee'
        }
    }

    const handlePermanentDelete = async (user: User) => {
        try {
            const res = await fetch(`/api/users?id=${user.id}&permanent=true`, { method: 'DELETE' })
            if (res.ok) {
                setErrorModal({
                    isOpen: true,
                    title: locale === 'ar' ? 'نجاح' : 'Success',
                    message: locale === 'ar' ? 'تم حذف المستخدم نهائياً' : 'User deleted permanently'
                })
                mutateUsers()
                mutateDeletedCount()
                // F-25: the old fetchData() call only refreshed the main
                // users/companies/super-admins dataset — the ex-users
                // modal's own list wasn't revalidated, so a user
                // permanently deleted from that modal stayed visible in
                // it until the modal was closed and reopened. Fixed here
                // for free since it's now just another mutate() call.
                mutateDeletedUsers()
            } else {
                const errorText = await res.text()
                setErrorModal({
                    isOpen: true,
                    title: locale === 'ar' ? 'خطأ' : 'Error',
                    message: apiErrorText(errorText, t('error_generic'))
                })
            }
        } catch (error) {
            console.error('Failed to delete user', error)
            setErrorModal({
                isOpen: true,
                title: locale === 'ar' ? 'خطأ' : 'Error',
                message: t('error_generic')
            })
        } finally {
            setPermanentDeleteConfirm({ isOpen: false, user: null })
        }
    }

    return (
        <div style={{ direction: locale === 'ar' ? 'rtl' : 'ltr' }}>
            {/* Header removed as it is now in the top bar */}

            <EmployeeFilter
                onFilterChange={(newFilters) => setFilters(prev => ({ ...prev, ...newFilters }))}
                selectedEmployeeId=""
                hideEmployeeFilter={true}
                hideStatusFilter={true}
                hideDateFilter={true}
                dateFrom=""
                dateTo=""
                totalCount={total + (filters.companyId ? 0 : superAdminsTotal)}
                searchQuery={filters.search}
                placeholder={locale === 'ar' ? 'بحث بالـ ID، أو الاسم، أو البريد الإلكتروني، أو الشركة' : 'Search ID, Name, Email, or Company'}
                showCompanyFilter={true}
                selectedCompanyId={filters.companyId}
                onCompanyChange={(id) => setFilters((prev: any) => ({ ...prev, companyId: id }))}
                companyOptions={companies.map((c: Company) => ({ label: c.name, value: c.id }))}
            />

            {
                loading ? <LoadingSpinner message={t('loading_users')} /> : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '3rem' }}>

                        {/* Super Admins Section */}
                        {showSuperAdmins && superAdmins.length > 0 && (
                            <div>
                                <h2 style={{ fontSize: '1.4rem', fontWeight: 'bold', marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem', textAlign: locale === 'ar' ? 'right' : 'left' }}>
                                    <span style={{ background: 'var(--warn-fill)', color: 'var(--text-on-accent)', padding: '0.2rem 0.5rem', borderRadius: '4px', fontSize: '0.8rem' }}>SHSD</span>
                                    {t('super_administrators_label')}
                                </h2>
                                <div style={{ background: 'var(--surface)', borderRadius: '12px', overflowX: 'auto', boxShadow: '0 1px 3px var(--shadow-weak)' }}>
                                    <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '600px' }}>
                                        <thead style={{ background: 'var(--warn-bg-yellow-subtle)', borderBottom: '1px solid var(--warn-border)' }}>
                                            <tr>
                                                <th style={{ textAlign: locale === 'ar' ? 'right' : 'left', padding: '1rem', fontSize: '0.875rem', color: 'var(--warn-fg)' }}>{t('name_label')}</th>
                                                <th style={{ textAlign: locale === 'ar' ? 'right' : 'left', padding: '1rem', fontSize: '0.875rem', color: 'var(--warn-fg)' }}>{t('email')}</th>
                                                <th style={{ textAlign: locale === 'ar' ? 'right' : 'left', padding: '1rem', fontSize: '0.875rem', color: 'var(--warn-fg)' }}>{t('username_label' as any) || 'Username'}</th>
                                                <th style={{ textAlign: locale === 'ar' ? 'right' : 'left', padding: '1rem', fontSize: '0.875rem', color: 'var(--warn-fg)' }}>{t('role_label')}</th>
                                                <th style={{ textAlign: locale === 'ar' ? 'left' : 'right', padding: '1rem', fontSize: '0.875rem', color: 'var(--warn-fg)' }}>{t('status_label' as any) || t('system')}</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {superAdmins.map((user: User) => (
                                                <tr key={user.id} style={{ borderBottom: '1px solid var(--warn-bg)' }}>
                                                    <td style={{ padding: '1rem', textAlign: locale === 'ar' ? 'right' : 'left' }}>
                                                        <div style={{ fontWeight: '500' }}>{user.firstName} {user.lastName}</div>
                                                    </td>
                                                    <td style={{ padding: '1rem', textAlign: locale === 'ar' ? 'right' : 'left' }}>{user.email}</td>
                                                    <td style={{ padding: '1rem', textAlign: locale === 'ar' ? 'right' : 'left' }}>
                                                        <code style={{ fontSize: '0.8rem', background: 'var(--warn-bg)', padding: '0.2rem 0.4rem', borderRadius: '4px' }}>
                                                            {user.username || '-'}
                                                        </code>
                                                    </td>
                                                    <td style={{ padding: '1rem', textAlign: locale === 'ar' ? 'right' : 'left' }}>
                                                        <span style={{
                                                            fontSize: '0.75rem', fontWeight: 'bold',
                                                            padding: '0.2rem 0.5rem', borderRadius: '4px',
                                                            background: 'var(--warn-bg)', color: 'var(--warn-fg)'
                                                        }}>
                                                            {t(getRoleKey(user.role) as any)}
                                                        </span>
                                                    </td>
                                                    <td style={{ padding: '1rem', textAlign: locale === 'ar' ? 'left' : 'right' }}>
                                                        <span style={{
                                                            padding: '0.25rem 0.75rem',
                                                            borderRadius: '999px',
                                                            fontSize: '0.75rem',
                                                            fontWeight: '600',
                                                            ...getStatusStyles(user.status)
                                                        }}>
                                                            {t(getStatusKey(user.status) as any)}
                                                        </span>
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        )}

                        {/* Company Sections */}
                        {companySections.map((section, idx) => (
                            <div key={idx}>
                                <h2 style={{ fontSize: '1.4rem', fontWeight: 'bold', marginBottom: '1rem', paddingBottom: '0.5rem', borderBottom: '2px solid var(--border)', textAlign: locale === 'ar' ? 'right' : 'left' }}>
                                    {section.name}
                                </h2>
                                <div style={{ background: 'var(--surface)', borderRadius: '12px', overflowX: 'auto', boxShadow: '0 1px 3px var(--shadow-weak)' }}>
                                    <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '800px' }}>
                                        <thead style={{ background: 'var(--surface-subtle)', borderBottom: '1px solid var(--border)' }}>
                                            <tr>
                                                <th style={{ textAlign: locale === 'ar' ? 'right' : 'left', padding: '1rem', fontSize: '0.875rem', color: 'var(--text-soft)' }}>{t('name_label')}</th>
                                                <th style={{ textAlign: locale === 'ar' ? 'right' : 'left', padding: '1rem', fontSize: '0.875rem', color: 'var(--text-soft)' }}>{t('email')}</th>
                                                <th style={{ textAlign: locale === 'ar' ? 'right' : 'left', padding: '1rem', fontSize: '0.875rem', color: 'var(--text-soft)' }}>{t('username_label' as any) || 'Username'}</th>
                                                <th style={{ textAlign: locale === 'ar' ? 'right' : 'left', padding: '1rem', fontSize: '0.875rem', color: 'var(--text-soft)' }}>{t('role_label')}</th>
                                                <th style={{ textAlign: locale === 'ar' ? 'right' : 'left', padding: '1rem', fontSize: '0.875rem', color: 'var(--text-soft)' }}>{t('points_label')}</th>
                                                <th style={{ textAlign: locale === 'ar' ? 'left' : 'right', padding: '1rem', fontSize: '0.875rem', color: 'var(--text-soft)' }}>{t('status_label' as any) || t('system')}</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {section.users.map((user: User) => (
                                                <tr key={user.id} style={{ borderBottom: '1px solid var(--surface-sunk)' }}>
                                                    <td style={{ padding: '1rem', textAlign: locale === 'ar' ? 'right' : 'left' }}>
                                                        <div style={{ fontWeight: '500' }}>{user.firstName} {user.lastName}</div>
                                                    </td>
                                                    <td style={{ padding: '1rem', textAlign: locale === 'ar' ? 'right' : 'left' }}>{user.email}</td>
                                                    <td style={{ padding: '1rem', textAlign: locale === 'ar' ? 'right' : 'left' }}>
                                                        <code style={{ fontSize: '0.8rem', background: 'var(--surface-subtle)', padding: '0.2rem 0.4rem', border: '1px solid var(--border)', borderRadius: '4px' }}>
                                                            {user.username || '-'}
                                                        </code>
                                                    </td>
                                                    <td style={{ padding: '1rem', textAlign: locale === 'ar' ? 'right' : 'left' }}>
                                                        <span style={{
                                                            fontSize: '0.75rem', fontWeight: 'bold',
                                                            padding: '0.2rem 0.5rem', borderRadius: '4px',
                                                            background: 'var(--surface-sunk)', color: 'var(--text-muted)'
                                                        }}>
                                                            {t(getRoleKey(user.role) as any)}
                                                        </span>
                                                    </td>
                                                    <td style={{ padding: '1rem', textAlign: locale === 'ar' ? 'right' : 'left' }}>
                                                        <span style={{ fontWeight: '600', color: user.totalDifficultyPoints >= 0 ? 'var(--ok-fg)' : 'var(--danger-fg)' }}>
                                                            {user.totalDifficultyPoints}
                                                        </span>
                                                    </td>
                                                    <td style={{ padding: '1rem', textAlign: locale === 'ar' ? 'left' : 'right' }}>
                                                        <span style={{
                                                            padding: '0.25rem 0.75rem',
                                                            borderRadius: '999px',
                                                            fontSize: '0.75rem',
                                                            fontWeight: '600',
                                                            ...getStatusStyles(user.status)
                                                        }}>
                                                            {t(getStatusKey(user.status) as any)}
                                                        </span>
                                                    </td>
                                                </tr>
                                            ))}
                                            {section.users.length === 0 && (
                                                <tr>
                                                    <td colSpan={6} style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-soft)' }}>{t('no_users_found_company')}</td>
                                                </tr>
                                            )}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        ))}

                        {companySections.length === 0 && !showSuperAdmins && (
                            <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-soft)' }}>
                                {t('no_companies_found_matching')} &quot;{filters.search}&quot;.
                            </div>
                        )}
                    </div>
                )
            }

            <Pagination
                currentPage={page}
                totalPages={totalPages}
                onPageChange={(p) => setPage(p)}
            />

            {/* Ex Users Section */}
            {
                hasAnyDeleted && (activeRegularUsers.length === 0 || page >= totalPages || totalPages === 0) && (
                    <div style={{ marginTop: '2rem' }}>
                        <div style={{ background: 'var(--surface-subtle)', padding: '1.5rem', borderRadius: '12px', border: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <div style={{ textAlign: locale === 'ar' ? 'right' : 'left' }}>
                                <h2 style={{ fontSize: '1.2rem', fontWeight: 'bold', color: 'var(--text-soft)' }}>{t('ex_users_label')}</h2>
                                <p style={{ margin: 0, color: 'var(--text-faint)', fontSize: '0.9rem' }}>
                                    {realDeletedCount} {t('deleted_users_archive_msg')}
                                </p>
                            </div>
                            <button
                                onClick={() => setShowExUsersModal(true)}
                                className="btn"
                                style={{ background: 'var(--surface)', border: '1px solid var(--border-firm)', color: 'var(--text-muted)' }}
                            >
                                {t('view_archive_button')}
                            </button>
                        </div>
                    </div>
                )
            }
            {/* Ex Users Modal */}
            {
                showExUsersModal && (
                    <div style={{
                        position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
                        background: 'var(--scrim)', display: 'flex', justifyContent: 'center',
                        alignItems: 'center', zIndex: 100
                    }}>
                        <div
                            style={{ position: 'absolute', inset: 0 }}
                            onClick={() => setShowExUsersModal(false)}
                        />
                        {viewingProfileId ? (
                            <div {...exUsersDialog.panelProps} style={{ background: 'var(--surface)', borderRadius: '12px', width: '90%', maxWidth: '800px', maxHeight: '90vh', overflowY: 'auto', position: 'relative', zIndex: 101 }}>
                                <EmployeeProfileForm
                                    userId={viewingProfileId}
                                    isViewMode={true}
                                    onClose={() => setViewingProfileId(null)}
                                />
                            </div>
                        ) : (
                            <div {...exUsersDialog.panelProps} style={{ background: 'var(--surface)', padding: '2rem', borderRadius: '12px', width: '90%', maxWidth: '800px', maxHeight: '80vh', display: 'flex', flexDirection: 'column', position: 'relative', zIndex: 101, direction: locale === 'ar' ? 'rtl' : 'ltr' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem', flexDirection: 'row' }}>
                                    <h2 style={{ fontSize: '1.5rem', fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: '0.5rem', flexDirection: 'row' }}>
                                        <span style={{ fontSize: '1.5rem' }}>🗑️</span> {t('ex_users_archive_title')}
                                    </h2>
                                    <button aria-label={t('close')} onClick={() => setShowExUsersModal(false)} style={{ background: 'none', border: 'none', fontSize: '1.5rem', cursor: 'pointer', color: 'var(--text-soft)' }}>&times;</button>
                                </div>

                                <div style={{ overflowY: 'auto', overflowX: 'auto', flex: 1 }}>
                                    <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '600px', textAlign: locale === 'ar' ? 'right' : 'left' }}>
                                        <thead style={{ background: 'var(--surface-sunk)', position: 'sticky', top: 0 }}>
                                            <tr>
                                                <th style={{ textAlign: 'inherit', padding: '1rem', color: 'var(--text-soft)' }}>{t('name_label')}</th>
                                                <th style={{ textAlign: 'inherit', padding: '1rem', color: 'var(--text-soft)' }}>{t('email')}</th>
                                                <th style={{ textAlign: 'inherit', padding: '1rem', color: 'var(--text-soft)' }}>{t('username_label' as any) || 'Username'}</th>
                                                <th style={{ textAlign: 'inherit', padding: '1rem', color: 'var(--text-soft)' }}>{t('previously_label')}</th>
                                                <th style={{ textAlign: locale === 'ar' ? 'left' : 'right', padding: '1rem', color: 'var(--text-soft)' }}>{t('profile_label')}</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {loadingDeleted ? (
                                                <tr>
                                                    <td colSpan={5} style={{ padding: '2rem', textAlign: 'center' }}>{t('loading_users')}</td>
                                                </tr>
                                            ) : deletedUsersList.map((user: User) => (
                                                <tr key={user.id} style={{ borderBottom: '1px solid var(--border)' }}>
                                                    <td style={{ padding: '1rem', fontWeight: '500', textAlign: 'inherit' }}>
                                                        {user.firstName} {user.lastName}
                                                    </td>
                                                    <td style={{ padding: '1rem', color: 'var(--text-soft)', textAlign: 'inherit' }}>
                                                        {user.email.includes('_DELETED_') ? user.email.split('_DELETED_')[0] : user.email}
                                                    </td>
                                                    <td style={{ padding: '1rem', color: 'var(--text-soft)', textAlign: 'inherit' }}>
                                                        <code style={{ fontSize: '0.8rem', background: 'var(--surface-sunk)', padding: '0.2rem 0.4rem', borderRadius: '4px' }}>
                                                            {user.username || '-'}
                                                        </code>
                                                    </td>
                                                    <td style={{ padding: '1rem', textAlign: 'inherit' }}>
                                                        <span style={{ fontSize: '0.75rem', background: 'var(--surface-sunk)', padding: '0.2rem 0.5rem', borderRadius: '0.25rem', color: 'var(--text-muted)' }}>
                                                            {user.company?.name || t('no_data_available')} &bull; {t(getRoleKey(user.role) as any)}
                                                        </span>
                                                    </td>
                                                    <td style={{ padding: '1rem', textAlign: locale === 'ar' ? 'left' : 'right' }}>
                                                        <div style={{ display: 'flex', gap: '0.5rem', justifyContent: locale === 'ar' ? 'flex-start' : 'flex-end' }}>
                                                            <button
                                                                onClick={() => setViewingProfileId(user.id)}
                                                                style={{
                                                                    background: 'var(--info-bg-subtle)',
                                                                    color: 'var(--info-solid-hover)',
                                                                    padding: '0.4rem 0.8rem',
                                                                    borderRadius: '0.5rem',
                                                                    fontWeight: '500',
                                                                    fontSize: '0.8rem',
                                                                    border: 'none',
                                                                    cursor: 'pointer'
                                                                }}
                                                            >
                                                                {t('view_profile_button')}
                                                            </button>
                                                            <button aria-label={t('delete')}
                                                                onClick={() => setPermanentDeleteConfirm({ isOpen: true, user })}
                                                                title={t('delete')}
                                                                style={{
                                                                    background: 'var(--danger-bg)',
                                                                    color: 'var(--danger-solid-hover)',
                                                                    padding: '0.4rem 0.6rem',
                                                                    borderRadius: '0.5rem',
                                                                    fontWeight: '600',
                                                                    fontSize: '0.8rem',
                                                                    border: 'none',
                                                                    cursor: 'pointer',
                                                                    display: 'flex',
                                                                    alignItems: 'center',
                                                                    justifyContent: 'center'
                                                                }}
                                                            >
                                                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                                                    <polyline points="3 6 5 6 21 6"></polyline>
                                                                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                                                                    <line x1="10" y1="11" x2="10" y2="17"></line>
                                                                    <line x1="14" y1="11" x2="14" y2="17"></line>
                                                                </svg>
                                                            </button>
                                                        </div>
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>

                                <Pagination
                                    currentPage={deletedPage}
                                    totalPages={deletedTotalPages}
                                    onPageChange={(p) => setDeletedPage(p)}
                                />

                                <div style={{ marginTop: '1.5rem', textAlign: locale === 'ar' ? 'left' : 'right' }}>
                                    <button
                                        onClick={() => setShowExUsersModal(false)}
                                        className="btn"
                                        style={{ background: 'var(--border)', color: 'var(--text-strong)' }}
                                    >
                                        {t('close_button')}
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>
                )
            }

            <ConfirmModal
                isOpen={permanentDeleteConfirm.isOpen}
                title={locale === 'ar' ? 'حذف المستخدم نهائياً' : 'Permanent User Deletion'}
                message={locale === 'ar'
                    ? `هل أنت متأكد أنك تريد حذف ${permanentDeleteConfirm.user?.firstName} ${permanentDeleteConfirm.user?.lastName} نهائياً؟ لا يمكن التراجع عن هذا الإجراء وسيتم حذف جميع بياناته المرتبطة.`
                    : `Are you sure you want to PERMANENTLY delete ${permanentDeleteConfirm.user?.firstName} ${permanentDeleteConfirm.user?.lastName}? This action cannot be undone and will remove all associated data.`
                }
                confirmText={t('delete')}
                onConfirm={() => permanentDeleteConfirm.user && handlePermanentDelete(permanentDeleteConfirm.user)}
                onCancel={() => setPermanentDeleteConfirm({ isOpen: false, user: null })}
                variant="danger"
            />

            <Modal
                isOpen={errorModal.isOpen}
                onClose={() => setErrorModal({ ...errorModal, isOpen: false })}
                title={errorModal.title}
            >
                <div style={{ textAlign: 'center', padding: '1rem' }}>
                    <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>
                        {errorModal.title === 'Success' || errorModal.title === 'نجاح' ? '✅' : '⛔'}
                    </div>
                    <p style={{ fontSize: '1.1rem', color: 'var(--text-body)' }}>{errorModal.message}</p>
                </div>
            </Modal>
        </div >
    )
}

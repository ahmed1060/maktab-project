'use client'

import { useState, useEffect } from 'react'
import EmployeeProfileForm from '@/components/EmployeeProfileForm'
import { useRouter } from 'next/navigation'
import { useLanguage } from '@/context/LanguageContext'

type User = {
    id: string
    firstName: string
    lastName: string
    email: string
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
    const [users, setUsers] = useState<User[]>([])
    const [companies, setCompanies] = useState<Company[]>([])
    const [superAdminsList, setSuperAdminsList] = useState<User[]>([])
    const [loading, setLoading] = useState(true)
    const [companyFilter, setCompanyFilter] = useState('')
    const [showExUsersModal, setShowExUsersModal] = useState(false)
    const [viewingProfileId, setViewingProfileId] = useState<string | null>(null)

    const fetchData = async () => {
        try {
            const [usersRes, companiesRes, superAdminsRes] = await Promise.all([
                fetch('/api/users?includeDeleted=true'),
                fetch('/api/companies'),
                fetch('/api/super-admins')
            ])

            if (usersRes.ok) {
                const data = await usersRes.json()
                setUsers(data)
            }
            if (companiesRes.ok) {
                const data = await companiesRes.json()
                setCompanies(data)
            }
            if (superAdminsRes.ok) {
                const data = await superAdminsRes.json()
                setSuperAdminsList(data)
            }
        } catch (e) {
            console.error('Failed to fetch data')
        } finally {
            setLoading(false)
        }
    }

    useEffect(() => {
        fetchData()
    }, [])

    const superAdmins = superAdminsList
    const activeRegularUsers = users.filter(u => u.status !== 'DELETED' && u.role !== 'SUPER_ADMIN')
    const deletedUsers = users.filter(u => u.status === 'DELETED')
    const regularUsers = activeRegularUsers

    const usersByCompany: { [key: string]: { name: string, users: User[] } } = {}

    regularUsers.forEach(user => {
        const companyId = user.company?.id || 'unknown'
        const companyName = user.company?.name || t('no_data_available')

        if (!usersByCompany[companyId]) {
            usersByCompany[companyId] = { name: companyName, users: [] }
        }
        usersByCompany[companyId].users.push(user)
    })

    let companySections = Object.values(usersByCompany).sort((a, b) => a.name.localeCompare(b.name))

    if (companyFilter) {
        const query = companyFilter.toLowerCase()
        companySections = companySections.filter(section =>
            section.name.toLowerCase().includes(query)
        )
    }

    const showSuperAdmins = !companyFilter ||
        t('super_administrators_label').toLowerCase().includes(companyFilter.toLowerCase()) ||
        "shsd".includes(companyFilter.toLowerCase())

    const getStatusKey = (status: string) => {
        switch (status) {
            case 'ACTIVE': return 'status_active'
            case 'BANNED': return 'status_banned'
            case 'DELETED': return 'delete'
            default: return 'status_pending'
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

    return (
        <div style={{ direction: locale === 'ar' ? 'rtl' : 'ltr' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
                <div>
                    <p style={{ color: '#64748b', textAlign: locale === 'ar' ? 'right' : 'left' }}>{t('all_users_subtitle')}</p>
                </div>
            </div>

            {/* Filter Bar */}
            <div style={{ marginBottom: '2rem', display: 'flex', gap: '1rem', alignItems: 'center', justifyContent: locale === 'ar' ? 'flex-start' : 'flex-start' }}>
                <div style={{ position: 'relative', width: '300px' }}>
                    <div style={{ position: 'absolute', [locale === 'ar' ? 'right' : 'left']: '1rem', top: '50%', transform: 'translateY(-50%)', color: '#94a3b8' }}>
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <circle cx="11" cy="11" r="8"></circle>
                            <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
                        </svg>
                    </div>
                    <input
                        type="text"
                        placeholder={t('filter_by_company_placeholder')}
                        value={companyFilter}
                        onChange={(e) => setCompanyFilter(e.target.value)}
                        list="company-list"
                        style={{
                            width: '100%',
                            padding: locale === 'ar' ? '0.75rem 3rem 0.75rem 1rem' : '0.75rem 1rem 0.75rem 3rem',
                            borderRadius: '0.75rem',
                            border: '1px solid #e2e8f0',
                            fontSize: '1rem',
                            outline: 'none',
                            background: 'white',
                            boxShadow: '0 1px 2px rgba(0,0,0,0.05)',
                            textAlign: locale === 'ar' ? 'right' : 'left'
                        }}
                    />
                    <datalist id="company-list">
                        {companies.map(c => (
                            <option key={c.id} value={c.name} />
                        ))}
                    </datalist>
                </div>
            </div>

            {loading ? <p style={{ textAlign: locale === 'ar' ? 'right' : 'left' }}>{t('loading_filters')}</p> : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '3rem' }}>

                    {/* Super Admins Section */}
                    {showSuperAdmins && superAdmins.length > 0 && (
                        <div>
                            <h2 style={{ fontSize: '1.4rem', fontWeight: 'bold', marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem', textAlign: locale === 'ar' ? 'right' : 'left' }}>
                                <span style={{ background: '#f59e0b', color: 'white', padding: '0.2rem 0.5rem', borderRadius: '4px', fontSize: '0.8rem' }}>SHSD</span>
                                {t('super_administrators_label')}
                            </h2>
                            <div style={{ background: 'white', borderRadius: '12px', overflowX: 'auto', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
                                <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '600px' }}>
                                    <thead style={{ background: '#fffbeb', borderBottom: '1px solid #fcd34d' }}>
                                        <tr>
                                            <th style={{ textAlign: locale === 'ar' ? 'right' : 'left', padding: '1rem', fontSize: '0.875rem', color: '#92400e' }}>{t('name_label')}</th>
                                            <th style={{ textAlign: locale === 'ar' ? 'right' : 'left', padding: '1rem', fontSize: '0.875rem', color: '#92400e' }}>{t('email')}</th>
                                            <th style={{ textAlign: locale === 'ar' ? 'right' : 'left', padding: '1rem', fontSize: '0.875rem', color: '#92400e' }}>{t('role_label')}</th>
                                            <th style={{ textAlign: locale === 'ar' ? 'left' : 'right', padding: '1rem', fontSize: '0.875rem', color: '#92400e' }}>{t('status_label' as any) || t('system')}</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {superAdmins.map(user => (
                                            <tr key={user.id} style={{ borderBottom: '1px solid #fef3c7' }}>
                                                <td style={{ padding: '1rem', textAlign: locale === 'ar' ? 'right' : 'left' }}>
                                                    <div style={{ fontWeight: '500' }}>{user.firstName} {user.lastName}</div>
                                                </td>
                                                <td style={{ padding: '1rem', textAlign: locale === 'ar' ? 'right' : 'left' }}>{user.email}</td>
                                                <td style={{ padding: '1rem', textAlign: locale === 'ar' ? 'right' : 'left' }}>
                                                    <span style={{
                                                        fontSize: '0.75rem', fontWeight: 'bold',
                                                        padding: '0.2rem 0.5rem', borderRadius: '4px',
                                                        background: '#fef3c7', color: '#92400e'
                                                    }}>
                                                        {t(getRoleKey(user.role) as any)}
                                                    </span>
                                                </td>
                                                <td style={{ padding: '1rem', textAlign: locale === 'ar' ? 'left' : 'right' }}>
                                                    <span style={{
                                                        padding: '0.25rem 0.75rem',
                                                        borderRadius: '999px',
                                                        fontSize: '0.75rem',
                                                        background: user.status === 'ACTIVE' ? '#dcfce7' : '#fef9c3',
                                                        color: user.status === 'ACTIVE' ? '#166534' : '#854d0e',
                                                        fontWeight: '600'
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
                            <h2 style={{ fontSize: '1.4rem', fontWeight: 'bold', marginBottom: '1rem', paddingBottom: '0.5rem', borderBottom: '2px solid #e2e8f0', textAlign: locale === 'ar' ? 'right' : 'left' }}>
                                {section.name}
                            </h2>
                            <div style={{ background: 'white', borderRadius: '12px', overflowX: 'auto', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
                                <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '800px' }}>
                                    <thead style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
                                        <tr>
                                            <th style={{ textAlign: locale === 'ar' ? 'right' : 'left', padding: '1rem', fontSize: '0.875rem', color: '#64748b' }}>{t('name_label')}</th>
                                            <th style={{ textAlign: locale === 'ar' ? 'right' : 'left', padding: '1rem', fontSize: '0.875rem', color: '#64748b' }}>{t('email')}</th>
                                            <th style={{ textAlign: locale === 'ar' ? 'right' : 'left', padding: '1rem', fontSize: '0.875rem', color: '#64748b' }}>{t('role_label')}</th>
                                            <th style={{ textAlign: locale === 'ar' ? 'right' : 'left', padding: '1rem', fontSize: '0.875rem', color: '#64748b' }}>{t('points_label')}</th>
                                            <th style={{ textAlign: locale === 'ar' ? 'left' : 'right', padding: '1rem', fontSize: '0.875rem', color: '#64748b' }}>{t('status_label' as any) || t('system')}</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {section.users.map(user => (
                                            <tr key={user.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                                                <td style={{ padding: '1rem', textAlign: locale === 'ar' ? 'right' : 'left' }}>
                                                    <div style={{ fontWeight: '500' }}>{user.firstName} {user.lastName}</div>
                                                </td>
                                                <td style={{ padding: '1rem', textAlign: locale === 'ar' ? 'right' : 'left' }}>{user.email}</td>
                                                <td style={{ padding: '1rem', textAlign: locale === 'ar' ? 'right' : 'left' }}>
                                                    <span style={{
                                                        fontSize: '0.75rem', fontWeight: 'bold',
                                                        padding: '0.2rem 0.5rem', borderRadius: '4px',
                                                        background: '#f1f5f9', color: '#475569'
                                                    }}>
                                                        {t(getRoleKey(user.role) as any)}
                                                    </span>
                                                </td>
                                                <td style={{ padding: '1rem', textAlign: locale === 'ar' ? 'right' : 'left' }}>
                                                    <span style={{ fontWeight: '600', color: user.totalDifficultyPoints >= 0 ? '#166534' : '#991b1b' }}>
                                                        {user.totalDifficultyPoints}
                                                    </span>
                                                </td>
                                                <td style={{ padding: '1rem', textAlign: locale === 'ar' ? 'left' : 'right' }}>
                                                    <span style={{
                                                        padding: '0.25rem 0.75rem',
                                                        borderRadius: '999px',
                                                        fontSize: '0.75rem',
                                                        background: user.status === 'ACTIVE' ? '#dcfce7' : '#fef9c3',
                                                        color: user.status === 'ACTIVE' ? '#166534' : '#854d0e',
                                                        fontWeight: '600'
                                                    }}>
                                                        {t(getStatusKey(user.status) as any)}
                                                    </span>
                                                </td>
                                            </tr>
                                        ))}
                                        {section.users.length === 0 && (
                                            <tr>
                                                <td colSpan={5} style={{ padding: '2rem', textAlign: 'center', color: '#64748b' }}>{t('no_users_found_company')}</td>
                                            </tr>
                                        )}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    ))}

                    {companySections.length === 0 && !showSuperAdmins && (
                        <div style={{ textAlign: 'center', padding: '3rem', color: '#64748b' }}>
                            {t('no_companies_found_matching')} &quot;{companyFilter}&quot;.
                        </div>
                    )}
                </div>
            )}
            {/* Ex Users Section */}
            {deletedUsers.length > 0 && (
                <div style={{ marginTop: '2rem' }}>
                    <div style={{ background: '#f8fafc', padding: '1.5rem', borderRadius: '12px', border: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexDirection: locale === 'ar' ? 'row-reverse' : 'row' }}>
                        <div style={{ textAlign: locale === 'ar' ? 'right' : 'left' }}>
                            <h2 style={{ fontSize: '1.2rem', fontWeight: 'bold', color: '#64748b' }}>{t('ex_users_label')}</h2>
                            <p style={{ margin: 0, color: '#94a3b8', fontSize: '0.9rem' }}>
                                {deletedUsers.length} {t('deleted_users_archive_msg')}
                            </p>
                        </div>
                        <button
                            onClick={() => setShowExUsersModal(true)}
                            className="btn"
                            style={{ background: 'white', border: '1px solid #cbd5e1', color: '#475569' }}
                        >
                            {t('view_archive_button')}
                        </button>
                    </div>
                </div>
            )}
            {/* Ex Users Modal */}
            {showExUsersModal && (
                <div style={{
                    position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
                    background: 'rgba(0,0,0,0.5)', display: 'flex', justifyContent: 'center',
                    alignItems: 'center', zIndex: 100
                }}>
                    <div
                        style={{ position: 'absolute', inset: 0 }}
                        onClick={() => setShowExUsersModal(false)}
                    />
                    {viewingProfileId ? (
                        <div style={{ background: 'white', borderRadius: '12px', width: '90%', maxWidth: '800px', maxHeight: '90vh', overflowY: 'auto', position: 'relative', zIndex: 101 }}>
                            <EmployeeProfileForm
                                userId={viewingProfileId}
                                isViewMode={true}
                                onClose={() => setViewingProfileId(null)}
                            />
                        </div>
                    ) : (
                        <div style={{ background: 'white', padding: '2rem', borderRadius: '12px', width: '90%', maxWidth: '800px', maxHeight: '80vh', display: 'flex', flexDirection: 'column', position: 'relative', zIndex: 101, direction: locale === 'ar' ? 'rtl' : 'ltr' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem', flexDirection: locale === 'ar' ? 'row-reverse' : 'row' }}>
                                <h2 style={{ fontSize: '1.5rem', fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: '0.5rem', flexDirection: locale === 'ar' ? 'row-reverse' : 'row' }}>
                                    <span style={{ fontSize: '1.5rem' }}>🗑️</span> {t('ex_users_archive_title')}
                                </h2>
                                <button onClick={() => setShowExUsersModal(false)} style={{ background: 'none', border: 'none', fontSize: '1.5rem', cursor: 'pointer', color: '#64748b' }}>&times;</button>
                            </div>

                            <div style={{ overflowY: 'auto', flex: 1 }}>
                                <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '600px', textAlign: locale === 'ar' ? 'right' : 'left' }}>
                                    <thead style={{ background: '#f1f5f9', position: 'sticky', top: 0 }}>
                                        <tr>
                                            <th style={{ textAlign: 'inherit', padding: '1rem', color: '#64748b' }}>{t('name_label')}</th>
                                            <th style={{ textAlign: 'inherit', padding: '1rem', color: '#64748b' }}>{t('email')}</th>
                                            <th style={{ textAlign: 'inherit', padding: '1rem', color: '#64748b' }}>{t('previously_label')}</th>
                                            <th style={{ textAlign: locale === 'ar' ? 'left' : 'right', padding: '1rem', color: '#64748b' }}>{t('profile_label')}</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {deletedUsers.map(user => (
                                            <tr key={user.id} style={{ borderBottom: '1px solid #e2e8f0' }}>
                                                <td style={{ padding: '1rem', fontWeight: '500', textAlign: 'inherit' }}>
                                                    {user.firstName} {user.lastName}
                                                </td>
                                                <td style={{ padding: '1rem', color: '#64748b', textAlign: 'inherit' }}>
                                                    {user.email.includes('_DELETED_') ? user.email.split('_DELETED_')[0] : user.email}
                                                </td>
                                                <td style={{ padding: '1rem', textAlign: 'inherit' }}>
                                                    <span style={{ fontSize: '0.75rem', background: '#f1f5f9', padding: '0.2rem 0.5rem', borderRadius: '0.25rem', color: '#475569' }}>
                                                        {user.company?.name || t('no_data_available')} &bull; {t(getRoleKey(user.role) as any)}
                                                    </span>
                                                </td>
                                                <td style={{ padding: '1rem', textAlign: locale === 'ar' ? 'left' : 'right' }}>
                                                    <button
                                                        onClick={() => setViewingProfileId(user.id)}
                                                        style={{
                                                            background: '#eff6ff',
                                                            color: '#2563eb',
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
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>

                            <div style={{ marginTop: '1.5rem', textAlign: locale === 'ar' ? 'left' : 'right' }}>
                                <button
                                    onClick={() => setShowExUsersModal(false)}
                                    className="btn"
                                    style={{ background: '#e2e8f0', color: '#0f172a' }}
                                >
                                    {t('close_button')}
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            )}
        </div>
    )
}

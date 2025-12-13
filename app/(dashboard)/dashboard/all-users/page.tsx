'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'

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
    const [users, setUsers] = useState<User[]>([])
    const [companies, setCompanies] = useState<Company[]>([])
    const [superAdminsList, setSuperAdminsList] = useState<User[]>([])
    const [loading, setLoading] = useState(true)
    const [companyFilter, setCompanyFilter] = useState('')

    const fetchData = async () => {
        try {
            const [usersRes, companiesRes, superAdminsRes] = await Promise.all([
                fetch('/api/users'),
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

    // 1. Super Admins
    const superAdmins = superAdminsList

    // 2. Regular Users Grouped by Company
    const regularUsers = users

    // Group logic
    const usersByCompany: { [key: string]: { name: string, users: User[] } } = {}

    // Initialize groups from companies list (to ensure empty companies show up or just used for ordering?)
    // User requested "arranged as the companies... contains the users".
    // I'll group strictly by users' company to avoid empty sections unless desired.
    // However, if I filter, I want to search against Company Name.

    regularUsers.forEach(user => {
        const companyId = user.company?.id || 'unknown'
        const companyName = user.company?.name || 'No Company'

        if (!usersByCompany[companyId]) {
            usersByCompany[companyId] = { name: companyName, users: [] }
        }
        usersByCompany[companyId].users.push(user)
    })

    // Prepare sections
    let companySections = Object.values(usersByCompany).sort((a, b) => a.name.localeCompare(b.name))

    // Filter Logic
    if (companyFilter) {
        const query = companyFilter.toLowerCase()
        companySections = companySections.filter(section =>
            section.name.toLowerCase().includes(query)
        )
    }

    // Determine if Super Admins should be hidden when filtering?
    // User said "first section is super admins", usually implies global header. 
    // If I filter for "Tech Corp", showing Super Admins (SHSD) might be distracting or desired.
    // I will keep Super Admins visible strictly if the filter is empty OR if the filter matches "Super Admin" or "SHSD" (their company).
    // Let's simpler: Always show Super Admins unless filter specifically excludes them?
    // Actually, "acts as a filter... select company". If I select "Company A", I expect to see Company A. 
    // But Super Admins are important. I'll keep them at the top but maybe filterable if one strictly searches "Company A".
    // I'll leave Super Admins visible for now, or maybe only filter them out if the filter strongly matches another company?
    // Let's filter Super Admins if the query doesn't match "Super" or "Admin" or "SHSD".

    const showSuperAdmins = !companyFilter ||
        "super admins".includes(companyFilter.toLowerCase()) ||
        "shsd".includes(companyFilter.toLowerCase())

    return (
        <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
                <div>
                    <h1 style={{ fontSize: '1.8rem', fontWeight: 'bold' }}>All Users</h1>
                    <p style={{ color: '#64748b' }}>Comprehensive list of all registered users</p>
                </div>
            </div>

            {/* Filter Bar */}
            <div style={{ marginBottom: '2rem', display: 'flex', gap: '1rem', alignItems: 'center' }}>
                <div style={{ position: 'relative', width: '300px' }}>
                    <div style={{ position: 'absolute', left: '1rem', top: '50%', transform: 'translateY(-50%)', color: '#94a3b8' }}>
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <circle cx="11" cy="11" r="8"></circle>
                            <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
                        </svg>
                    </div>
                    <input
                        type="text"
                        placeholder="Filter by Company..."
                        value={companyFilter}
                        onChange={(e) => setCompanyFilter(e.target.value)}
                        list="company-list"
                        style={{
                            width: '100%',
                            padding: '0.75rem 1rem 0.75rem 3rem',
                            borderRadius: '0.75rem',
                            border: '1px solid #e2e8f0',
                            fontSize: '1rem',
                            outline: 'none',
                            background: 'white',
                            boxShadow: '0 1px 2px rgba(0,0,0,0.05)'
                        }}
                    />
                    <datalist id="company-list">
                        {companies.map(c => (
                            <option key={c.id} value={c.name} />
                        ))}
                    </datalist>
                </div>
            </div>

            {loading ? <p>Loading...</p> : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '3rem' }}>

                    {/* Super Admins Section */}
                    {showSuperAdmins && superAdmins.length > 0 && (
                        <div>
                            <h2 style={{ fontSize: '1.4rem', fontWeight: 'bold', marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                <span style={{ background: '#f59e0b', color: 'white', padding: '0.2rem 0.5rem', borderRadius: '4px', fontSize: '0.8rem' }}>SHSD</span>
                                Super Administrators
                            </h2>
                            <div style={{ background: 'white', borderRadius: '12px', overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
                                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                                    <thead style={{ background: '#fffbeb', borderBottom: '1px solid #fcd34d' }}>
                                        <tr>
                                            <th style={{ textAlign: 'left', padding: '1rem', fontSize: '0.875rem', color: '#92400e' }}>Name</th>
                                            <th style={{ textAlign: 'left', padding: '1rem', fontSize: '0.875rem', color: '#92400e' }}>Email</th>
                                            <th style={{ textAlign: 'left', padding: '1rem', fontSize: '0.875rem', color: '#92400e' }}>Role</th>
                                            <th style={{ textAlign: 'right', padding: '1rem', fontSize: '0.875rem', color: '#92400e' }}>Status</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {superAdmins.map(user => (
                                            <tr key={user.id} style={{ borderBottom: '1px solid #fef3c7' }}>
                                                <td style={{ padding: '1rem' }}>
                                                    <div style={{ fontWeight: '500' }}>{user.firstName} {user.lastName}</div>
                                                </td>
                                                <td style={{ padding: '1rem' }}>{user.email}</td>
                                                <td style={{ padding: '1rem' }}>
                                                    <span style={{
                                                        fontSize: '0.75rem', fontWeight: 'bold',
                                                        padding: '0.2rem 0.5rem', borderRadius: '4px',
                                                        background: '#fef3c7', color: '#92400e'
                                                    }}>
                                                        {user.role}
                                                    </span>
                                                </td>
                                                <td style={{ padding: '1rem', textAlign: 'right' }}>
                                                    <span style={{
                                                        padding: '0.25rem 0.75rem',
                                                        borderRadius: '999px',
                                                        fontSize: '0.75rem',
                                                        background: user.status === 'ACTIVE' ? '#dcfce7' : '#fef9c3',
                                                        color: user.status === 'ACTIVE' ? '#166534' : '#854d0e',
                                                        fontWeight: '600'
                                                    }}>
                                                        {user.status}
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
                            <h2 style={{ fontSize: '1.4rem', fontWeight: 'bold', marginBottom: '1rem', paddingBottom: '0.5rem', borderBottom: '2px solid #e2e8f0' }}>
                                {section.name}
                            </h2>
                            <div style={{ background: 'white', borderRadius: '12px', overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
                                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                                    <thead style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
                                        <tr>
                                            <th style={{ textAlign: 'left', padding: '1rem', fontSize: '0.875rem', color: '#64748b' }}>Name</th>
                                            <th style={{ textAlign: 'left', padding: '1rem', fontSize: '0.875rem', color: '#64748b' }}>Email</th>
                                            <th style={{ textAlign: 'left', padding: '1rem', fontSize: '0.875rem', color: '#64748b' }}>Role</th>
                                            <th style={{ textAlign: 'left', padding: '1rem', fontSize: '0.875rem', color: '#64748b' }}>Points</th>
                                            <th style={{ textAlign: 'right', padding: '1rem', fontSize: '0.875rem', color: '#64748b' }}>Status</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {section.users.map(user => (
                                            <tr key={user.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                                                <td style={{ padding: '1rem' }}>
                                                    <div style={{ fontWeight: '500' }}>{user.firstName} {user.lastName}</div>
                                                </td>
                                                <td style={{ padding: '1rem' }}>{user.email}</td>
                                                <td style={{ padding: '1rem' }}>
                                                    <span style={{
                                                        fontSize: '0.75rem', fontWeight: 'bold',
                                                        padding: '0.2rem 0.5rem', borderRadius: '4px',
                                                        background: '#f1f5f9', color: '#475569'
                                                    }}>
                                                        {user.role}
                                                    </span>
                                                </td>
                                                <td style={{ padding: '1rem' }}>
                                                    <span style={{ fontWeight: '600', color: user.totalDifficultyPoints >= 0 ? '#166534' : '#991b1b' }}>
                                                        {user.totalDifficultyPoints}
                                                    </span>
                                                </td>
                                                <td style={{ padding: '1rem', textAlign: 'right' }}>
                                                    <span style={{
                                                        padding: '0.25rem 0.75rem',
                                                        borderRadius: '999px',
                                                        fontSize: '0.75rem',
                                                        background: user.status === 'ACTIVE' ? '#dcfce7' : '#fef9c3',
                                                        color: user.status === 'ACTIVE' ? '#166534' : '#854d0e',
                                                        fontWeight: '600'
                                                    }}>
                                                        {user.status}
                                                    </span>
                                                </td>
                                            </tr>
                                        ))}
                                        {section.users.length === 0 && (
                                            <tr>
                                                <td colSpan={5} style={{ padding: '2rem', textAlign: 'center', color: '#64748b' }}>No users found for this company.</td>
                                            </tr>
                                        )}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    ))}

                    {companySections.length === 0 && !showSuperAdmins && (
                        <div style={{ textAlign: 'center', padding: '3rem', color: '#64748b' }}>
                            No companies found matching "{companyFilter}".
                        </div>
                    )}
                </div>
            )}
        </div>
    )
}

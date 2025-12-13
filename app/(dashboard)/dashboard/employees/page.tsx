'use client'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { useSession } from 'next-auth/react'
import SortControl from '@/components/SortControl'
import { useCompany } from '@/context/CompanyContext'


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
    const [employees, setEmployees] = useState<Employee[]>([])
    const [loading, setLoading] = useState(true)
    const [deleteConfirm, setDeleteConfirm] = useState<{ id: string; name: string } | null>(null)
    const router = useRouter()
    const { data: session } = useSession()
    const userRole = session?.user?.role || ''
    const { selectedCompanyId } = useCompany()

    const fetchEmployees = async () => {
        const query = selectedCompanyId ? `?companyId=${selectedCompanyId}` : ''
        const res = await fetch(`/api/users${query}`)
        const data = await res.json()
        // Filter out current user AND Super Admins
        const filteredData = data.filter((u: Employee) => u.id !== (session?.user?.id || '') && u.role !== 'SUPER_ADMIN')
        setEmployees(filteredData)
        setLoading(false)
    }


    const [sortBy, setSortBy] = useState('name')
    const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc')
    const [searchQuery, setSearchQuery] = useState('')
    const [roleFilter, setRoleFilter] = useState('')

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
                // Sort by role: EMPLOYEE -> TEAM_LEADER -> ADMIN -> SUPER_ADMIN
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

        try {
            const res = await fetch(`/api/users?id=${deleteConfirm.id}`, {
                method: 'DELETE'
            })

            if (res.ok) {
                setEmployees(employees.filter(emp => emp.id !== deleteConfirm.id))
            } else {
                const text = await res.text()
                console.error('Delete failed:', text)
            }
        } catch (err) {
            console.error('Delete error:', err)
        }

        setDeleteConfirm(null)
    }

    const handleResetPoints = async (id: string) => {
        try {
            const res = await fetch(`/api/users/${id}/reset-points`, {
                method: 'POST'
            })

            if (res.ok) {
                // Refresh employee list to show updated points
                fetchEmployees()
            }
        } catch (err) {
            console.error('Reset points error:', err)
        }
    }

    const handleStatusToggle = async (id: string, currentStatus: string) => {
        try {
            // Toggle between ACTIVE/OFFLINE and SUSPENDED
            const newStatus = currentStatus === 'SUSPENDED' ? 'OFFLINE' : 'SUSPENDED'

            const res = await fetch(`/api/users/${id}/status`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ status: newStatus })
            })

            if (res.ok) {
                // Refresh employee list to show updated status
                fetchEmployees()
            }
        } catch (err) {
            console.error('Status toggle error:', err)
        }
    }

    if (loading) {
        return <div>Loading...</div>
    }

    return (
        <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
                <h1>Employees</h1>
                {['ADMIN', 'SUPER_ADMIN'].includes(userRole) && (
                    <Link href="/dashboard/employees/new" className="btn btn-primary" style={{ textDecoration: 'none' }}>
                        Add Employee
                    </Link>
                )}
            </div>

            {/* Filters Row */}
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
                    <div style={{ position: 'absolute', left: '1rem', top: '50%', transform: 'translateY(-50%)', color: '#94a3b8' }}>
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <circle cx="11" cy="11" r="8"></circle>
                            <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
                        </svg>
                    </div>
                    <input
                        type="text"
                        placeholder="Search employees..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        style={{
                            width: '100%',
                            padding: '0.75rem 1rem 0.75rem 3rem',
                            borderRadius: '0.75rem',
                            border: 'none',
                            fontSize: '1rem',
                            outline: 'none',
                            background: 'transparent'
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
                    <div style={{ position: 'absolute', left: '1rem', top: '50%', transform: 'translateY(-50%)', color: '#64748b' }}>
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
                            padding: '0.75rem 2.5rem 0.75rem 3rem', // Right padding for arrow, left for icon
                            borderRadius: '0.75rem',
                            border: 'none',
                            fontSize: '0.875rem',
                            outline: 'none',
                            backgroundColor: 'transparent',
                            cursor: 'pointer',
                            appearance: 'none',
                            backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 24 24' stroke='%2364748b'%3E%3Cpath stroke-linecap='round' stroke-linejoin='round' stroke-width='2' d='M19 9l-7 7-7-7'%3E%3C/path%3E%3C/svg%3E")`,
                            backgroundRepeat: 'no-repeat',
                            backgroundPosition: 'right 1rem center',
                            backgroundSize: '1.25rem'
                        }}
                    >
                        <option value="">All Roles</option>
                        <option value="EMPLOYEE">Employee</option>
                        <option value="TEAM_LEADER">Team Leader</option>
                        <option value="ADMIN">Admin</option>
                    </select>
                </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '1.5rem' }}>
                <SortControl
                    options={[
                        { label: 'Name', value: 'name' },
                        { label: 'Role', value: 'role' },
                        { label: 'Points', value: 'points' },
                    ]}
                    sortBy={sortBy}
                    sortOrder={sortOrder}
                    onSortChange={(field, order) => { setSortBy(field); setSortOrder(order) }}
                />
            </div>

            <div style={{ display: 'grid', gap: '1rem' }}>
                {sortedEmployees.length === 0 ? (
                    <p>No employees found.</p>
                ) : (
                    sortedEmployees.map(emp => (
                        <div key={emp.id} className="card">
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                <div style={{ flex: 1 }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                                        {/* Status Dot Indicator */}
                                        <div
                                            onClick={() => userRole === 'SUPER_ADMIN' && handleStatusToggle(emp.id, emp.status || 'OFFLINE')}
                                            title={userRole === 'SUPER_ADMIN' ? (emp.status === 'SUSPENDED' ? 'Suspended - Click to unsuspend' : emp.status === 'ACTIVE' ? 'Online' : 'Offline - Click to suspend') : (emp.status === 'SUSPENDED' ? 'Suspended' : emp.status === 'ACTIVE' ? 'Online' : 'Offline')}
                                            style={{
                                                width: '12px',
                                                height: '12px',
                                                borderRadius: '50%',
                                                background: emp.status === 'SUSPENDED' ? '#ef4444' : emp.status === 'ACTIVE' ? '#22c55e' : '#f97316',
                                                cursor: userRole === 'SUPER_ADMIN' ? 'pointer' : 'default',
                                                flexShrink: 0,
                                                boxShadow: `0 0 0 2px ${emp.status === 'SUSPENDED' ? '#fecaca' : emp.status === 'ACTIVE' ? '#bbf7d0' : '#fed7aa'}`
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
                                            {emp.totalDifficultyPoints || 0} pts
                                        </span>
                                    </div>
                                    <p style={{ margin: '0.5rem 0 0 0', color: '#64748b', fontSize: '0.875rem' }}>{emp.email}</p>
                                    {emp.role && emp.role !== 'EMPLOYEE' && (
                                        <span style={{
                                            display: 'inline-block',
                                            marginTop: '0.25rem',
                                            padding: '0.125rem 0.5rem',
                                            background: '#fef3c7',
                                            color: '#92400e',
                                            borderRadius: '0.25rem',
                                            fontSize: '0.75rem',
                                            fontWeight: 'bold'
                                        }}>
                                            {emp.role}
                                        </span>
                                    )}
                                </div>
                                <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
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
                                                Edit
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
                                                History
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
                                                Add Bonus
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
                                                Add Deduction
                                            </Link>
                                            <button
                                                onClick={() => handleResetPoints(emp.id)}
                                                className="btn"
                                                style={{
                                                    background: '#fef3c7',
                                                    color: '#92400e',
                                                    padding: '0.5rem 1rem',
                                                    fontSize: '0.875rem'
                                                }}
                                            >
                                                Reset Points
                                            </button>
                                            {emp.role !== 'SUPER_ADMIN' && (
                                                <button
                                                    onClick={() => handleDelete(emp.id, `${emp.firstName} ${emp.lastName}`)}
                                                    className="btn"
                                                    style={{
                                                        background: '#fee2e2',
                                                        color: '#991b1b',
                                                        padding: '0.5rem 1rem',
                                                        fontSize: '0.875rem'
                                                    }}
                                                >
                                                    Delete
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

            {deleteConfirm && (
                <div style={{
                    position: 'fixed',
                    top: 0,
                    left: 0,
                    right: 0,
                    bottom: 0,
                    background: 'rgba(0, 0, 0, 0.5)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    zIndex: 1000
                }}>
                    <div className="card" style={{ maxWidth: '400px', padding: '1.5rem' }}>
                        <h3 style={{ marginTop: 0 }}>Confirm Delete</h3>
                        <p>Are you sure you want to delete <strong>{deleteConfirm.name}</strong>?</p>
                        <p style={{ color: '#991b1b', fontSize: '0.875rem' }}>This action cannot be undone.</p>
                        <div style={{ display: 'flex', gap: '1rem', marginTop: '1.5rem' }}>
                            <button
                                onClick={confirmDelete}
                                className="btn"
                                style={{ background: '#991b1b', color: 'white', flex: 1 }}
                            >
                                Delete
                            </button>
                            <button
                                onClick={() => setDeleteConfirm(null)}
                                className="btn"
                                style={{ background: '#e2e8f0', color: '#0f172a', flex: 1 }}
                            >
                                Cancel
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}

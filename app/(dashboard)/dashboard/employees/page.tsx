'use client'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { useSession } from 'next-auth/react'


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

    const fetchEmployees = async () => {
        const res = await fetch('/api/users')
        const data = await res.json()
        // Filter out current user
        const filteredData = data.filter((u: Employee) => u.id !== (session?.user?.id || ''))
        setEmployees(filteredData)
        setLoading(false)
    }

    useEffect(() => {
        if (session?.user) {
            fetchEmployees()
        }
    }, [session])

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

            <div style={{ display: 'grid', gap: '1rem' }}>
                {employees.length === 0 ? (
                    <p>No employees found.</p>
                ) : (
                    employees.map(emp => (
                        <div key={emp.id} className="card">
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                <div style={{ flex: 1 }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                                        {/* Status Dot Indicator */}
                                        <div
                                            onClick={() => ['ADMIN', 'SUPER_ADMIN'].includes(userRole) && handleStatusToggle(emp.id, emp.status || 'OFFLINE')}
                                            title={['ADMIN', 'SUPER_ADMIN'].includes(userRole) ? (emp.status === 'SUSPENDED' ? 'Suspended - Click to unsuspend' : emp.status === 'ACTIVE' ? 'Online' : 'Offline - Click to suspend') : (emp.status === 'SUSPENDED' ? 'Suspended' : emp.status === 'ACTIVE' ? 'Online' : 'Offline')}
                                            style={{
                                                width: '12px',
                                                height: '12px',
                                                borderRadius: '50%',
                                                background: emp.status === 'SUSPENDED' ? '#ef4444' : emp.status === 'ACTIVE' ? '#22c55e' : '#f97316',
                                                cursor: ['ADMIN', 'SUPER_ADMIN'].includes(userRole) ? 'pointer' : 'default',
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

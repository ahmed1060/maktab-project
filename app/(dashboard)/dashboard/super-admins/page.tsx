'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useSession } from 'next-auth/react'

type Admin = {
    id: string
    firstName: string
    lastName: string
    email: string
    role: string
    status: string
    gender?: string
}

export default function SuperAdminsPage() {
    const [admins, setAdmins] = useState<Admin[]>([])
    const [loading, setLoading] = useState(true)
    const [showCreateModal, setShowCreateModal] = useState(false)
    const [viewingAdmin, setViewingAdmin] = useState<Admin | null>(null)
    const [editingAdmin, setEditingAdmin] = useState<Admin | null>(null)

    const { data: session } = useSession()

    // Create Form State
    const [formData, setFormData] = useState({
        firstName: '',
        lastName: '',
        email: '',
        password: '',
        gender: 'MALE'
    })

    // Edit Form State
    const [editData, setEditData] = useState({
        firstName: '',
        lastName: '',
        email: '',
        gender: 'MALE'
    })

    const [submitLoading, setSubmitLoading] = useState(false)
    const [error, setError] = useState('')

    const fetchAdmins = async () => {
        try {
            const res = await fetch('/api/super-admins')
            if (res.ok) {
                const data = await res.json()
                setAdmins(data)
            }
        } catch (e) {
            console.error('Failed to fetch admins')
        } finally {
            setLoading(false)
        }
    }

    useEffect(() => {
        fetchAdmins()
    }, [])

    const handleCreate = async (e: React.FormEvent) => {
        e.preventDefault()
        setSubmitLoading(true)
        setError('')

        try {
            // Note: Currently calling super-admins API which enforces SHSD or similar logic
            // Ideally we should unify this with /api/users but /api/super-admins is specific
            const res = await fetch('/api/super-admins', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(formData)
            })

            const data = await res.json()

            if (!res.ok) {
                throw new Error(data.error || 'Failed to create')
            }

            setShowCreateModal(false)
            setFormData({ firstName: '', lastName: '', email: '', password: '', gender: 'MALE' })
            fetchAdmins()
        } catch (err: any) {
            setError(err.message)
        } finally {
            setSubmitLoading(false)
        }
    }

    const handleUpdate = async (e: React.FormEvent) => {
        e.preventDefault()
        if (!editingAdmin) return

        setSubmitLoading(true)
        setError('')

        try {
            const res = await fetch('/api/users', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    id: editingAdmin.id,
                    ...editData
                })
            })

            if (!res.ok) {
                const text = await res.text()
                throw new Error(text || 'Failed to update')
            }

            setEditingAdmin(null)
            fetchAdmins()
        } catch (err: any) {
            setError(err.message)
        } finally {
            setSubmitLoading(false)
        }
    }



    const openEdit = (admin: Admin) => {
        setEditingAdmin(admin)
        setEditData({
            firstName: admin.firstName,
            lastName: admin.lastName,
            email: admin.email,
            gender: admin.gender || 'MALE'
        })
    }

    return (
        <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
                <div>
                    <h1 style={{ fontSize: '1.8rem', fontWeight: 'bold' }}>Super Admins</h1>
                    <p style={{ color: '#64748b' }}>Manage system administrators</p>
                </div>
                <button
                    className="btn btn-primary"
                    onClick={() => setShowCreateModal(true)}
                >
                    + Add New Admin
                </button>
            </div>

            {loading ? <p>Loading...</p> : (
                <div style={{ background: 'white', borderRadius: '12px', overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                        <thead style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
                            <tr>
                                <th style={{ textAlign: 'left', padding: '1rem', fontSize: '0.875rem', color: '#64748b' }}>Name</th>
                                <th style={{ textAlign: 'left', padding: '1rem', fontSize: '0.875rem', color: '#64748b' }}>Email</th>
                                <th style={{ textAlign: 'left', padding: '1rem', fontSize: '0.875rem', color: '#64748b' }}>Status</th>
                                <th style={{ textAlign: 'right', padding: '1rem', fontSize: '0.875rem', color: '#64748b' }}>Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {admins.map(admin => (
                                <tr key={admin.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                                    <td style={{ padding: '1rem' }}>
                                        <div style={{ fontWeight: '500' }}>{admin.firstName} {admin.lastName}</div>
                                    </td>
                                    <td style={{ padding: '1rem' }}>{admin.email}</td>
                                    <td style={{ padding: '1rem' }}>
                                        <span style={{
                                            padding: '0.25rem 0.75rem',
                                            borderRadius: '999px',
                                            fontSize: '0.75rem',
                                            background: admin.status === 'ACTIVE' ? '#dcfce7' : '#fef9c3',
                                            color: admin.status === 'ACTIVE' ? '#166534' : '#854d0e',
                                            fontWeight: '600'
                                        }}>
                                            {admin.status}
                                        </span>
                                    </td>
                                    <td style={{ padding: '1rem', textAlign: 'right' }}>
                                        <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
                                            <button
                                                onClick={() => setViewingAdmin(admin)}
                                                className="btn"
                                                style={{ padding: '0.4rem 0.8rem', fontSize: '0.8rem', background: '#e0f2fe', color: '#0369a1' }}
                                            >
                                                View
                                            </button>
                                            <button
                                                onClick={() => openEdit(admin)}
                                                className="btn"
                                                style={{ padding: '0.4rem 0.8rem', fontSize: '0.8rem', background: '#f1f5f9', color: '#334155' }}
                                            >
                                                Edit
                                            </button>
                                        </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}

            {/* Create Modal */}
            {showCreateModal && (
                <div style={{
                    position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
                    background: 'rgba(0,0,0,0.5)', display: 'flex', justifyContent: 'center',
                    alignItems: 'center', zIndex: 100
                }}>
                    <div style={{ background: 'white', padding: '2rem', borderRadius: '12px', width: '100%', maxWidth: '500px' }}>
                        <h2 style={{ fontSize: '1.5rem', fontWeight: 'bold', marginBottom: '1.5rem' }}>Add Super Admin</h2>
                        {error && <div style={{ color: 'red', marginBottom: '1rem', fontSize: '0.9rem' }}>{error}</div>}
                        <form onSubmit={handleCreate}>
                            {/* ... Same fields as before ... */}
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1rem' }}>
                                <div>
                                    <label style={{ display: 'block', fontSize: '0.875rem', marginBottom: '0.5rem' }}>First Name</label>
                                    <input className="input" required value={formData.firstName} onChange={e => setFormData({ ...formData, firstName: e.target.value })} />
                                </div>
                                <div>
                                    <label style={{ display: 'block', fontSize: '0.875rem', marginBottom: '0.5rem' }}>Last Name</label>
                                    <input className="input" required value={formData.lastName} onChange={e => setFormData({ ...formData, lastName: e.target.value })} />
                                </div>
                            </div>
                            <div style={{ marginBottom: '1rem' }}>
                                <label style={{ display: 'block', fontSize: '0.875rem', marginBottom: '0.5rem' }}>Email</label>
                                <input className="input" type="email" required value={formData.email} onChange={e => setFormData({ ...formData, email: e.target.value })} />
                            </div>
                            <div style={{ marginBottom: '1rem' }}>
                                <label style={{ display: 'block', fontSize: '0.875rem', marginBottom: '0.5rem' }}>Password</label>
                                <input className="input" type="password" required value={formData.password} onChange={e => setFormData({ ...formData, password: e.target.value })} />
                            </div>
                            <div style={{ marginBottom: '1.5rem' }}>
                                <label style={{ display: 'block', fontSize: '0.875rem', marginBottom: '0.5rem' }}>Gender</label>
                                <select className="input" value={formData.gender} onChange={e => setFormData({ ...formData, gender: e.target.value })}>
                                    <option value="MALE">Male</option>
                                    <option value="FEMALE">Female</option>
                                </select>
                            </div>
                            <div style={{ display: 'flex', gap: '1rem', justifyContent: 'flex-end' }}>
                                <button type="button" onClick={() => setShowCreateModal(false)} style={{ padding: '0.75rem 1.5rem', border: '1px solid #e2e8f0', borderRadius: '0.5rem', background: 'transparent' }}>Cancel</button>
                                <button type="submit" className="btn btn-primary" disabled={submitLoading}>{submitLoading ? 'Creating...' : 'Create'}</button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* View Modal */}
            {viewingAdmin && (
                <div style={{
                    position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
                    background: 'rgba(0,0,0,0.5)', display: 'flex', justifyContent: 'center',
                    alignItems: 'center', zIndex: 100
                }}>
                    <div style={{ background: 'white', padding: '2rem', borderRadius: '12px', width: '100%', maxWidth: '400px' }}>
                        <h2 style={{ fontSize: '1.5rem', fontWeight: 'bold', marginBottom: '1.5rem' }}>Admin Profile</h2>
                        <div style={{ marginBottom: '1rem' }}>
                            <label style={{ color: '#64748b', fontSize: '0.875rem' }}>Full Name</label>
                            <div style={{ fontWeight: '500', fontSize: '1.1rem' }}>{viewingAdmin.firstName} {viewingAdmin.lastName}</div>
                        </div>
                        <div style={{ marginBottom: '1rem' }}>
                            <label style={{ color: '#64748b', fontSize: '0.875rem' }}>Email</label>
                            <div>{viewingAdmin.email}</div>
                        </div>
                        <div style={{ marginBottom: '1rem' }}>
                            <label style={{ color: '#64748b', fontSize: '0.875rem' }}>Role</label>
                            <div style={{ color: '#d97706', fontWeight: 'bold' }}>{viewingAdmin.role}</div>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '2rem' }}>
                            <button className="btn" onClick={() => setViewingAdmin(null)} style={{ background: '#e2e8f0', color: '#0f172a' }}>Close</button>
                        </div>
                    </div>
                </div>
            )}

            {/* Edit Modal */}
            {editingAdmin && (
                <div style={{
                    position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
                    background: 'rgba(0,0,0,0.5)', display: 'flex', justifyContent: 'center',
                    alignItems: 'center', zIndex: 100
                }}>
                    <div style={{ background: 'white', padding: '2rem', borderRadius: '12px', width: '100%', maxWidth: '500px' }}>
                        <h2 style={{ fontSize: '1.5rem', fontWeight: 'bold', marginBottom: '1.5rem' }}>Edit Admin</h2>
                        {error && <div style={{ color: 'red', marginBottom: '1rem', fontSize: '0.9rem' }}>{error}</div>}
                        <form onSubmit={handleUpdate}>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1rem' }}>
                                <div>
                                    <label style={{ display: 'block', fontSize: '0.875rem', marginBottom: '0.5rem' }}>First Name</label>
                                    <input className="input" required value={editData.firstName} onChange={e => setEditData({ ...editData, firstName: e.target.value })} />
                                </div>
                                <div>
                                    <label style={{ display: 'block', fontSize: '0.875rem', marginBottom: '0.5rem' }}>Last Name</label>
                                    <input className="input" required value={editData.lastName} onChange={e => setEditData({ ...editData, lastName: e.target.value })} />
                                </div>
                            </div>
                            <div style={{ marginBottom: '1rem' }}>
                                <label style={{ display: 'block', fontSize: '0.875rem', marginBottom: '0.5rem' }}>Email</label>
                                <input className="input" type="email" required value={editData.email} onChange={e => setEditData({ ...editData, email: e.target.value })} />
                            </div>
                            <div style={{ marginBottom: '1.5rem' }}>
                                <label style={{ display: 'block', fontSize: '0.875rem', marginBottom: '0.5rem' }}>Gender</label>
                                <select className="input" value={editData.gender} onChange={e => setEditData({ ...editData, gender: e.target.value })}>
                                    <option value="MALE">Male</option>
                                    <option value="FEMALE">Female</option>
                                </select>
                            </div>
                            <div style={{ display: 'flex', gap: '1rem', justifyContent: 'flex-end' }}>
                                <button type="button" onClick={() => setEditingAdmin(null)} style={{ padding: '0.75rem 1.5rem', border: '1px solid #e2e8f0', borderRadius: '0.5rem', background: 'transparent' }}>Cancel</button>
                                <button type="submit" className="btn btn-primary" disabled={submitLoading}>{submitLoading ? 'Saving...' : 'Save Changes'}</button>
                            </div>
                        </form>
                    </div>
                </div>
            )}


        </div>
    )
}

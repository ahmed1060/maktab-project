'use client'

import { useState, useEffect, useCallback } from 'react'
import { useSession } from 'next-auth/react'
import AccessDenied from '@/components/AccessDenied'
import { useLanguage } from '@/context/LanguageContext'
import { useHeader } from '@/context/HeaderContext'
import Pagination from '@/components/Pagination'

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
    const { t, locale } = useLanguage()
    const { setTitle, setSubtitle } = useHeader()
    const [admins, setAdmins] = useState<Admin[]>([])
    const [loading, setLoading] = useState(true)
    const [showCreateModal, setShowCreateModal] = useState(false)
    const [viewingAdmin, setViewingAdmin] = useState<Admin | null>(null)
    const [editingAdmin, setEditingAdmin] = useState<Admin | null>(null)

    const { data: session } = useSession()
    const userRole = session?.user?.role || ''

    const [formData, setFormData] = useState({
        firstName: '',
        lastName: '',
        email: '',
        password: '',
        gender: 'MALE'
    })

    const [editData, setEditData] = useState({
        firstName: '',
        lastName: '',
        email: '',
        gender: 'MALE'
    })

    const [submitLoading, setSubmitLoading] = useState(false)
    const [showPassword, setShowPassword] = useState(false)
    const [error, setError] = useState('')

    const [page, setPage] = useState(1)
    const [totalPages, setTotalPages] = useState(0)
    const limit = 10

    const fetchAdmins = useCallback(async () => {
        setLoading(true)
        try {
            const res = await fetch(`/api/super-admins?page=${page}&limit=${limit}`)
            if (res.ok) {
                const result = await res.json()
                const data = result.data
                setAdmins(data.data || data)
                setTotalPages(data.totalPages || result.totalPages || 0)
            }
        } catch (err) {
            console.error('Failed to fetch admins', err)
        } finally {
            setLoading(false)
        }
    }, [page, limit])

    useEffect(() => {
        if (userRole === 'SUPER_ADMIN') {
            fetchAdmins()
        }
    }, [userRole, fetchAdmins])

    useEffect(() => {
        setTitle(t('super_admins'))
        setSubtitle(t('super_admins_subtitle' as any))
        return () => {
            setTitle(null)
            setSubtitle(null)
        }
    }, [setTitle, setSubtitle, t])

    if (userRole !== 'SUPER_ADMIN') {
        return <AccessDenied />
    }

    const handleCreate = async (e: React.FormEvent) => {
        e.preventDefault()
        setSubmitLoading(true)
        setError('')

        try {
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

    const getStatusKey = (status: string) => {
        switch (status) {
            case 'ACTIVE': return 'status_online'
            case 'OFFLINE': return 'status_offline'
            case 'BANNED': return 'status_banned'
            default: return 'status_pending'
        }
    }

    const getStatusStyles = (status: string) => {
        switch (status) {
            case 'ACTIVE':
                return { background: '#dcfce7', color: '#166534' }
            case 'OFFLINE':
                return { background: '#fef9c3', color: '#854d0e' }
            case 'BANNED':
                return { background: '#fee2e2', color: '#991b1b' }
            default:
                return { background: '#f1f5f9', color: '#475569' }
        }
    }

    return (
        <div style={{ direction: locale === 'ar' ? 'rtl' : 'ltr' }}>
            <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', marginBottom: '2rem' }}>
                <button
                    className="btn btn-primary"
                    onClick={() => setShowCreateModal(true)}
                    style={{ height: '48px', display: 'flex', alignItems: 'center', borderRadius: '1.25rem' }}
                >
                    + {t('add_super_admin_button')}
                </button>
            </div>

            {loading ? <p style={{ textAlign: locale === 'ar' ? 'right' : 'left' }}>{t('loading_users')}</p> : (
                <div style={{ background: 'white', borderRadius: '12px', overflowX: 'auto', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '600px' }}>
                        <thead style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
                            <tr>
                                <th style={{ textAlign: locale === 'ar' ? 'right' : 'left', padding: '1rem', fontSize: '0.875rem', color: '#64748b' }}>{t('name_label')}</th>
                                <th style={{ textAlign: locale === 'ar' ? 'right' : 'left', padding: '1rem', fontSize: '0.875rem', color: '#64748b' }}>{t('email')}</th>
                                <th style={{ textAlign: locale === 'ar' ? 'right' : 'left', padding: '1rem', fontSize: '0.875rem', color: '#64748b' }}>{t('system')}</th>
                                <th style={{ textAlign: locale === 'ar' ? 'left' : 'right', padding: '1rem', fontSize: '0.875rem', color: '#64748b' }}>{t('quick_actions')}</th>
                            </tr>
                        </thead>
                        <tbody>
                            {admins.map(admin => (
                                <tr key={admin.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                                    <td style={{ padding: '1rem', textAlign: locale === 'ar' ? 'right' : 'left' }}>
                                        <div
                                            style={{ fontWeight: '500', cursor: 'pointer', color: '#2563eb' }}
                                            onClick={() => setViewingAdmin(admin)}
                                        >
                                            {admin.firstName} {admin.lastName}
                                        </div>
                                    </td>
                                    <td style={{ padding: '1rem', textAlign: locale === 'ar' ? 'right' : 'left' }}>{admin.email}</td>
                                    <td style={{ padding: '1rem', textAlign: locale === 'ar' ? 'right' : 'left' }}>
                                        <span style={{
                                            padding: '0.25rem 0.75rem',
                                            borderRadius: '999px',
                                            fontSize: '0.75rem',
                                            fontWeight: '600',
                                            ...getStatusStyles(admin.status)
                                        }}>
                                            {t(getStatusKey(admin.status) as any)}
                                        </span>
                                    </td>
                                    <td style={{ padding: '1rem', textAlign: locale === 'ar' ? 'left' : 'right' }}>
                                        <div style={{ display: 'flex', gap: '0.5rem', justifyContent: locale === 'ar' ? 'flex-start' : 'flex-end' }}>
                                            <button
                                                onClick={() => openEdit(admin)}
                                                className="btn"
                                                style={{ padding: '0.4rem 0.8rem', fontSize: '0.8rem', background: '#f1f5f9', color: '#334155' }}
                                            >
                                                {t('edit')}
                                            </button>
                                        </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}

            <Pagination
                currentPage={page}
                totalPages={totalPages}
                onPageChange={(p) => setPage(p)}
            />

            {/* Create Modal */}
            {showCreateModal && (
                <div style={{
                    position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
                    background: 'rgba(0,0,0,0.5)', display: 'flex', justifyContent: 'center',
                    alignItems: 'center', zIndex: 100
                }}>
                    <div
                        style={{ position: 'absolute', inset: 0 }}
                        onClick={() => setShowCreateModal(false)}
                    />
                    <div style={{ background: 'white', padding: '2rem', borderRadius: '12px', width: '100%', maxWidth: '500px', position: 'relative', zIndex: 101, direction: locale === 'ar' ? 'rtl' : 'ltr' }}>
                        <h2 style={{ fontSize: '1.5rem', fontWeight: 'bold', marginBottom: '1.5rem', textAlign: locale === 'ar' ? 'right' : 'left' }}>{t('add_super_admin_title')}</h2>
                        {error && <div style={{ color: 'red', marginBottom: '1rem', fontSize: '0.9rem', textAlign: locale === 'ar' ? 'right' : 'left' }}>{error}</div>}
                        <form onSubmit={handleCreate}>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1rem' }}>
                                <div>
                                    <label style={{ display: 'block', fontSize: '0.875rem', marginBottom: '0.5rem', textAlign: locale === 'ar' ? 'right' : 'left' }}>{t('first_name_label')}</label>
                                    <input className="input" required value={formData.firstName} onChange={e => setFormData({ ...formData, firstName: e.target.value })} style={{ textAlign: locale === 'ar' ? 'right' : 'left' }} />
                                </div>
                                <div>
                                    <label style={{ display: 'block', fontSize: '0.875rem', marginBottom: '0.5rem', textAlign: locale === 'ar' ? 'right' : 'left' }}>{t('last_name_label')}</label>
                                    <input className="input" required value={formData.lastName} onChange={e => setFormData({ ...formData, lastName: e.target.value })} style={{ textAlign: locale === 'ar' ? 'right' : 'left' }} />
                                </div>
                            </div>
                            <div style={{ marginBottom: '1rem' }}>
                                <label style={{ display: 'block', fontSize: '0.875rem', marginBottom: '0.5rem', textAlign: locale === 'ar' ? 'right' : 'left' }}>{t('email')}</label>
                                <input className="input" type="email" required value={formData.email} onChange={e => setFormData({ ...formData, email: e.target.value })} style={{ textAlign: locale === 'ar' ? 'right' : 'left' }} />
                            </div>
                            <div style={{ marginBottom: '1rem', position: 'relative' }}>
                                <label style={{ display: 'block', fontSize: '0.875rem', marginBottom: '0.5rem', textAlign: locale === 'ar' ? 'right' : 'left' }}>{t('password')}</label>
                                <input
                                    className="input"
                                    type={showPassword ? "text" : "password"}
                                    required
                                    value={formData.password}
                                    onChange={e => setFormData({ ...formData, password: e.target.value })}
                                    style={{ paddingRight: locale === 'ar' ? '1rem' : '2.5rem', paddingLeft: locale === 'ar' ? '2.5rem' : '1rem', textAlign: locale === 'ar' ? 'right' : 'left' }}
                                />
                                <button
                                    type="button"
                                    onClick={() => setShowPassword(!showPassword)}
                                    style={{
                                        position: 'absolute',
                                        [locale === 'ar' ? 'left' : 'right']: '0.75rem',
                                        top: '2.25rem',
                                        background: 'none',
                                        border: 'none',
                                        cursor: 'pointer',
                                        padding: '0.25rem',
                                        display: 'flex',
                                        alignItems: 'center',
                                        color: '#64748b'
                                    }}
                                >
                                    {showPassword ? (
                                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                            <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path>
                                            <line x1="1" y1="1" x2="23" y2="23"></line>
                                        </svg>
                                    ) : (
                                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
                                            <circle cx="12" cy="12" r="3"></circle>
                                        </svg>
                                    )}
                                </button>
                            </div>
                            <div style={{ marginBottom: '1.5rem' }}>
                                <label style={{ display: 'block', fontSize: '0.875rem', marginBottom: '0.5rem', textAlign: locale === 'ar' ? 'right' : 'left' }}>{t('gender_label')}</label>
                                <select className="input" value={formData.gender} onChange={e => setFormData({ ...formData, gender: e.target.value })} style={{ textAlign: locale === 'ar' ? 'right' : 'left' }}>
                                    <option value="MALE">{t('male')}</option>
                                    <option value="FEMALE">{t('female')}</option>
                                </select>
                            </div>
                            <div style={{ display: 'flex', gap: '1rem', justifyContent: locale === 'ar' ? 'flex-start' : 'flex-end', flexDirection: 'row' }}>
                                <button type="button" onClick={() => setShowCreateModal(false)} style={{ padding: '0.75rem 1.5rem', border: '1px solid #e2e8f0', borderRadius: '0.5rem', background: 'transparent' }}>{t('cancel')}</button>
                                <button type="submit" className="btn btn-primary" disabled={submitLoading}>{submitLoading ? t('creating') : t('sign_in')}</button>
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
                    <div
                        style={{ position: 'absolute', inset: 0 }}
                        onClick={() => setViewingAdmin(null)}
                    />
                    <div style={{ background: 'white', padding: '2rem', borderRadius: '12px', width: '100%', maxWidth: '400px', position: 'relative', zIndex: 101, direction: locale === 'ar' ? 'rtl' : 'ltr' }}>
                        <h2 style={{ fontSize: '1.5rem', fontWeight: 'bold', marginBottom: '1.5rem', textAlign: locale === 'ar' ? 'right' : 'left' }}>{t('profile_title')}</h2>
                        <div style={{ marginBottom: '1rem' }}>
                            <label style={{ color: '#64748b', fontSize: '0.875rem', display: 'block', textAlign: locale === 'ar' ? 'right' : 'left' }}>{t('full_name_label')}</label>
                            <div style={{ fontWeight: '500', fontSize: '1.1rem', textAlign: locale === 'ar' ? 'right' : 'left' }}>{viewingAdmin.firstName} {viewingAdmin.lastName}</div>
                        </div>
                        <div style={{ marginBottom: '1rem' }}>
                            <label style={{ color: '#64748b', fontSize: '0.875rem', display: 'block', textAlign: locale === 'ar' ? 'right' : 'left' }}>{t('email')}</label>
                            <div style={{ textAlign: locale === 'ar' ? 'right' : 'left' }}>{viewingAdmin.email}</div>
                        </div>
                        <div style={{ marginBottom: '1rem' }}>
                            <label style={{ color: '#64748b', fontSize: '0.875rem', display: 'block', textAlign: locale === 'ar' ? 'right' : 'left' }}>{t('role_label')}</label>
                            <div style={{ color: '#d97706', fontWeight: 'bold', textAlign: locale === 'ar' ? 'right' : 'left' }}>{t('super_admins')}</div>
                        </div>
                        <div style={{ display: 'flex', justifyContent: locale === 'ar' ? 'flex-start' : 'flex-end', marginTop: '2rem' }}>
                            <button className="btn" onClick={() => setViewingAdmin(null)} style={{ background: '#e2e8f0', color: '#0f172a' }}>{t('close_button')}</button>
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
                    <div
                        style={{ position: 'absolute', inset: 0 }}
                        onClick={() => setEditingAdmin(null)}
                    />
                    <div style={{ background: 'white', padding: '2rem', borderRadius: '12px', width: '100%', maxWidth: '500px', position: 'relative', zIndex: 101, direction: locale === 'ar' ? 'rtl' : 'ltr' }}>
                        <h2 style={{ fontSize: '1.5rem', fontWeight: 'bold', marginBottom: '1.5rem', textAlign: locale === 'ar' ? 'right' : 'left' }}>{t('edit_admin_title')}</h2>
                        {error && <div style={{ color: 'red', marginBottom: '1rem', fontSize: '0.9rem', textAlign: locale === 'ar' ? 'right' : 'left' }}>{error}</div>}
                        <form onSubmit={handleUpdate}>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1rem' }}>
                                <div>
                                    <label style={{ display: 'block', fontSize: '0.875rem', marginBottom: '0.5rem', textAlign: locale === 'ar' ? 'right' : 'left' }}>{t('first_name_label')}</label>
                                    <input className="input" required value={editData.firstName} onChange={e => setEditData({ ...editData, firstName: e.target.value })} style={{ textAlign: locale === 'ar' ? 'right' : 'left' }} />
                                </div>
                                <div>
                                    <label style={{ display: 'block', fontSize: '0.875rem', marginBottom: '0.5rem', textAlign: locale === 'ar' ? 'right' : 'left' }}>{t('last_name_label')}</label>
                                    <input className="input" required value={editData.lastName} onChange={e => setEditData({ ...editData, lastName: e.target.value })} style={{ textAlign: locale === 'ar' ? 'right' : 'left' }} />
                                </div>
                            </div>
                            <div style={{ marginBottom: '1rem' }}>
                                <label style={{ display: 'block', fontSize: '0.875rem', marginBottom: '0.5rem', textAlign: locale === 'ar' ? 'right' : 'left' }}>{t('email')}</label>
                                <input className="input" type="email" required value={editData.email} onChange={e => setEditData({ ...editData, email: e.target.value })} style={{ textAlign: locale === 'ar' ? 'right' : 'left' }} />
                            </div>
                            <div style={{ marginBottom: '1.5rem' }}>
                                <label style={{ display: 'block', fontSize: '0.875rem', marginBottom: '0.5rem', textAlign: locale === 'ar' ? 'right' : 'left' }}>{t('gender_label')}</label>
                                <select className="input" value={editData.gender} onChange={e => setEditData({ ...editData, gender: e.target.value })} style={{ textAlign: locale === 'ar' ? 'right' : 'left' }}>
                                    <option value="MALE">{t('male')}</option>
                                    <option value="FEMALE">{t('female')}</option>
                                </select>
                            </div>
                            <div style={{ display: 'flex', gap: '1rem', justifyContent: locale === 'ar' ? 'flex-start' : 'flex-end', flexDirection: 'row' }}>
                                <button type="button" onClick={() => setEditingAdmin(null)} style={{ padding: '0.75rem 1.5rem', border: '1px solid #e2e8f0', borderRadius: '0.5rem', background: 'transparent' }}>{t('cancel')}</button>
                                <button type="submit" className="btn btn-primary" disabled={submitLoading}>{submitLoading ? t('saving') : t('save_changes_button')}</button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    )
}

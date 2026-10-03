'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import useSWR from 'swr'
import { useSession } from 'next-auth/react'
import AccessDenied from '@/components/AccessDenied'
import ConfirmModal from '@/components/ConfirmModal'
import { useLanguage } from '@/context/LanguageContext'
import { useHeader } from '@/context/HeaderContext'
import Pagination from '@/components/Pagination'
import { fetcher } from '@/lib/swr-fetcher'
import NoticeModal, { Notice } from '@/components/NoticeModal'

type Admin = {
    id: string
    firstName: string
    lastName: string
    email: string
    role: string
    status: string
    gender?: string
    isProtected?: boolean
}

export default function SuperAdminsPage() {
    const { t, locale } = useLanguage()
    const { setTitle, setSubtitle } = useHeader()
    const [showCreateModal, setShowCreateModal] = useState(false)
    const [viewingAdmin, setViewingAdmin] = useState<Admin | null>(null)
    const [editingAdmin, setEditingAdmin] = useState<Admin | null>(null)
    const [deleteConfirm, setDeleteConfirm] = useState<Admin | null>(null)
    // Replaces alert(): a native dialog ignores the palette entirely, and it
    // blocks the main thread for as long as it is up.
    const [notice, setNotice] = useState<Notice | null>(null)
    const [deleting, setDeleting] = useState(false)

    const { data: session } = useSession()
    const userRole = session?.user?.role || ''
    const isProtectedActor = !!session?.user?.isProtected

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
    const limit = 10

    const adminsQuery = userRole === 'SUPER_ADMIN' ? `/api/super-admins?page=${page}&limit=${limit}` : null
    const { data: result, isLoading: loading, mutate: fetchAdmins } = useSWR(adminsQuery, fetcher)
    const admins: Admin[] = result?.data?.data || result?.data || []
    const totalPages: number = result?.data?.totalPages || result?.totalPages || 0

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
            const res = await fetch(`/api/super-admins/${editingAdmin.id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(editData)
            })

            const data = await res.json()

            if (!res.ok) {
                throw new Error(data.error || 'Failed to update')
            }

            setEditingAdmin(null)
            fetchAdmins()
        } catch (err: any) {
            setError(err.message)
        } finally {
            setSubmitLoading(false)
        }
    }

    const handleDelete = async () => {
        if (!deleteConfirm) return
        setDeleting(true)
        try {
            const res = await fetch(`/api/super-admins/${deleteConfirm.id}`, { method: 'DELETE' })
            const data = await res.json()
            if (!res.ok) {
                throw new Error(data.error || 'Failed to delete')
            }
            setDeleteConfirm(null)
            fetchAdmins()
        } catch (err: any) {
            // The delete confirm modal has no inline error slot, so surface
            // this the same way other destructive actions in the app do.
            setNotice({ variant: 'error', title: t('error_generic'), detail: err.message })
        } finally {
            setDeleting(false)
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
                return { background: 'var(--ok-bg)', color: 'var(--ok-fg)' }
            case 'OFFLINE':
                return { background: 'var(--warn-bg-yellow)', color: 'var(--warn-fg-yellow)' }
            case 'BANNED':
                return { background: 'var(--danger-bg)', color: 'var(--danger-fg)' }
            default:
                return { background: 'var(--surface-sunk)', color: 'var(--text-muted)' }
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
                <div style={{ background: 'var(--surface)', borderRadius: '12px', overflowX: 'auto', boxShadow: '0 1px 3px var(--shadow-weak)' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '600px' }}>
                        <thead style={{ background: 'var(--surface-subtle)', borderBottom: '1px solid var(--border)' }}>
                            <tr>
                                <th style={{ textAlign: locale === 'ar' ? 'right' : 'left', padding: '1rem', fontSize: '0.875rem', color: 'var(--text-soft)' }}>{t('name_label')}</th>
                                <th style={{ textAlign: locale === 'ar' ? 'right' : 'left', padding: '1rem', fontSize: '0.875rem', color: 'var(--text-soft)' }}>{t('email')}</th>
                                <th style={{ textAlign: locale === 'ar' ? 'right' : 'left', padding: '1rem', fontSize: '0.875rem', color: 'var(--text-soft)' }}>{t('system')}</th>
                                <th style={{ textAlign: locale === 'ar' ? 'left' : 'right', padding: '1rem', fontSize: '0.875rem', color: 'var(--text-soft)' }}>{t('quick_actions')}</th>
                            </tr>
                        </thead>
                        <tbody>
                            {admins.map(admin => (
                                <tr key={admin.id} style={{ borderBottom: '1px solid var(--surface-sunk)' }}>
                                    <td style={{ padding: '1rem', textAlign: locale === 'ar' ? 'right' : 'left' }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                            <div
                                                style={{ fontWeight: '500', cursor: 'pointer', color: 'var(--info-solid-hover)' }}
                                                onClick={() => setViewingAdmin(admin)}
                                            >
                                                {admin.firstName} {admin.lastName}
                                            </div>
                                            {admin.isProtected && (
                                                <span
                                                    title={locale === 'ar' ? 'حساب محمي من الحذف' : 'Protected from deletion'}
                                                    style={{
                                                        fontSize: '0.65rem',
                                                        fontWeight: '700',
                                                        padding: '0.15rem 0.5rem',
                                                        borderRadius: '999px',
                                                        background: 'var(--info-bg-indigo-subtle)',
                                                        color: 'var(--accent-deep)',
                                                        whiteSpace: 'nowrap'
                                                    }}
                                                >
                                                    🔒 {locale === 'ar' ? 'محمي' : 'Protected'}
                                                </span>
                                            )}
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
                                            {(admin.id === session?.user?.id || isProtectedActor) && (
                                                <button
                                                    onClick={() => openEdit(admin)}
                                                    className="btn"
                                                    style={{ padding: '0.4rem 0.8rem', fontSize: '0.8rem', background: 'var(--surface-sunk)', color: 'var(--text-body)' }}
                                                >
                                                    {t('edit')}
                                                </button>
                                            )}
                                            {isProtectedActor && !admin.isProtected && (
                                                <button
                                                    onClick={() => setDeleteConfirm(admin)}
                                                    className="btn"
                                                    style={{ padding: '0.4rem 0.8rem', fontSize: '0.8rem', background: 'var(--danger-bg)', color: 'var(--danger-solid-hover)' }}
                                                >
                                                    {t('delete')}
                                                </button>
                                            )}
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
                    background: 'var(--scrim)', display: 'flex', justifyContent: 'center',
                    alignItems: 'center', zIndex: 100
                }}>
                    <div
                        style={{ position: 'absolute', inset: 0 }}
                        onClick={() => setShowCreateModal(false)}
                    />
                    <div style={{ background: 'var(--surface)', padding: '2rem', borderRadius: '12px', width: '100%', maxWidth: '500px', position: 'relative', zIndex: 101, direction: locale === 'ar' ? 'rtl' : 'ltr' }}>
                        <h2 style={{ fontSize: '1.5rem', fontWeight: 'bold', marginBottom: '1.5rem', textAlign: locale === 'ar' ? 'right' : 'left' }}>{t('add_super_admin_title')}</h2>
                        {error && <div style={{ color: 'var(--danger-fg-strong)', marginBottom: '1rem', fontSize: '0.9rem', textAlign: locale === 'ar' ? 'right' : 'left' }}>{error}</div>}
                        <form onSubmit={handleCreate}>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1rem' }}>
                                <div>
                                    <label style={{ display: 'block', fontSize: '0.875rem', marginBottom: '0.5rem', textAlign: locale === 'ar' ? 'right' : 'left' }}>{t('first_name_label')}</label>
                                    <input aria-label={t('first_name_label')} className="input" required value={formData.firstName} onChange={e => setFormData({ ...formData, firstName: e.target.value })} style={{ textAlign: locale === 'ar' ? 'right' : 'left' }} />
                                </div>
                                <div>
                                    <label style={{ display: 'block', fontSize: '0.875rem', marginBottom: '0.5rem', textAlign: locale === 'ar' ? 'right' : 'left' }}>{t('last_name_label')}</label>
                                    <input aria-label={t('last_name_label')} className="input" required value={formData.lastName} onChange={e => setFormData({ ...formData, lastName: e.target.value })} style={{ textAlign: locale === 'ar' ? 'right' : 'left' }} />
                                </div>
                            </div>
                            <div style={{ marginBottom: '1rem' }}>
                                <label style={{ display: 'block', fontSize: '0.875rem', marginBottom: '0.5rem', textAlign: locale === 'ar' ? 'right' : 'left' }}>{t('email')}</label>
                                <input aria-label={t('email')} className="input" type="email" required value={formData.email} onChange={e => setFormData({ ...formData, email: e.target.value })} style={{ textAlign: locale === 'ar' ? 'right' : 'left' }} />
                            </div>
                            <div style={{ marginBottom: '1rem', position: 'relative' }}>
                                <label style={{ display: 'block', fontSize: '0.875rem', marginBottom: '0.5rem', textAlign: locale === 'ar' ? 'right' : 'left' }}>{t('password')}</label>
                                <input aria-label={t('password')}
                                    className="input"
                                    type={showPassword ? "text" : "password"}
                                    required
                                    value={formData.password}
                                    onChange={e => setFormData({ ...formData, password: e.target.value })}
                                    style={{ paddingRight: locale === 'ar' ? '1rem' : '2.5rem', paddingLeft: locale === 'ar' ? '2.5rem' : '1rem', textAlign: locale === 'ar' ? 'right' : 'left' }}
                                />
                                <button
                                    type="button"
                                    aria-label={showPassword ? t('hide_password' as any) : t('show_password' as any)}
                                    aria-pressed={showPassword}
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
                                        color: 'var(--text-soft)'
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
                                <select aria-label={t('gender_label')} className="input" value={formData.gender} onChange={e => setFormData({ ...formData, gender: e.target.value })} style={{ textAlign: locale === 'ar' ? 'right' : 'left' }}>
                                    <option value="MALE">{t('male')}</option>
                                    <option value="FEMALE">{t('female')}</option>
                                </select>
                            </div>
                            <div style={{ display: 'flex', gap: '1rem', justifyContent: locale === 'ar' ? 'flex-start' : 'flex-end', flexDirection: 'row' }}>
                                <button type="button" onClick={() => setShowCreateModal(false)} style={{ padding: '0.75rem 1.5rem', border: '1px solid var(--border)', borderRadius: '0.5rem', background: 'transparent' }}>{t('cancel')}</button>
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
                    background: 'var(--scrim)', display: 'flex', justifyContent: 'center',
                    alignItems: 'center', zIndex: 100
                }}>
                    <div
                        style={{ position: 'absolute', inset: 0 }}
                        onClick={() => setViewingAdmin(null)}
                    />
                    <div style={{ background: 'var(--surface)', padding: '2rem', borderRadius: '12px', width: '100%', maxWidth: '400px', position: 'relative', zIndex: 101, direction: locale === 'ar' ? 'rtl' : 'ltr' }}>
                        <h2 style={{ fontSize: '1.5rem', fontWeight: 'bold', marginBottom: '1.5rem', textAlign: locale === 'ar' ? 'right' : 'left' }}>{t('profile_title')}</h2>
                        <div style={{ marginBottom: '1rem' }}>
                            <label style={{ color: 'var(--text-soft)', fontSize: '0.875rem', display: 'block', textAlign: locale === 'ar' ? 'right' : 'left' }}>{t('full_name_label')}</label>
                            <div style={{ fontWeight: '500', fontSize: '1.1rem', textAlign: locale === 'ar' ? 'right' : 'left' }}>{viewingAdmin.firstName} {viewingAdmin.lastName}</div>
                        </div>
                        <div style={{ marginBottom: '1rem' }}>
                            <label style={{ color: 'var(--text-soft)', fontSize: '0.875rem', display: 'block', textAlign: locale === 'ar' ? 'right' : 'left' }}>{t('email')}</label>
                            <div style={{ textAlign: locale === 'ar' ? 'right' : 'left' }}>{viewingAdmin.email}</div>
                        </div>
                        <div style={{ marginBottom: '1rem' }}>
                            <label style={{ color: 'var(--text-soft)', fontSize: '0.875rem', display: 'block', textAlign: locale === 'ar' ? 'right' : 'left' }}>{t('role_label')}</label>
                            <div style={{ color: 'var(--warn-solid-hover)', fontWeight: 'bold', textAlign: locale === 'ar' ? 'right' : 'left' }}>{t('super_admins')}</div>
                        </div>
                        <div style={{ display: 'flex', justifyContent: locale === 'ar' ? 'flex-start' : 'flex-end', marginTop: '2rem' }}>
                            <button className="btn" onClick={() => setViewingAdmin(null)} style={{ background: 'var(--border)', color: 'var(--text-strong)' }}>{t('close_button')}</button>
                        </div>
                    </div>
                </div>
            )}

            {/* Edit Modal */}
            {editingAdmin && (
                <div style={{
                    position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
                    background: 'var(--scrim)', display: 'flex', justifyContent: 'center',
                    alignItems: 'center', zIndex: 100
                }}>
                    <div
                        style={{ position: 'absolute', inset: 0 }}
                        onClick={() => setEditingAdmin(null)}
                    />
                    <div style={{ background: 'var(--surface)', padding: '2rem', borderRadius: '12px', width: '100%', maxWidth: '500px', position: 'relative', zIndex: 101, direction: locale === 'ar' ? 'rtl' : 'ltr' }}>
                        <h2 style={{ fontSize: '1.5rem', fontWeight: 'bold', marginBottom: '1.5rem', textAlign: locale === 'ar' ? 'right' : 'left' }}>{t('edit_admin_title')}</h2>
                        {error && <div style={{ color: 'var(--danger-fg-strong)', marginBottom: '1rem', fontSize: '0.9rem', textAlign: locale === 'ar' ? 'right' : 'left' }}>{error}</div>}
                        <form onSubmit={handleUpdate}>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1rem' }}>
                                <div>
                                    <label style={{ display: 'block', fontSize: '0.875rem', marginBottom: '0.5rem', textAlign: locale === 'ar' ? 'right' : 'left' }}>{t('first_name_label')}</label>
                                    <input aria-label={t('first_name_label')} className="input" required value={editData.firstName} onChange={e => setEditData({ ...editData, firstName: e.target.value })} style={{ textAlign: locale === 'ar' ? 'right' : 'left' }} />
                                </div>
                                <div>
                                    <label style={{ display: 'block', fontSize: '0.875rem', marginBottom: '0.5rem', textAlign: locale === 'ar' ? 'right' : 'left' }}>{t('last_name_label')}</label>
                                    <input aria-label={t('last_name_label')} className="input" required value={editData.lastName} onChange={e => setEditData({ ...editData, lastName: e.target.value })} style={{ textAlign: locale === 'ar' ? 'right' : 'left' }} />
                                </div>
                            </div>
                            <div style={{ marginBottom: '1rem' }}>
                                <label style={{ display: 'block', fontSize: '0.875rem', marginBottom: '0.5rem', textAlign: locale === 'ar' ? 'right' : 'left' }}>{t('email')}</label>
                                {/* F-27: email changes go through the verified flow (Email
                                    settings) instead of this form — the backend rejects an
                                    email change here regardless, this just avoids a confusing
                                    round-trip error. */}
                                <input aria-label={t('email')} className="input" type="email" required disabled value={editData.email} style={{ textAlign: locale === 'ar' ? 'right' : 'left', background: 'var(--surface-sunk)', cursor: 'not-allowed' }} />
                                <p style={{ margin: '0.35rem 0 0', fontSize: '0.78rem', color: 'var(--text-soft)', textAlign: locale === 'ar' ? 'right' : 'left' }}>
                                    <Link href="/dashboard/security-settings" style={{ color: 'inherit', textDecoration: 'underline' }}>{t('security_settings_nav')}</Link>
                                </p>
                            </div>
                            <div style={{ marginBottom: '1.5rem' }}>
                                <label style={{ display: 'block', fontSize: '0.875rem', marginBottom: '0.5rem', textAlign: locale === 'ar' ? 'right' : 'left' }}>{t('gender_label')}</label>
                                <select aria-label={t('gender_label')} className="input" value={editData.gender} onChange={e => setEditData({ ...editData, gender: e.target.value })} style={{ textAlign: locale === 'ar' ? 'right' : 'left' }}>
                                    <option value="MALE">{t('male')}</option>
                                    <option value="FEMALE">{t('female')}</option>
                                </select>
                            </div>
                            <div style={{ display: 'flex', gap: '1rem', justifyContent: locale === 'ar' ? 'flex-start' : 'flex-end', flexDirection: 'row' }}>
                                <button type="button" onClick={() => setEditingAdmin(null)} style={{ padding: '0.75rem 1.5rem', border: '1px solid var(--border)', borderRadius: '0.5rem', background: 'transparent' }}>{t('cancel')}</button>
                                <button type="submit" className="btn btn-primary" disabled={submitLoading}>{submitLoading ? t('saving') : t('save_changes_button')}</button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            <ConfirmModal
                isOpen={!!deleteConfirm}
                title={locale === 'ar' ? 'حذف مسؤول عام' : 'Delete Super Admin'}
                message={
                    locale === 'ar'
                        ? `هل أنت متأكد أنك تريد حذف ${deleteConfirm?.firstName} ${deleteConfirm?.lastName}؟ لا يمكن التراجع عن هذا الإجراء.`
                        : `Are you sure you want to delete ${deleteConfirm?.firstName} ${deleteConfirm?.lastName}? This cannot be undone.`
                }
                confirmText={deleting ? (locale === 'ar' ? 'جارٍ الحذف...' : 'Deleting...') : t('delete')}
                onConfirm={handleDelete}
                onCancel={() => setDeleteConfirm(null)}
                variant="danger"
            />
            <NoticeModal notice={notice} onClose={() => setNotice(null)} />
        </div>
    )
}

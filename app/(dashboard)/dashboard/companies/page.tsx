/* eslint-disable @typescript-eslint/no-explicit-any */
'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { useCompany } from '@/context/CompanyContext'
import { useSession } from 'next-auth/react'
import AccessDenied from '@/components/AccessDenied'
import Modal from '@/components/Modal'
import { useToast } from '@/context/ToastContext'
import ConfirmModal from '@/components/ConfirmModal'
import { useLanguage } from '@/context/LanguageContext'
import Pagination from '@/components/Pagination'
import LoadingSpinner from '@/components/LoadingSpinner'
import { useHeader } from '@/context/HeaderContext'

type Company = {
    id: string
    name: string
}

export default function CompaniesPage() {
    const { t, locale } = useLanguage()
    const { setTitle, setSubtitle } = useHeader()
    const router = useRouter()
    const [companies, setCompanies] = useState<Company[]>([])
    const [loading, setLoading] = useState(true)
    const [showModal, setShowModal] = useState(false)
    const [editingCompany, setEditingCompany] = useState<Company | null>(null)
    const [formData, setFormData] = useState({ name: '' })
    const [submitLoading, setSubmitLoading] = useState(false)
    const [error, setError] = useState('')
    const { triggerRefresh } = useCompany()

    const { data: session } = useSession()
    const userRole = session?.user?.role || ''

    // Delete State
    const [showDeleteModal, setShowDeleteModal] = useState(false)
    const [companyToDelete, setCompanyToDelete] = useState<Company | null>(null)
    const [deletePasscode, setDeletePasscode] = useState('')
    const [deleteError, setDeleteError] = useState('')
    const { showToast } = useToast()
    const [isDeleting, setIsDeleting] = useState(false)
    const [banConfirm, setBanConfirm] = useState<{ isOpen: boolean, company: Company | null, action: 'ban' | 'unban' | null }>({ isOpen: false, company: null, action: null })

    const [page, setPage] = useState(1)
    const [totalPages, setTotalPages] = useState(0)
    const limit = 10

    const fetchCompanies = useCallback(async () => {
        setLoading(true)
        try {
            const res = await fetch(`/api/companies?page=${page}&limit=${limit}`)
            if (res.ok) {
                const result = await res.json()
                const data = result.data
                setCompanies(data.data || data)
                setTotalPages(data.totalPages || result.totalPages || 0)
            }
        } catch (err) {
            console.error('Failed to fetch companies', err)
        } finally {
            setLoading(false)
        }
    }, [page, limit])

    useEffect(() => {
        fetchCompanies()
    }, [fetchCompanies])

    useEffect(() => {
        setTitle(t('companies'))
        setSubtitle(t('companies_subtitle' as any))
        return () => {
            setTitle(null)
            setSubtitle(null)
        }
    }, [setTitle, setSubtitle, t])

    const handleOpenModal = (company?: Company) => {
        setError('')
        if (company) {
            setEditingCompany(company)
            setFormData({ name: company.name })
        } else {
            setEditingCompany(null)
            setFormData({ name: '' })
        }
        setShowModal(true)
    }

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        setSubmitLoading(true)
        setError('')

        try {
            const endpoint = '/api/companies'
            const method = editingCompany ? 'PUT' : 'POST'
            const body = editingCompany
                ? { id: editingCompany.id, name: formData.name }
                : { name: formData.name }

            const res = await fetch(endpoint, {
                method,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            })

            const data = await res.json()

            if (!res.ok) {
                throw new Error(data.error || t('error_generic'))
            }

            // Success
            showToast(editingCompany ? t('company_updated_success') : t('company_created_success'), 'success')
            setShowModal(false)
            fetchCompanies()
            triggerRefresh()
        } catch (err: any) {
            if (err.message === 'Company already exists') {
                setError(t('error_company_exists'))
            } else {
                setError(err.message)
            }
        } finally {
            setSubmitLoading(false)
        }
    }

    const openDeleteModal = (company: Company) => {
        setCompanyToDelete(company)
        setDeletePasscode('')
        setDeleteError('')
        setShowDeleteModal(true)
    }

    const handleDelete = async (e: React.FormEvent) => {
        e.preventDefault()
        if (deletePasscode !== '2025') {
            setDeleteError(t('invalid_passcode'))
            return
        }

        if (!companyToDelete) return

        setIsDeleting(true)
        setDeleteError('')

        try {
            const res = await fetch(`/api/companies?id=${companyToDelete.id}`, { method: 'DELETE' })
            const data = await res.json()

            if (!res.ok) throw new Error(data.error || t('error_generic'))

            showToast(t('company_deleted_success'), 'success')
            setShowDeleteModal(false)
            setCompanyToDelete(null)
            fetchCompanies()
            triggerRefresh()
        } catch (err: any) {
            setDeleteError(err.message)
        } finally {
            setIsDeleting(false)
        }
    }

    if (userRole !== 'SUPER_ADMIN') {
        return <AccessDenied />
    }

    return (
        <>
            <div>
                <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', marginBottom: '2rem' }}>
                    <button
                        className="btn btn-primary"
                        onClick={() => handleOpenModal()}
                        style={{ height: '48px', display: 'flex', alignItems: 'center', borderRadius: '1.25rem' }}
                    >
                        + {t('add_company')}
                    </button>
                </div>

                {loading ? <LoadingSpinner message={t('loading_companies')} /> : (
                    <div style={{ background: 'white', borderRadius: '12px', overflowX: 'auto', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', direction: locale === 'ar' ? 'rtl' : 'ltr', minWidth: '800px' }}>
                            <thead style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
                                <tr>
                                    <th style={{ textAlign: locale === 'ar' ? 'right' : 'left', padding: '1rem', fontSize: '0.875rem', color: '#64748b' }}>{t('name_label')}</th>
                                    <th style={{ textAlign: locale === 'ar' ? 'right' : 'left', padding: '1rem', fontSize: '0.875rem', color: '#64748b' }}>{t('col_id')}</th>
                                    <th style={{ textAlign: locale === 'ar' ? 'right' : 'left', padding: '1rem', fontSize: '0.875rem', color: '#64748b' }}>{t('status_label')}</th>
                                    <th style={{ textAlign: 'center', padding: '1rem', fontSize: '0.875rem', color: '#64748b' }}>{t('costs')}</th>
                                    <th style={{ textAlign: locale === 'ar' ? 'left' : 'right', padding: '1rem', fontSize: '0.875rem', color: '#64748b' }}>{t('quick_actions')}</th>
                                </tr>
                            </thead>
                            <tbody>
                                {companies.map(company => (
                                    <tr key={company.id} style={{ borderBottom: '1px solid #f1f5f9', background: (company as any).isBanned ? '#fff1f2' : 'white' }}>
                                        <td style={{ padding: '1rem', fontWeight: '500', textAlign: locale === 'ar' ? 'right' : 'left' }}>{company.name}</td>
                                        <td style={{ padding: '1rem', fontFamily: 'monospace', color: '#64748b', fontSize: '0.8rem', textAlign: locale === 'ar' ? 'right' : 'left' }}>{company.id}</td>
                                        <td style={{ padding: '1rem', textAlign: locale === 'ar' ? 'right' : 'left' }}>
                                            {(company as any).isBanned ? (
                                                <span style={{ background: '#fee2e2', color: '#dc2626', padding: '0.25rem 0.5rem', borderRadius: '9999px', fontSize: '0.75rem', fontWeight: 'bold' }}>{t('status_banned')}</span>
                                            ) : (
                                                <span style={{ background: '#dcfce7', color: '#166534', padding: '0.25rem 0.5rem', borderRadius: '9999px', fontSize: '0.75rem', fontWeight: 'bold' }}>{t('status_active')}</span>
                                            )}
                                        </td>
                                        <td style={{ padding: '1rem', textAlign: 'center' }}>
                                            <button
                                                onClick={() => router.push(`/dashboard/companies/${company.id}/payments`)}
                                                className="btn"
                                                style={{
                                                    background: 'rgba(99, 102, 241, 0.1)',
                                                    color: '#6366f1',
                                                    padding: '0.4rem 0.8rem',
                                                    fontSize: '0.8rem',
                                                    border: '1px solid rgba(99, 102, 241, 0.2)'
                                                }}
                                            >
                                                💳 {t('payments_history')}
                                            </button>
                                        </td>
                                        <td style={{ padding: '1rem', textAlign: locale === 'ar' ? 'left' : 'right' }}>
                                            <div style={{ display: 'flex', gap: '0.5rem', justifyContent: locale === 'ar' ? 'flex-start' : 'flex-end' }}>
                                                <button
                                                    onClick={() => handleOpenModal(company)}
                                                    className="btn"
                                                    style={{ background: '#f1f5f9', color: '#0f172a', padding: '0.4rem 0.8rem', fontSize: '0.8rem' }}
                                                >
                                                    {t('edit')}
                                                </button>
                                                <button
                                                    onClick={() => {
                                                        setBanConfirm({
                                                            isOpen: true,
                                                            company,
                                                            action: (company as any).isBanned ? 'unban' : 'ban'
                                                        })
                                                    }}
                                                    className="btn"
                                                    style={{
                                                        background: (company as any).isBanned ? '#dcfce7' : '#fee2e2',
                                                        color: (company as any).isBanned ? '#166534' : '#b91c1c',
                                                        padding: '0.4rem 0.8rem',
                                                        fontSize: '0.8rem',
                                                    }}
                                                >
                                                    {(company as any).isBanned ? t('unban_company') : t('ban_company')}
                                                </button>
                                                <button
                                                    onClick={() => openDeleteModal(company)}
                                                    className="btn"
                                                    style={{
                                                        background: '#fee2e2',
                                                        color: '#b91c1c',
                                                        padding: '0.4rem 0.8rem',
                                                        fontSize: '0.8rem',
                                                    }}
                                                >
                                                    {t('delete')}
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

                <Modal
                    isOpen={showModal}
                    onClose={() => setShowModal(false)}
                    title={editingCompany ? t('edit_company_title') : t('add_company')}
                    hideFooter={true}
                >
                    <div style={{ textAlign: locale === 'ar' ? 'right' : 'left' }}>
                        {error && <div style={{ color: 'red', marginBottom: '1rem', fontSize: '0.9rem' }}>{error}</div>}

                        <form onSubmit={handleSubmit}>
                            <div style={{ marginBottom: '1.5rem' }}>
                                <label style={{ display: 'block', fontSize: '0.875rem', marginBottom: '0.5rem' }}>{t('company_name_label')}</label>
                                <input
                                    className="input"
                                    required
                                    value={formData.name}
                                    onChange={e => setFormData({ name: e.target.value })}
                                    style={{ textAlign: locale === 'ar' ? 'right' : 'left' }}
                                />
                            </div>

                            <div style={{ display: 'flex', gap: '1rem', justifyContent: 'flex-end', flexDirection: 'row' }}>
                                <button type="button" onClick={() => setShowModal(false)} className="btn" style={{ background: '#e2e8f0', color: '#0f172a' }}>
                                    {t('cancel')}
                                </button>
                                <button type="submit" className="btn btn-primary" disabled={submitLoading}>
                                    {submitLoading ? t('saving') : t('save')}
                                </button>
                            </div>
                        </form>
                    </div>
                </Modal>

                <Modal
                    isOpen={showDeleteModal}
                    onClose={() => setShowDeleteModal(false)}
                    title={t('delete_company_title')}
                    hideFooter={true}
                >
                    <div style={{ textAlign: locale === 'ar' ? 'right' : 'left' }}>
                        <p style={{ marginBottom: '1.5rem', color: '#64748b' }}>
                            {t('delete_company_warning')} <strong>{companyToDelete?.name}</strong>?
                            <br /><br />
                            <span style={{ fontWeight: 'bold', color: '#dc2626' }}>{t('delete_company_critical_warning')}</span>
                        </p>

                        {deleteError && <div style={{ color: 'red', marginBottom: '1rem', fontSize: '0.9rem' }}>{deleteError}</div>}

                        <form onSubmit={handleDelete}>
                            <div style={{ marginBottom: '1.5rem' }}>
                                <label style={{ display: 'block', fontSize: '0.875rem', marginBottom: '0.5rem' }}>{t('enter_passcode_label')}</label>
                                <input
                                    type="password"
                                    className="input"
                                    required
                                    placeholder={t('enter_passcode_placeholder')}
                                    value={deletePasscode}
                                    onChange={e => setDeletePasscode(e.target.value)}
                                    style={{ textAlign: locale === 'ar' ? 'right' : 'left' }}
                                />
                            </div>

                            <div style={{ display: 'flex', gap: '1rem', justifyContent: 'flex-end', flexDirection: 'row' }}>
                                <button type="button" onClick={() => setShowDeleteModal(false)} className="btn" style={{ background: '#e2e8f0', color: '#0f172a' }}>
                                    {t('cancel')}
                                </button>
                                <button type="submit" className="btn" disabled={isDeleting} style={{ background: '#dc2626', color: 'white', padding: '0.75rem 1.5rem', borderRadius: '0.5rem', border: 'none', cursor: 'pointer' }}>
                                    {isDeleting ? t('deleting') : t('delete_permanently')}
                                </button>
                            </div>
                        </form>
                    </div>
                </Modal>
            </div>

            <ConfirmModal
                isOpen={banConfirm.isOpen}
                title={banConfirm.action === 'ban' ? t('ban_company') : t('unban_company')}
                message={banConfirm.action === 'ban'
                    ? `${t('ban_warning')}${banConfirm.company?.name}${t('ban_warning_suffix')}`
                    : `${t('unban_warning')}${banConfirm.company?.name}${t('unban_warning_suffix')}`
                }
                confirmText={banConfirm.action === 'ban' ? t('ban_company') : t('unban_company')}
                onConfirm={async () => {
                    if (banConfirm.company) {
                        try {
                            const res = await fetch('/api/companies', {
                                method: 'PUT',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ id: banConfirm.company.id, isBanned: banConfirm.action === 'ban' })
                            })
                            if (res.ok) {
                                fetchCompanies()
                                setBanConfirm({ isOpen: false, company: null, action: null })
                            } else {
                                alert(t('failed_change_ban_status'))
                            }
                        } catch {
                            alert(t('error_changing_status'))
                        }
                    }
                }}
                onCancel={() => setBanConfirm({ isOpen: false, company: null, action: null })}
                variant={banConfirm.action === 'ban' ? 'danger' : 'warning'}
            />
        </>
    )
}

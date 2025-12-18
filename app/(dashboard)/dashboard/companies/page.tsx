/* eslint-disable @typescript-eslint/no-explicit-any */
'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useCompany } from '@/context/CompanyContext'
import { useSession } from 'next-auth/react'
import AccessDenied from '@/components/AccessDenied'
import Modal from '@/components/Modal'
import { useToast } from '@/context/ToastContext'
import ConfirmModal from '@/components/ConfirmModal'

type Company = {
    id: string
    name: string
}

export default function CompaniesPage() {
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

    const fetchCompanies = async () => {
        try {
            const res = await fetch('/api/companies')
            if (res.ok) {
                const data = await res.json()
                setCompanies(data)
            }
        } catch (e) {
            console.error('Failed to fetch companies')
        } finally {
            setLoading(false)
        }
    }

    useEffect(() => {
        fetchCompanies()
    }, [])

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
                throw new Error(data.error || 'Operation failed')
            }

            // Success
            showToast(editingCompany ? 'Company updated successfully!' : 'Company created successfully!', 'success')
            setShowModal(false)
            fetchCompanies()
            triggerRefresh()
        } catch (err: any) {
            setError(err.message)
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
            setDeleteError('Invalid passcode')
            return
        }

        if (!companyToDelete) return

        setIsDeleting(true)
        setDeleteError('')

        try {
            const res = await fetch(`/api/companies?id=${companyToDelete.id}`, { method: 'DELETE' })
            const data = await res.json()

            if (!res.ok) throw new Error(data.error || 'Failed to delete company')

            showToast('Company deleted successfully!', 'success')
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
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
                    <div>
                        <p style={{ color: '#64748b' }}>Manage registered companies</p>
                    </div>
                    <button
                        className="btn btn-primary"
                        onClick={() => handleOpenModal()}
                    >
                        + Add Company
                    </button>
                </div>

                {loading ? <p>Loading...</p> : (
                    <div style={{ background: 'white', borderRadius: '12px', overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                            <thead style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
                                <tr>
                                    <th style={{ textAlign: 'left', padding: '1rem', fontSize: '0.875rem', color: '#64748b' }}>Name</th>
                                    <th style={{ textAlign: 'left', padding: '1rem', fontSize: '0.875rem', color: '#64748b' }}>ID</th>
                                    <th style={{ textAlign: 'left', padding: '1rem', fontSize: '0.875rem', color: '#64748b' }}>Status</th>
                                    <th style={{ textAlign: 'right', padding: '1rem', fontSize: '0.875rem', color: '#64748b' }}>Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                {companies.map(company => (
                                    <tr key={company.id} style={{ borderBottom: '1px solid #f1f5f9', background: (company as any).isBanned ? '#fff1f2' : 'white' }}>
                                        <td style={{ padding: '1rem', fontWeight: '500' }}>{company.name}</td>
                                        <td style={{ padding: '1rem', fontFamily: 'monospace', color: '#64748b', fontSize: '0.8rem' }}>{company.id}</td>
                                        <td style={{ padding: '1rem' }}>
                                            {(company as any).isBanned ? (
                                                <span style={{ background: '#fee2e2', color: '#dc2626', padding: '0.25rem 0.5rem', borderRadius: '9999px', fontSize: '0.75rem', fontWeight: 'bold' }}>BANNED</span>
                                            ) : (
                                                <span style={{ background: '#dcfce7', color: '#166534', padding: '0.25rem 0.5rem', borderRadius: '9999px', fontSize: '0.75rem', fontWeight: 'bold' }}>ACTIVE</span>
                                            )}
                                        </td>
                                        <td style={{ padding: '1rem', textAlign: 'right' }}>
                                            <button
                                                onClick={() => handleOpenModal(company)}
                                                className="btn"
                                                style={{ background: '#f1f5f9', color: '#0f172a', padding: '0.4rem 0.8rem', fontSize: '0.8rem' }}
                                            >
                                                Edit
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
                                                    marginLeft: '0.5rem'
                                                }}
                                            >
                                                {(company as any).isBanned ? 'Unban' : 'Ban'}
                                            </button>
                                            <button
                                                onClick={() => openDeleteModal(company)}
                                                className="btn"
                                                style={{
                                                    background: '#fee2e2',
                                                    color: '#b91c1c',
                                                    padding: '0.4rem 0.8rem',
                                                    fontSize: '0.8rem',
                                                    marginLeft: '0.5rem'
                                                }}
                                            >
                                                Delete
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}

                {/* Modal */}
                {/* Modal */}
                <Modal
                    isOpen={showModal}
                    onClose={() => setShowModal(false)}
                    title={editingCompany ? 'Edit Company' : 'Add Company'}
                    hideFooter={true}
                >
                    <div>
                        {error && <div style={{ color: 'red', marginBottom: '1rem', fontSize: '0.9rem' }}>{error}</div>}

                        <form onSubmit={handleSubmit}>
                            <div style={{ marginBottom: '1.5rem' }}>
                                <label style={{ display: 'block', fontSize: '0.875rem', marginBottom: '0.5rem' }}>Company Name</label>
                                <input
                                    className="input"
                                    required
                                    value={formData.name}
                                    onChange={e => setFormData({ name: e.target.value })}
                                />
                            </div>

                            <div style={{ display: 'flex', gap: '1rem', justifyContent: 'flex-end' }}>
                                <button type="button" onClick={() => setShowModal(false)} className="btn" style={{ background: '#e2e8f0', color: '#0f172a' }}>
                                    Cancel
                                </button>
                                <button type="submit" className="btn btn-primary" disabled={submitLoading}>
                                    {submitLoading ? 'Saving...' : 'Save'}
                                </button>
                            </div>
                        </form>
                    </div>
                </Modal>

                {/* Delete Modal */}
                {/* Delete Modal */}
                <Modal
                    isOpen={showDeleteModal}
                    onClose={() => setShowDeleteModal(false)}
                    title="Delete Company"
                    hideFooter={true}
                >
                    <div>
                        <p style={{ marginBottom: '1.5rem', color: '#64748b' }}>
                            Are you sure you want to delete <strong>{companyToDelete?.name}</strong>?
                            <br /><br />
                            <span style={{ fontWeight: 'bold', color: '#dc2626' }}>WARNING: This will permanently delete all employees, tasks, and data associated with this company.</span>
                        </p>

                        {deleteError && <div style={{ color: 'red', marginBottom: '1rem', fontSize: '0.9rem' }}>{deleteError}</div>}

                        <form onSubmit={handleDelete}>
                            <div style={{ marginBottom: '1.5rem' }}>
                                <label style={{ display: 'block', fontSize: '0.875rem', marginBottom: '0.5rem' }}>Enter Passcode to Confirm</label>
                                <input
                                    type="password"
                                    className="input"
                                    required
                                    placeholder="Enter passcode"
                                    value={deletePasscode}
                                    onChange={e => setDeletePasscode(e.target.value)}
                                />
                            </div>

                            <div style={{ display: 'flex', gap: '1rem', justifyContent: 'flex-end' }}>
                                <button type="button" onClick={() => setShowDeleteModal(false)} className="btn" style={{ background: '#e2e8f0', color: '#0f172a' }}>
                                    Cancel
                                </button>
                                <button type="submit" className="btn" disabled={isDeleting} style={{ background: '#dc2626', color: 'white', padding: '0.75rem 1.5rem', borderRadius: '0.5rem', border: 'none', cursor: 'pointer' }}>
                                    {isDeleting ? 'Deleting...' : 'Delete Permanently'}
                                </button>
                            </div>
                        </form>
                    </div>
                </Modal>
            </div>

            <ConfirmModal
                isOpen={banConfirm.isOpen}
                title={banConfirm.action === 'ban' ? 'Ban Company' : 'Unban Company'}
                message={`Are you sure you want to ${banConfirm.action} "${banConfirm.company?.name}"? ${banConfirm.action === 'ban' ? 'Users from this company will not be able to log in.' : 'Users from this company will be able to log in again.'}`}
                confirmText={banConfirm.action === 'ban' ? 'Ban Company' : 'Unban Company'}
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
                                alert('Failed to change ban status')
                            }
                        } catch (e) {
                            alert('Error changing status')
                        }
                    }
                }}
                onCancel={() => setBanConfirm({ isOpen: false, company: null, action: null })}
                variant={banConfirm.action === 'ban' ? 'danger' : 'warning'}
            />
        </>
    )
}

'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useCompany } from '@/context/CompanyContext'

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

    // Delete State
    const [showDeleteModal, setShowDeleteModal] = useState(false)
    const [companyToDelete, setCompanyToDelete] = useState<Company | null>(null)
    const [deletePasscode, setDeletePasscode] = useState('')
    const [deleteError, setDeleteError] = useState('')
    const [isDeleting, setIsDeleting] = useState(false)

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

    return (
        <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
                <div>
                    <h1 style={{ fontSize: '1.8rem', fontWeight: 'bold' }}>Companies</h1>
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
                                <th style={{ textAlign: 'right', padding: '1rem', fontSize: '0.875rem', color: '#64748b' }}>Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {companies.map(company => (
                                <tr key={company.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                                    <td style={{ padding: '1rem', fontWeight: '500' }}>{company.name}</td>
                                    <td style={{ padding: '1rem', fontFamily: 'monospace', color: '#64748b', fontSize: '0.8rem' }}>{company.id}</td>
                                    <td style={{ padding: '1rem', textAlign: 'right' }}>
                                        <button
                                            onClick={() => handleOpenModal(company)}
                                            className="btn"
                                            style={{ background: '#f1f5f9', color: '#0f172a', padding: '0.4rem 0.8rem', fontSize: '0.8rem' }}
                                        >
                                            Edit
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
            {showModal && (
                <div style={{
                    position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
                    background: 'rgba(0,0,0,0.5)', display: 'flex', justifyContent: 'center',
                    alignItems: 'center', zIndex: 100
                }}>
                    <div style={{ background: 'white', padding: '2rem', borderRadius: '12px', width: '100%', maxWidth: '400px' }}>
                        <h2 style={{ fontSize: '1.5rem', fontWeight: 'bold', marginBottom: '1.5rem' }}>
                            {editingCompany ? 'Edit Company' : 'Add Company'}
                        </h2>

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
                                <button type="button" onClick={() => setShowModal(false)} style={{ padding: '0.75rem 1.5rem', border: '1px solid #e2e8f0', borderRadius: '0.5rem', background: 'transparent' }}>
                                    Cancel
                                </button>
                                <button type="submit" className="btn btn-primary" disabled={submitLoading}>
                                    {submitLoading ? 'Saving...' : 'Save'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* Delete Modal */}
            {showDeleteModal && companyToDelete && (
                <div style={{
                    position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
                    background: 'rgba(0,0,0,0.5)', display: 'flex', justifyContent: 'center',
                    alignItems: 'center', zIndex: 100
                }}>
                    <div style={{ background: 'white', padding: '2rem', borderRadius: '12px', width: '100%', maxWidth: '400px' }}>
                        <h2 style={{ fontSize: '1.5rem', fontWeight: 'bold', marginBottom: '1rem', color: '#b91c1c' }}>
                            Delete Company
                        </h2>
                        <p style={{ marginBottom: '1.5rem', color: '#64748b' }}>
                            Are you sure you want to delete <strong>{companyToDelete.name}</strong>?
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
                                <button type="button" onClick={() => setShowDeleteModal(false)} style={{ padding: '0.75rem 1.5rem', border: '1px solid #e2e8f0', borderRadius: '0.5rem', background: 'transparent' }}>
                                    Cancel
                                </button>
                                <button type="submit" className="btn" disabled={isDeleting} style={{ background: '#dc2626', color: 'white', padding: '0.75rem 1.5rem', borderRadius: '0.5rem', border: 'none', cursor: 'pointer' }}>
                                    {isDeleting ? 'Deleting...' : 'Delete Permanently'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    )
}

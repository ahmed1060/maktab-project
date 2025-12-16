'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { createPortal } from 'react-dom'
import ConfirmModal from '@/components/ConfirmModal'

interface Client {
    id: string
    name: string
    _count: {
        sections: number
    }
}

export default function ClientsPage() {
    const [clients, setClients] = useState<Client[]>([])
    const [filteredClients, setFilteredClients] = useState<Client[]>([])
    const [searchQuery, setSearchQuery] = useState('')
    const [isLoading, setIsLoading] = useState(true)
    const [isModalOpen, setIsModalOpen] = useState(false)
    const [newClientName, setNewClientName] = useState('')
    const [isSubmitting, setIsSubmitting] = useState(false)
    const [mounted, setMounted] = useState(false)
    const [showSuggestions, setShowSuggestions] = useState(false)
    const [deleteConfirm, setDeleteConfirm] = useState<{ isOpen: boolean, client: Client | null }>({ isOpen: false, client: null })

    useEffect(() => {
        setMounted(true)
    }, [])

    // New State for Super Admin Company Selection
    const [companies, setCompanies] = useState<{ id: string, name: string }[]>([])
    const [selectedCompanyId, setSelectedCompanyId] = useState('')
    const [showCompanySelect, setShowCompanySelect] = useState(false)

    // Helper functions need to be defined BEFORE useEffect if used inside (or defined efficiently)
    // Actually, function declarations are hoisted, consts are not. 
    // Safest pattern: Define them above, or inside useEffect, or use useCallback.
    // Given the structure, I'll define checkSuperAdmin here or just inline the logic in useEffect to avoid hoisting issues,
    // OR just define it before the useEffect.

    const checkSuperAdmin = async () => {
        try {
            const res = await fetch('/api/companies')
            if (res.ok) {
                const data = await res.json()
                setCompanies(data)
                setShowCompanySelect(true)
            }
        } catch (e) {
            // Not a super admin or failed to fetch companies
        }
    }

    const fetchClients = async () => {
        try {
            const res = await fetch('/api/clients')
            if (res.ok) {
                const data = await res.json()
                setClients(data)
                setFilteredClients(data)
            }
        } catch (error) {
            console.error('Failed to fetch clients', error)
        } finally {
            setIsLoading(false)
        }
    }

    useEffect(() => {
        fetchClients()
        checkSuperAdmin()
    }, [])

    useEffect(() => {
        if (!clients.length) return
        const filtered = clients.filter(client =>
            client.name.toLowerCase().includes(searchQuery.toLowerCase())
        )
        setFilteredClients(filtered)
    }, [searchQuery, clients])

    // checkSuperAdmin and fetchClients moved up
    // Removing duplicate definitions if they exist below this block in the file
    // The previous view showed them at line 35 and 48. I must replace them to avoid duplicates.

    const handleCreateClient = async (e: React.FormEvent) => {
        e.preventDefault()
        if (!newClientName.trim()) return

        setIsSubmitting(true)
        try {
            const payload: any = { name: newClientName }
            if (showCompanySelect && selectedCompanyId) {
                payload.companyId = selectedCompanyId
            }

            const res = await fetch('/api/clients', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            })

            if (res.ok) {
                setNewClientName('')
                setIsModalOpen(false)
                fetchClients()
            } else {
                const err = await res.json()
                window.alert(`Failed to create client: ${err.error}\n${err.details || ''}`)
            }
        } catch (error) {
            console.error('Failed to create client', error)
            window.alert('An unexpected error occurred while creating client')
        } finally {
            setIsSubmitting(false)
        }
    }

    return (
        <>
            <div className="space-y-6 animate-in fade-in duration-500">
                {/* Header matching Tasks Page Style */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
                    <h1 className="text-3xl font-bold text-slate-800 tracking-tight">Clients</h1>
                    <button
                        onClick={() => setIsModalOpen(true)}
                        className="btn btn-primary"
                        style={{ marginLeft: 'auto' }} // Force right alignment
                    >
                        Add Client
                    </button>
                </div>

                {/* Filter/Search Row - Styled like EmployeeFilter */}
                <div style={{
                    marginBottom: '1.5rem',
                    display: 'flex',
                    gap: '1rem',
                    alignItems: 'flex-end',
                    justifyContent: 'space-between',
                    flexWrap: 'wrap'
                }}>
                    <div style={{ display: 'flex', gap: '1rem', alignItems: 'flex-end', flex: 1, flexWrap: 'wrap' }}>
                        <div style={{ position: 'relative' }}>
                            <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: '600', fontSize: '0.875rem' }}>
                                Search Clients
                            </label>
                            <input
                                type="text"
                                placeholder="e.g. Acme Corp..."
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                onFocus={() => setShowSuggestions(true)}
                                onBlur={() => setTimeout(() => setShowSuggestions(false), 200)}
                                style={{
                                    padding: '0.5rem 1rem',
                                    borderRadius: '0.5rem',
                                    border: '1px solid #cbd5e1',
                                    fontSize: '0.875rem',
                                    minWidth: '250px',
                                    outline: 'none',
                                    width: '100%'
                                }}
                            />
                            {showSuggestions && (
                                <div style={{
                                    position: 'absolute',
                                    top: '100%',
                                    left: 0,
                                    right: 0,
                                    background: 'white',
                                    border: '1px solid #e2e8f0',
                                    borderRadius: '0.5rem',
                                    marginTop: '0.25rem',
                                    zIndex: 50,
                                    maxHeight: '200px',
                                    overflowY: 'auto',
                                    boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)'
                                }}>
                                    {clients
                                        .filter(c => c.name.toLowerCase().includes(searchQuery.toLowerCase()))
                                        .map(client => (
                                            <div
                                                key={client.id}
                                                onClick={() => {
                                                    setSearchQuery(client.name)
                                                    setShowSuggestions(false)
                                                }}
                                                style={{
                                                    padding: '0.5rem 1rem',
                                                    cursor: 'pointer',
                                                    fontSize: '0.875rem',
                                                    color: '#334155',
                                                    borderBottom: '1px solid #f1f5f9'
                                                }}
                                                className="hover:bg-slate-50"
                                            >
                                                {client.name}
                                            </div>
                                        ))}
                                    {clients.filter(c => c.name.toLowerCase().includes(searchQuery.toLowerCase())).length === 0 && (
                                        <div style={{ padding: '0.5rem 1rem', fontSize: '0.875rem', color: '#94a3b8' }}>
                                            No clients found
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    </div>
                </div>

                {/* List View */}
                {isLoading ? (
                    <div className="flex flex-col items-center justify-center py-20 space-y-4">
                        <div className="w-12 h-12 border-4 border-indigo-200 border-t-indigo-600 rounded-full animate-spin"></div>
                        <p className="text-slate-500 font-medium animate-pulse">Loading clients...</p>
                    </div>
                ) : filteredClients.length === 0 ? (
                    <div className="glass-card flex flex-col items-center justify-center py-12 text-center text-slate-500">
                        <span className="text-4xl mb-2">🏢</span>
                        <h3 className="text-lg font-bold text-slate-800">No clients found</h3>
                        <p className="max-w-xs mx-auto mt-1 mb-4">
                            {searchQuery ? `No matches for "${searchQuery}"` : "Get started by adding your first client."}
                        </p>
                        {searchQuery && (
                            <button
                                onClick={() => setSearchQuery('')}
                                className="text-indigo-600 hover:underline"
                            >
                                Clear search
                            </button>
                        )}
                    </div>
                ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                        {filteredClients.map((client, index) => (
                            <div
                                key={client.id}
                                className="glass-card hover:bg-white/60 transition-all duration-300 p-4 border border-white/40 shadow-sm relative overflow-hidden"
                                style={{
                                    animationDelay: `${index * 50}ms`,
                                    marginBottom: '0.5rem' // Fallback for gap support
                                }}
                            >
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%', gap: '1rem' }}>
                                    {/* Left Side: Title & Info */}
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                                        <h3 className="text-lg font-semibold text-slate-800 leading-tight" style={{ margin: 0 }}>
                                            {client.name}
                                        </h3>
                                        <span style={{
                                            padding: '0.25rem 0.75rem',
                                            borderRadius: '9999px',
                                            background: '#dbeafe',
                                            color: '#1e40af',
                                            fontSize: '0.875rem',
                                            fontWeight: '600',
                                            whiteSpace: 'nowrap'
                                        }}>
                                            {client._count.sections} {client._count.sections === 1 ? 'Section' : 'Sections'}
                                        </span>
                                    </div>

                                    {/* Right Side: Action Button */}
                                    <div style={{ marginLeft: 'auto', display: 'flex', gap: '0.5rem' }}>
                                        <Link
                                            href={`/dashboard/clients/${client.id}`}
                                            className="btn btn-primary"
                                            style={{
                                                textDecoration: 'none',
                                                fontSize: '0.875rem',
                                                padding: '0.5rem 1rem',
                                                display: 'inline-block'
                                            }}
                                        >
                                            View Client
                                        </Link>
                                        <button
                                            onClick={(e) => {
                                                e.preventDefault()
                                                setDeleteConfirm({ isOpen: true, client })
                                            }}
                                            className="btn"
                                            style={{
                                                background: '#fee2e2',
                                                color: '#b91c1c',
                                                padding: '0.5rem 1rem',
                                                fontSize: '0.875rem',
                                                border: 'none',
                                                cursor: 'pointer'
                                            }}
                                        >
                                            Delete
                                        </button>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* Create Client Modal - Uses Portal to escape stacking contexts */}
            {isModalOpen && mounted && createPortal(
                <div style={{
                    position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
                    background: 'rgba(0,0,0,0.5)', display: 'flex', justifyContent: 'center',
                    alignItems: 'center', zIndex: 9999
                }}>
                    <div
                        className="absolute inset-0"
                        onClick={() => !isSubmitting && setIsModalOpen(false)}
                    />
                    <div style={{ background: 'white', padding: '2rem', borderRadius: '12px', width: '100%', maxWidth: '500px', position: 'relative', zIndex: 10 }}>
                        <h2 style={{ fontSize: '1.5rem', fontWeight: 'bold', marginBottom: '1.5rem', color: '#1e293b' }}>Add New Client</h2>

                        <form onSubmit={handleCreateClient}>
                            {showCompanySelect && (
                                <div style={{ marginBottom: '1rem' }}>
                                    <label style={{ display: 'block', fontSize: '0.875rem', marginBottom: '0.5rem', color: '#64748b' }}>
                                        Assign to Company
                                    </label>
                                    <select
                                        value={selectedCompanyId}
                                        onChange={(e) => setSelectedCompanyId(e.target.value)}
                                        className="input"
                                        style={{ width: '100%', padding: '0.5rem', border: '1px solid #e2e8f0', borderRadius: '0.5rem' }}
                                        required
                                    >
                                        <option value="">Select a company...</option>
                                        {companies.map(c => (
                                            <option key={c.id} value={c.id}>{c.name}</option>
                                        ))}
                                    </select>
                                </div>
                            )}

                            <div style={{ marginBottom: '1.5rem' }}>
                                <label style={{ display: 'block', fontSize: '0.875rem', marginBottom: '0.5rem', color: '#64748b' }}>
                                    Client Company Name
                                </label>
                                <input
                                    type="text"
                                    value={newClientName}
                                    onChange={(e) => setNewClientName(e.target.value)}
                                    className="input"
                                    style={{ width: '100%', padding: '0.5rem', border: '1px solid #e2e8f0', borderRadius: '0.5rem' }}
                                    placeholder="e.g. Acme Corp Inc."
                                    autoFocus
                                />
                            </div>

                            <div style={{ display: 'flex', gap: '1rem', justifyContent: 'flex-end' }}>
                                <button
                                    type="button"
                                    onClick={() => setIsModalOpen(false)}
                                    style={{ padding: '0.75rem 1.5rem', border: '1px solid #e2e8f0', borderRadius: '0.5rem', background: 'transparent', cursor: 'pointer' }}
                                >
                                    Cancel
                                </button>
                                <button
                                    type="submit"
                                    disabled={!newClientName.trim() || isSubmitting || (showCompanySelect && !selectedCompanyId)}
                                    className="btn btn-primary"
                                >
                                    {isSubmitting ? 'Creating...' : 'Create Client'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>,
                document.body
            )}

            <ConfirmModal
                isOpen={deleteConfirm.isOpen}
                title="Delete Client"
                message={`Are you sure you want to delete "${deleteConfirm.client?.name}"? This will permanently delete all sections and notes associated with this client. This action cannot be undone.`}
                confirmText="Delete Client"
                onConfirm={async () => {
                    if (deleteConfirm.client) {
                        try {
                            const res = await fetch(`/api/clients?id=${deleteConfirm.client.id}`, { method: 'DELETE' })
                            if (res.ok) {
                                fetchClients()
                                setDeleteConfirm({ isOpen: false, client: null })
                            } else {
                                const err = await res.json()
                                alert(`Failed to delete: ${err.error}`)
                            }
                        } catch (error) {
                            alert('Error deleting client')
                        }
                    }
                }}
                onCancel={() => setDeleteConfirm({ isOpen: false, client: null })}
                variant="danger"
            />
        </>
    )
}

'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { createPortal } from 'react-dom'
import ConfirmModal from '@/components/ConfirmModal'
import { useLanguage } from '@/context/LanguageContext'
import { useToast } from '@/context/ToastContext'

interface Client {
    id: string
    name: string
    _count: {
        sections: number
    }
}

export default function ClientsPage() {
    const { t, locale } = useLanguage()
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
    const [isEditClientModalOpen, setIsEditClientModalOpen] = useState(false)
    const [editClientName, setEditClientName] = useState('')
    const [editingClientId, setEditingClientId] = useState<string | null>(null)
    const [isEditingClient, setIsEditingClient] = useState(false)
    const { showToast } = useToast()

    useEffect(() => {
        setMounted(true)
    }, [])

    const [companies, setCompanies] = useState<{ id: string, name: string }[]>([])
    const [selectedCompanyId, setSelectedCompanyId] = useState('')
    const [showCompanySelect, setShowCompanySelect] = useState(false)

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
                window.alert(`${t('failed_create_client')}: ${err.error}\n${err.details || ''}`)
            }
        } catch (error) {
            console.error('Failed to create client', error)
            window.alert(t('error_generic'))
        } finally {
            setIsSubmitting(false)
        }
    }

    const handleEditClient = async (e: React.FormEvent) => {
        e.preventDefault()
        if (!editClientName.trim() || !editingClientId) return

        setIsEditingClient(true)
        try {
            const res = await fetch('/api/clients', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: editingClientId, name: editClientName })
            })

            if (res.ok) {
                setIsEditClientModalOpen(false)
                setEditingClientId(null)
                setEditClientName('')
                fetchClients()
                showToast(t('client_updated_success' as any) || 'Client updated successfully', 'success')
            } else {
                const err = await res.json()
                showToast(err.error || t('error_generic'), 'error')
            }
        } catch (error) {
            console.error('Failed to update client', error)
            showToast(t('error_generic'), 'error')
        } finally {
            setIsEditingClient(false)
        }
    }

    return (
        <>
            <div className="space-y-6 animate-in fade-in duration-500">
                <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', marginBottom: '1.5rem' }}>
                    <button
                        onClick={() => setIsModalOpen(true)}
                        className="btn btn-primary"
                    >
                        {t('add_client')}
                    </button>
                </div>

                <div style={{
                    marginBottom: '1.5rem',
                    display: 'flex',
                    gap: '1rem',
                    alignItems: 'flex-end',
                    justifyContent: 'space-between',
                    flexWrap: 'wrap'
                }}>
                    <div style={{ display: 'flex', gap: '1rem', alignItems: 'flex-end', flex: 1, flexWrap: 'wrap' }}>
                        <div style={{ position: 'relative', width: '100%', maxWidth: '400px' }}>
                            <label style={{
                                display: 'block',
                                marginBottom: '0.5rem',
                                fontWeight: '600',
                                fontSize: '0.875rem',
                                textAlign: locale === 'ar' ? 'right' : 'left'
                            }}>
                                {t('search_clients')}
                            </label>
                            <input
                                type="text"
                                placeholder={t('client_placeholder')}
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                onFocus={() => setShowSuggestions(true)}
                                onBlur={() => setTimeout(() => setShowSuggestions(false), 200)}
                                style={{
                                    padding: '0.5rem 1rem',
                                    borderRadius: '0.5rem',
                                    border: '1px solid #cbd5e1',
                                    fontSize: '0.875rem',
                                    outline: 'none',
                                    width: '100%',
                                    textAlign: locale === 'ar' ? 'right' : 'left'
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
                                                    borderBottom: '1px solid #f1f5f9',
                                                    textAlign: locale === 'ar' ? 'right' : 'left'
                                                }}
                                                className="hover:bg-slate-50"
                                            >
                                                {client.name}
                                            </div>
                                        ))}
                                    {clients.filter(c => c.name.toLowerCase().includes(searchQuery.toLowerCase())).length === 0 && (
                                        <div style={{ padding: '0.5rem 1rem', fontSize: '0.875rem', color: '#94a3b8', textAlign: locale === 'ar' ? 'right' : 'left' }}>
                                            {t('no_clients_found')}
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    </div>
                </div>

                {isLoading ? (
                    <div className="flex flex-col items-center justify-center py-20 space-y-4">
                        <div className="w-12 h-12 border-4 border-indigo-200 border-t-indigo-600 rounded-full animate-spin"></div>
                        <p className="text-slate-500 font-medium animate-pulse">{t('loading_clients')}</p>
                    </div>
                ) : filteredClients.length === 0 ? (
                    <div className="glass-card flex flex-col items-center justify-center py-12 text-center text-slate-500">
                        <span className="text-4xl mb-2">🏢</span>
                        <h3 className="text-lg font-bold text-slate-800">{t('no_clients_found')}</h3>
                        <p className="max-w-xs mx-auto mt-1 mb-4">
                            {searchQuery ? `${t('no_tasks_found')}` : t('get_started_client')}
                        </p>
                        {searchQuery && (
                            <button
                                onClick={() => setSearchQuery('')}
                                className="text-indigo-600 hover:underline"
                            >
                                {t('clear_search')}
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
                                    marginBottom: '0.5rem'
                                }}
                            >
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%', gap: '1rem' }}>
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
                                            {client._count.sections} {client._count.sections === 1 ? t('section_label') : t('sections_label')}
                                        </span>
                                    </div>

                                    <div style={{ [locale === 'ar' ? 'marginRight' : 'marginLeft']: 'auto', display: 'flex', gap: '0.5rem' }}>
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
                                            {t('view_client')}
                                        </Link>
                                        <button
                                            onClick={() => {
                                                setEditingClientId(client.id)
                                                setEditClientName(client.name)
                                                setIsEditClientModalOpen(true)
                                            }}
                                            className="btn"
                                            style={{
                                                background: '#dbeafe',
                                                color: '#1e40af',
                                                padding: '0.5rem 1rem',
                                                fontSize: '0.875rem',
                                                display: 'flex',
                                                alignItems: 'center',
                                                gap: '0.25rem'
                                            }}
                                        >
                                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                                                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                                                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                                            </svg>
                                            {t('edit')}
                                        </button>
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
                                            {t('delete')}
                                        </button>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>

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
                        <h2 style={{ fontSize: '1.5rem', fontWeight: 'bold', marginBottom: '1.5rem', color: '#1e293b', textAlign: locale === 'ar' ? 'right' : 'left' }}>
                            {t('add_new_client_title')}
                        </h2>

                        <form onSubmit={handleCreateClient}>
                            {showCompanySelect && (
                                <div style={{ marginBottom: '1rem' }}>
                                    <label style={{ display: 'block', fontSize: '0.875rem', marginBottom: '0.5rem', color: '#64748b', textAlign: locale === 'ar' ? 'right' : 'left' }}>
                                        {t('assign_to_company')}
                                    </label>
                                    <select
                                        value={selectedCompanyId}
                                        onChange={(e) => setSelectedCompanyId(e.target.value)}
                                        className="input"
                                        style={{ width: '100%', padding: '0.5rem', border: '1px solid #e2e8f0', borderRadius: '0.5rem', textAlign: locale === 'ar' ? 'right' : 'left' }}
                                        required
                                    >
                                        <option value="">{t('select_company_placeholder')}</option>
                                        {companies.map(c => (
                                            <option key={c.id} value={c.id}>{c.name}</option>
                                        ))}
                                    </select>
                                </div>
                            )}

                            <div style={{ marginBottom: '1.5rem' }}>
                                <label style={{ display: 'block', fontSize: '0.875rem', marginBottom: '0.5rem', color: '#64748b', textAlign: locale === 'ar' ? 'right' : 'left' }}>
                                    {t('client_company_name')}
                                </label>
                                <input
                                    type="text"
                                    value={newClientName}
                                    onChange={(e) => setNewClientName(e.target.value)}
                                    className="input"
                                    style={{ width: '100%', padding: '0.5rem', border: '1px solid #e2e8f0', borderRadius: '0.5rem', textAlign: locale === 'ar' ? 'right' : 'left' }}
                                    placeholder={t('client_placeholder')}
                                    autoFocus
                                />
                            </div>

                            <div style={{ display: 'flex', gap: '1rem', justifyContent: 'flex-end' }}>
                                <button
                                    type="button"
                                    onClick={() => setIsModalOpen(false)}
                                    style={{ padding: '0.75rem 1.5rem', border: '1px solid #e2e8f0', borderRadius: '0.5rem', background: 'transparent', cursor: 'pointer' }}
                                >
                                    {t('cancel')}
                                </button>
                                <button
                                    type="submit"
                                    disabled={!newClientName.trim() || isSubmitting || (showCompanySelect && !selectedCompanyId)}
                                    className="btn btn-primary"
                                >
                                    {isSubmitting ? t('creating') : t('create_client')}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>,
                document.body
            )}

            <ConfirmModal
                isOpen={deleteConfirm.isOpen}
                title={t('delete_client_title')}
                message={`${t('delete_client_warning')}${deleteConfirm.client?.name}${t('delete_client_warning_suffix')}`}
                confirmText={t('delete_client_title')}
                onConfirm={async () => {
                    if (deleteConfirm.client) {
                        try {
                            const res = await fetch(`/api/clients?id=${deleteConfirm.client.id}`, { method: 'DELETE' })
                            if (res.ok) {
                                fetchClients()
                                setDeleteConfirm({ isOpen: false, client: null })
                            } else {
                                const err = await res.json()
                                alert(`${t('error_generic')}: ${err.error}`)
                            }
                        } catch (error) {
                            alert(t('error_delete_client'))
                        }
                    }
                }}
                onCancel={() => setDeleteConfirm({ isOpen: false, client: null })}
                variant="danger"
            />
            {/* Edit Client Modal */}
            {isEditClientModalOpen && mounted && createPortal(
                <div style={{
                    position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
                    background: 'rgba(0,0,0,0.5)', display: 'flex', justifyContent: 'center',
                    alignItems: 'center', zIndex: 9999
                }}>
                    <div
                        className="absolute inset-0"
                        onClick={() => !isEditingClient && setIsEditClientModalOpen(false)}
                    />
                    <div style={{ background: 'white', padding: '2rem', borderRadius: '12px', width: '100%', maxWidth: '500px', position: 'relative', zIndex: 10, direction: locale === 'ar' ? 'rtl' : 'ltr' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
                            <h2 style={{ fontSize: '1.5rem', fontWeight: 'bold', color: '#1e293b', margin: 0 }}>{t('edit_client_title' as any) || 'Edit Client Name'}</h2>
                        </div>
                        <form onSubmit={handleEditClient}>
                            <div style={{ marginBottom: '1.5rem' }}>
                                <label style={{ display: 'block', fontSize: '0.875rem', marginBottom: '0.5rem', color: '#64748b', textAlign: locale === 'ar' ? 'right' : 'left' }}>
                                    {t('client_company_name' as any)}
                                </label>
                                <input
                                    type="text"
                                    value={editClientName}
                                    onChange={(e) => setEditClientName(e.target.value)}
                                    className="input"
                                    style={{
                                        width: '100%',
                                        padding: '0.75rem',
                                        border: '1px solid #e2e8f0',
                                        borderRadius: '0.5rem',
                                        outline: 'none',
                                        textAlign: locale === 'ar' ? 'right' : 'left'
                                    }}
                                    placeholder={t('client_placeholder')}
                                    autoFocus
                                />
                            </div>

                            <div style={{ display: 'flex', gap: '1rem', justifyContent: 'flex-end' }}>
                                <button
                                    type="button"
                                    onClick={() => setIsEditClientModalOpen(false)}
                                    style={{ padding: '0.75rem 1.5rem', border: '1px solid #e2e8f0', borderRadius: '0.5rem', background: 'transparent', cursor: 'pointer' }}
                                >
                                    {t('cancel')}
                                </button>
                                <button
                                    type="submit"
                                    disabled={!editClientName.trim() || isEditingClient}
                                    className="btn btn-primary"
                                    style={{ opacity: (!editClientName.trim() || isEditingClient) ? 0.5 : 1 }}
                                >
                                    {isEditingClient ? t('saving') : t('save')}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>,
                document.body
            )}
        </>
    )
}

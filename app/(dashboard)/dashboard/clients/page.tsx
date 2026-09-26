'use client'

import { useState, useEffect } from 'react'
import useSWR from 'swr'
import { useSession } from 'next-auth/react'
import { useCan } from '@/lib/useCan'
import Link from 'next/link'
import { createPortal } from 'react-dom'
import ConfirmModal from '@/components/ConfirmModal'
import EmployeeFilter from '@/components/EmployeeFilter'
import { useLanguage } from '@/context/LanguageContext'
import { useModules } from '@/lib/useModules'
import { useHeader } from '@/context/HeaderContext'
import LoadingSpinner from '@/components/LoadingSpinner'
import { useToast } from '@/context/ToastContext'
import { useCompany } from '@/context/CompanyContext'
import Pagination from '@/components/Pagination'
import SafeDate from '@/components/SafeDate'
import { fetcher } from '@/lib/swr-fetcher'
import NoticeModal, { Notice } from '@/components/NoticeModal'
import { useHydrated } from '@/lib/useHydrated'


interface Client {
    id: string
    name: string
    createdAt: string
    updatedAt: string
    createdBy?: {
        firstName: string
        lastName: string
        role: string
    }
    lastEditedBy?: {
        firstName: string
        lastName: string
        role: string
    }
    _count: {
        sections: number
    }
}

export default function ClientsPage() {
    const { data: session } = useSession()
    // Renaming and deleting are narrower than adding: everyone may add a
    // client, but only those who may rename or delete are offered it.
    const { can } = useCan()
    const { t, locale } = useLanguage()
    const { setTitle, setSubtitle } = useHeader()
    const modules = useModules()
    const [searchQuery, setSearchQuery] = useState('')
    const [isModalOpen, setIsModalOpen] = useState(false)
    const [newClientName, setNewClientName] = useState('')
    const [isSubmitting, setIsSubmitting] = useState(false)
    // Replaces alert(): a native dialog ignores the palette entirely, and it
    // blocks the main thread for as long as it is up.
    const [notice, setNotice] = useState<Notice | null>(null)
    const mounted = useHydrated()
    const [deleteConfirm, setDeleteConfirm] = useState<{ isOpen: boolean, client: Client | null }>({ isOpen: false, client: null })
    const [isEditClientModalOpen, setIsEditClientModalOpen] = useState(false)
    const [editClientName, setEditClientName] = useState('')
    const [editingClientId, setEditingClientId] = useState<string | null>(null)
    const [isEditingClient, setIsEditingClient] = useState(false)
    const { showToast } = useToast()
    const { selectedCompanyId: contextCompanyId } = useCompany()
    const [isMobile, setIsMobile] = useState(false)

    useEffect(() => {
        const checkMobile = () => setIsMobile(window.innerWidth < 1024)
        checkMobile()
        window.addEventListener('resize', checkMobile)
        return () => window.removeEventListener('resize', checkMobile)
    }, [])


    useEffect(() => {
        setTitle(modules.label('clients'))
        setSubtitle(t('clients_subtitle' as any))
        return () => {
            setTitle(null)
            setSubtitle(null)
        }
    }, [setTitle, setSubtitle, t, modules])

    const [selectedCompanyId, setSelectedCompanyId] = useState('')

    // F-25: only Super Admins ever needed this list (for the "assign to
    // company" dropdown), so the key is null — no fetch at all — for
    // everyone else, replacing the old role-gated no-op inside
    // checkSuperAdmin().
    const companiesQuery = session?.user?.role === 'SUPER_ADMIN' ? '/api/companies?limit=1000' : null
    const { data: companiesResult } = useSWR(companiesQuery, fetcher)
    const companies: { id: string, name: string }[] = (() => {
        const companiesData = companiesResult?.data?.data || companiesResult?.data || companiesResult
        return Array.isArray(companiesData) ? companiesData : []
    })()
    const showCompanySelect = !!companiesResult

    const [page, setPage] = useState(1)
    const limit = 10

    const clientsQuery = (() => {
        const baseUrl = contextCompanyId ? `/api/clients?companyId=${contextCompanyId}` : '/api/clients'
        return `${baseUrl}${baseUrl.includes('?') ? '&' : '?'}page=${page}&limit=${limit}`
    })()
    const { data: clientsResult, isLoading, mutate: mutateClients } = useSWR(clientsQuery, fetcher)
    const filteredClients: Client[] = clientsResult?.data?.data || clientsResult?.data || []
    const totalPages: number = clientsResult?.data?.totalPages || clientsResult?.totalPages || 0

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
                mutateClients()
            } else {
                const err = await res.json()
                setNotice({ variant: 'error', title: t('failed_create_client'), detail: err.error })
            }
        } catch (error) {
            console.error('Failed to create client', error)
            setNotice({ variant: 'error', title: t('error_generic') })
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
                mutateClients()
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
                <EmployeeFilter
                    onFilterChange={(newFilters: any) => setSearchQuery(newFilters.search)}
                    selectedEmployeeId={''}
                    hideEmployeeFilter={true}
                    hideStatusFilter={true}
                    hideDateFilter={true}
                    hideFilterButton={true}
                    dateFrom={''}
                    dateTo={''}
                    selectedStatus={''}
                    searchQuery={searchQuery}
                    placeholder={locale === 'ar' ? 'بحث عن اسم العميل' : 'Search Client Name'}
                    totalCount={filteredClients.length}
                    primaryAction={
                        <button
                            onClick={() => setIsModalOpen(true)}
                            className="btn btn-primary"
                            style={{ height: '48px', display: 'flex', alignItems: 'center', borderRadius: '1.25rem' }}
                        >
                            {t('add_client')}
                        </button>
                    }
                />

                {isLoading ? (
                    <LoadingSpinner message={t('loading_clients')} />
                ) : filteredClients.length === 0 ? (
                    <div className="glass-card flex flex-col items-center justify-center py-16 text-center text-slate-500">
                        <span className="text-5xl mb-4">{modules.icon('clients')}</span>
                        <h3 className="text-xl font-bold text-slate-800">{t('no_clients_found')}</h3>
                    </div>
                ) : (
                    <>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                            {filteredClients.map((client, index) => (
                                <div
                                    key={client.id}
                                    className="glass-card hover:bg-white/60 transition-all duration-300 p-4 border border-white/40 shadow-sm relative overflow-hidden"
                                    style={{
                                        animation: 'fadeIn 0.4s ease-out forwards',
                                        animationDelay: `${index * 50}ms`,
                                        marginBottom: '0.5rem'
                                    }}
                                >
                                    <div style={{
                                        display: 'flex',
                                        flexWrap: isMobile ? 'nowrap' : 'wrap',
                                        justifyContent: 'space-between',
                                        alignItems: 'center',
                                        width: '100%',
                                        gap: isMobile ? '0.5rem' : '1rem'
                                    }}>
                                        {/* Block 1: Left Side (Name & Badge) */}
                                        <div style={{
                                            flex: 1,
                                            minWidth: 0,
                                            paddingRight: isMobile ? '0' : '0.5rem',
                                            display: 'flex',
                                            flexDirection: isMobile ? 'column' : 'row',
                                            alignItems: isMobile ? 'flex-start' : 'center',
                                            gap: isMobile ? '0.375rem' : '0.75rem'
                                        }}>
                                            <h3 className="text-lg font-bold text-slate-800 leading-tight" style={{
                                                margin: 0,
                                                wordBreak: 'normal',
                                                whiteSpace: 'normal',
                                                overflowWrap: 'break-word'
                                            }}>
                                                {client.name}
                                            </h3>
                                            <div style={{ display: 'flex' }}>
                                                <span style={{
                                                    padding: isMobile ? '0.15rem 0.6rem' : '0.25rem 0.75rem',
                                                    borderRadius: '9999px',
                                                    background: 'var(--info-bg-indigo)',
                                                    color: 'var(--info-fg-indigo)',
                                                    fontSize: isMobile ? '0.75rem' : '0.875rem',
                                                    fontWeight: '600',
                                                    whiteSpace: 'nowrap',
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    gap: '0.375rem'
                                                }}>
                                                    <svg width={isMobile ? "12" : "14"} height={isMobile ? "12" : "14"} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                                        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
                                                        <circle cx="9" cy="7" r="4"></circle>
                                                        <path d="M23 21v-2a4 4 0 0 0-3-3.87"></path>
                                                        <path d="M16 3.13a4 4 0 0 1 0 7.75"></path>
                                                    </svg>
                                                    {client._count.sections} {client._count.sections === 1 ? t('section_label') : t('sections_label')}
                                                </span>
                                            </div>
                                        </div>

                                        {/* Spacer for Desktop (Invisible on Mobile) */}
                                        {!isMobile && <div style={{ flex: '0 1 auto' }}></div>}

                                        {/* Block 3: Right Side (Action Buttons) */}
                                        <div style={{
                                            display: 'flex',
                                            flexDirection: isMobile ? 'column' : 'row',
                                            alignItems: 'center',
                                            gap: '0.4rem',
                                            flex: '0 0 auto',
                                            marginLeft: locale === 'ar' ? '0' : (isMobile ? '0' : 'auto'),
                                            marginRight: locale === 'ar' ? (isMobile ? 'auto' : '0') : '0'
                                        }}>
                                            <Link
                                                href={`/dashboard/clients/${client.id}?name=${encodeURIComponent(client.name)}`}
                                                prefetch={false}
                                                className="btn btn-primary"
                                                style={{
                                                    textDecoration: 'none',
                                                    fontSize: '0.8125rem',
                                                    padding: '0.4rem 1rem',
                                                    display: 'inline-block',
                                                    textAlign: 'center',
                                                    whiteSpace: 'nowrap',
                                                    width: isMobile ? '100%' : 'auto'
                                                }}
                                            >
                                                {t('view_client')}
                                            </Link>

                                            <div style={{
                                                display: 'flex',
                                                gap: '0.4rem',
                                                width: isMobile ? '100%' : 'auto'
                                            }}>
                                                {can('clients.edit') && (
                                                    <button
                                                        onClick={() => {
                                                            setEditingClientId(client.id)
                                                            setEditClientName(client.name)
                                                            setIsEditClientModalOpen(true)
                                                        }}
                                                        className="btn"
                                                        style={{
                                                            background: 'var(--info-bg-subtle)',
                                                            color: 'var(--info-solid-hover)',
                                                            padding: '0.4rem 0.85rem',
                                                            fontSize: '0.8125rem',
                                                            border: 'none',
                                                            cursor: 'pointer',
                                                            whiteSpace: 'nowrap',
                                                            flex: isMobile ? 1 : 'unset'
                                                        }}
                                                    >
                                                        {t('edit')}
                                                    </button>
                                                )}

                                                {can('clients.delete') && (
                                                    <button
                                                        onClick={(e) => {
                                                            e.preventDefault()
                                                            setDeleteConfirm({ isOpen: true, client })
                                                        }}
                                                        className="btn"
                                                        style={{
                                                            background: 'var(--danger-bg-subtle)',
                                                            color: 'var(--danger-solid-hover)',
                                                            padding: '0.4rem 0.85rem',
                                                            fontSize: '0.8125rem',
                                                            border: 'none',
                                                            cursor: 'pointer',
                                                            whiteSpace: 'nowrap',
                                                            flex: isMobile ? 1 : 'unset'
                                                        }}
                                                    >
                                                        {t('delete')}
                                                    </button>
                                                )}
                                            </div>
                                        </div>
                                    </div>

                                    {/* Audit Trail */}
                                    <div style={{
                                        fontSize: '0.75rem',
                                        color: 'var(--text-faint)',
                                        display: 'flex',
                                        flexDirection: 'column',
                                        gap: '0.25rem',
                                        marginTop: '0.75rem',
                                        paddingTop: '0.75rem',
                                        borderTop: '1px dashed var(--surface-sunk)'
                                    }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                                            <span style={{
                                                padding: '0.15rem 0.4rem',
                                                background: 'var(--surface-sunk)',
                                                borderRadius: '0.4rem',
                                                fontWeight: '700',
                                                fontSize: '0.65rem',
                                                color: 'var(--text-soft)'
                                            }}>
                                                {(client.createdBy?.role || 'SYSTEM').replace(/_/g, ' ')}
                                            </span>
                                            <span>
                                                {t('created_by' as any) || 'Created by'} {client.createdBy ? `${client.createdBy.firstName} ${client.createdBy.lastName}` : 'System'} {t('at' as any) || 'at'} <SafeDate date={client.createdAt} locale={locale} />
                                            </span>
                                        </div>
                                        {client.lastEditedBy && (
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                                                <span style={{
                                                    padding: '0.15rem 0.4rem',
                                                    background: 'var(--info-bg-sky)',
                                                    borderRadius: '0.4rem',
                                                    fontWeight: '700',
                                                    fontSize: '0.65rem',
                                                    color: 'var(--info-solid-sky)'
                                                }}>
                                                    {client.lastEditedBy.role.replace(/_/g, ' ')}
                                                </span>
                                                <span>
                                                    {t('updated_by' as any) || 'Updated by'} {client.lastEditedBy.firstName} {client.lastEditedBy.lastName} {t('at' as any) || 'at'} <SafeDate date={client.updatedAt} locale={locale} />
                                                </span>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            ))}
                        </div>

                        <Pagination
                            currentPage={page}
                            totalPages={totalPages}
                            onPageChange={(p) => setPage(p)}
                        />
                    </>
                )}
            </div>

            {isModalOpen && mounted && createPortal(
                <div style={{
                    position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
                    background: 'var(--scrim)', display: 'flex', justifyContent: 'center',
                    alignItems: 'center', zIndex: 9999
                }}>
                    <div
                        className="absolute inset-0"
                        onClick={() => !isSubmitting && setIsModalOpen(false)}
                    />
                    <div style={{ background: 'var(--surface)', padding: '2rem', borderRadius: '12px', width: '100%', maxWidth: '500px', position: 'relative', zIndex: 10 }}>
                        <h2 style={{ fontSize: '1.5rem', fontWeight: 'bold', marginBottom: '1.5rem', color: 'var(--text-main)', textAlign: locale === 'ar' ? 'right' : 'left' }}>
                            {t('add_new_client_title')}
                        </h2>

                        <form onSubmit={handleCreateClient}>
                            {showCompanySelect && (
                                <div style={{ marginBottom: '1rem' }}>
                                    <label style={{ display: 'block', fontSize: '0.875rem', marginBottom: '0.5rem', color: 'var(--text-soft)', textAlign: locale === 'ar' ? 'right' : 'left' }}>
                                        {t('assign_to_company')}
                                    </label>
                                    <select
                                        value={selectedCompanyId}
                                        onChange={(e) => setSelectedCompanyId(e.target.value)}
                                        className="input"
                                        style={{ width: '100%', padding: '0.5rem', border: '1px solid var(--border)', borderRadius: '0.5rem', textAlign: locale === 'ar' ? 'right' : 'left' }}
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
                                <label style={{ display: 'block', fontSize: '0.875rem', marginBottom: '0.5rem', color: 'var(--text-soft)', textAlign: locale === 'ar' ? 'right' : 'left' }}>
                                    {t('client_company_name')}
                                </label>
                                <input
                                    type="text"
                                    value={newClientName}
                                    onChange={(e) => setNewClientName(e.target.value)}
                                    className="input"
                                    style={{ width: '100%', padding: '0.5rem', border: '1px solid var(--border)', borderRadius: '0.5rem', textAlign: locale === 'ar' ? 'right' : 'left' }}
                                    placeholder={t('client_placeholder')}
                                    autoFocus
                                />
                            </div>

                            <div style={{ display: 'flex', gap: '1rem', justifyContent: 'flex-end' }}>
                                <button
                                    type="button"
                                    onClick={() => setIsModalOpen(false)}
                                    style={{ padding: '0.75rem 1.5rem', border: '1px solid var(--border)', borderRadius: '0.5rem', background: 'transparent', cursor: 'pointer' }}
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
                                mutateClients()
                                setDeleteConfirm({ isOpen: false, client: null })
                            } else {
                                const err = await res.json()
                                setNotice({ variant: 'error', title: t('error_generic'), detail: err.error })
                            }
                        } catch {
                            setNotice({ variant: 'error', title: t('error_delete_client') })
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
                    background: 'var(--scrim)', display: 'flex', justifyContent: 'center',
                    alignItems: 'center', zIndex: 9999
                }}>
                    <div
                        className="absolute inset-0"
                        onClick={() => !isEditingClient && setIsEditClientModalOpen(false)}
                    />
                    <div style={{ background: 'var(--surface)', padding: '2rem', borderRadius: '12px', width: '100%', maxWidth: '500px', position: 'relative', zIndex: 10, direction: locale === 'ar' ? 'rtl' : 'ltr' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
                            <h2 style={{ fontSize: '1.5rem', fontWeight: 'bold', color: 'var(--text-main)', margin: 0 }}>{t('edit_client_title' as any) || 'Edit Client Name'}</h2>
                        </div>
                        <form onSubmit={handleEditClient}>
                            <div style={{ marginBottom: '1.5rem' }}>
                                <label style={{ display: 'block', fontSize: '0.875rem', marginBottom: '0.5rem', color: 'var(--text-soft)', textAlign: locale === 'ar' ? 'right' : 'left' }}>
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
                                        border: '1px solid var(--border)',
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
                                    style={{ padding: '0.75rem 1.5rem', border: '1px solid var(--border)', borderRadius: '0.5rem', background: 'transparent', cursor: 'pointer' }}
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
            <NoticeModal notice={notice} onClose={() => setNotice(null)} />
        </>
    )
}

'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { useHeader } from '@/context/HeaderContext'
import { createPortal } from 'react-dom'
import ConfirmModal from '@/components/ConfirmModal'
import EmployeeFilter from '@/components/EmployeeFilter'
import { useLanguage } from '@/context/LanguageContext'
import { useSession } from 'next-auth/react'
import Modal from '@/components/Modal'
import { useToast } from '@/context/ToastContext'
import Pagination from '@/components/Pagination'

interface Section {
    id: string
    title: string
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
        notes: number
    }
}

interface ClientData {
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
}

export default function ClientDetailsPage() {
    const { t, locale } = useLanguage()
    const params = useParams()
    const router = useRouter()
    const clientId = params.id as string

    const [client, setClient] = useState<ClientData | null>(null)
    const [sections, setSections] = useState<Section[]>([])
    const [isLoading, setIsLoading] = useState(true)
    const [isModalOpen, setIsModalOpen] = useState(false)
    const [newSectionTitle, setNewSectionTitle] = useState('')
    const [isSubmitting, setIsSubmitting] = useState(false)
    const [page, setPage] = useState(1)
    const [total, setTotal] = useState(0)
    const [totalPages, setTotalPages] = useState(0)
    const limit = 10
    const [error, setError] = useState<string | null>(null)
    const { setTitle } = useHeader()

    // UI State
    const [searchQuery, setSearchQuery] = useState('')
    const [showSuggestions, setShowSuggestions] = useState(false)
    const [mounted, setMounted] = useState(false)
    const [deleteConfirm, setDeleteConfirm] = useState<{ isOpen: boolean, section: Section | null }>({ isOpen: false, section: null })
    const { data: session } = useSession()
    const { showToast } = useToast()
    const [isEditClientModalOpen, setIsEditClientModalOpen] = useState(false)
    const [editClientName, setEditClientName] = useState('')
    const [isEditingClient, setIsEditingClient] = useState(false)
    const [isEditSectionModalOpen, setIsEditSectionModalOpen] = useState(false)
    const [editSectionTitle, setEditSectionTitle] = useState('')
    const [editingSectionId, setEditingSectionId] = useState<string | null>(null)
    const [isEditingSection, setIsEditingSection] = useState(false)

    const canEdit = session?.user?.role === 'SUPER_ADMIN' || session?.user?.role === 'ADMIN' || session?.user?.role === 'TEAM_LEADER'

    useEffect(() => {
        setMounted(true)
    }, [])

    useEffect(() => {
        if (clientId) {
            fetchData()
        }
    }, [clientId, page, searchQuery])

    useEffect(() => {
        if (client?.name) {
            setTitle(client.name)
        }
        return () => setTitle(null) // Reset on unmount
    }, [client, setTitle])

    const fetchData = async () => {
        try {
            setError(null)
            const [clientsRes, sectionsRes] = await Promise.all([
                fetch('/api/clients'),
                fetch(`/api/clients/${clientId}/sections?page=${page}&limit=${limit}&search=${encodeURIComponent(searchQuery)}`)
            ])

            if (clientsRes.ok && sectionsRes.ok) {
                const clientsData = await clientsRes.json()
                const sectionsData = await sectionsRes.json()

                const foundClient = clientsData.find((c: any) => c.id === clientId)
                if (foundClient) {
                    setClient(foundClient)
                }
                setSections(sectionsData.data || [])
                setTotal(sectionsData.total || 0)
                setTotalPages(sectionsData.totalPages || 1)
            } else {
                if (sectionsRes.status === 404) {
                    setError(t('failed_fetch_client_details' as any))
                } else {
                    setError(t('failed_save_generic'))
                }
            }
        } catch (error) {
            console.error('Failed to fetch data', error)
            setError(t('failed_save_generic'))
        } finally {
            setIsLoading(false)
        }
    }

    const handleEditClient = async (e: React.FormEvent) => {
        e.preventDefault()
        if (!editClientName.trim() || !client) return

        setIsEditingClient(true)
        try {
            const res = await fetch('/api/clients', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: client.id, name: editClientName })
            })

            if (res.ok) {
                const updated = await res.json()
                setClient(updated)
                setIsEditClientModalOpen(false)
                showToast(t('client_updated_success' as any) || 'Client updated successfully', 'success')
            } else {
                showToast(t('failed_save_generic'), 'error')
            }
        } catch (error) {
            console.error('Failed to update client', error)
            showToast(t('failed_save_generic'), 'error')
        } finally {
            setIsEditingClient(false)
        }
    }

    const handleEditSection = async (e: React.FormEvent) => {
        e.preventDefault()
        if (!editSectionTitle.trim() || !editingSectionId) return

        setIsEditingSection(true)
        try {
            const res = await fetch(`/api/clients/${clientId}/sections`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: editingSectionId, title: editSectionTitle })
            })

            if (res.ok) {
                const updated = await res.json()
                setSections(prev => prev.map(s => s.id === editingSectionId ? { ...s, title: updated.title } : s))
                setIsEditSectionModalOpen(false)
                setEditingSectionId(null)
                showToast(t('section_updated_success' as any) || 'Section updated successfully', 'success')
            } else {
                showToast(t('failed_save_generic'), 'error')
            }
        } catch (error) {
            console.error('Failed to update section', error)
            showToast(t('failed_save_generic'), 'error')
        } finally {
            setIsEditingSection(false)
        }
    }

    const handleCreateSection = async (e: React.FormEvent) => {
        e.preventDefault()
        if (!newSectionTitle.trim()) return

        setIsSubmitting(true)
        try {
            const res = await fetch(`/api/clients/${clientId}/sections`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ title: newSectionTitle })
            })

            if (res.ok) {
                setNewSectionTitle('')
                setIsModalOpen(false)
                fetchData()
            }
        } catch (error) {
            console.error('Failed to create section', error)
        } finally {
            setIsSubmitting(false)
        }
    }

    // Server-side filtering is now implemented
    const filteredSections = sections

    if (error) {
        return (
            <div className="flex flex-col items-center justify-center min-h-[50vh] text-center space-y-4" style={{ direction: locale === 'ar' ? 'rtl' : 'ltr' }}>
                <div className="text-red-500 text-5xl">⚠️</div>
                <h2 className="text-2xl font-bold text-slate-800">{t('failed_save_generic')}</h2>
                <p className="text-slate-500 max-w-md">{error}</p>
                <div className="flex gap-4">
                    <button onClick={fetchData} className="btn btn-outline">{t('all_companies').split(' ')[0]}</button>
                    <Link href="/dashboard/clients" className="btn btn-primary">{t('back_to_clients' as any)}</Link>
                </div>
            </div>
        )
    }

    const containerStyle: React.CSSProperties = {
        direction: locale === 'ar' ? 'rtl' : 'ltr',
        textAlign: locale === 'ar' ? 'right' : 'left'
    }

    return (
        <div style={containerStyle}>
            <div className="space-y-6 animate-in fade-in duration-500">
                <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '1rem' }}>
                    <Link
                        href="/dashboard/clients"
                        className="glass"
                        style={{
                            width: '40px',
                            height: '40px',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            color: 'var(--primary)',
                            textDecoration: 'none',
                            transition: 'all 0.3s ease',
                            border: '1px solid rgba(255, 255, 255, 0.4)',
                            transform: `translateY(-2px)${locale === 'ar' ? ' scaleX(-1)' : ''}`
                        }}
                        title={t('back_to_clients' as any)}
                    >
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                            <line x1="19" y1="12" x2="5" y2="12"></line>
                            <polyline points="12 19 5 12 12 5"></polyline>
                        </svg>
                    </Link>
                    <h1 className="text-3xl font-bold text-slate-800 tracking-tight">{t('sections_title' as any)}</h1>
                </div>

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
                    totalCount={total}
                    primaryAction={
                        <button
                            onClick={() => setIsModalOpen(true)}
                            className="btn btn-primary"
                            style={{ height: '48px', display: 'flex', alignItems: 'center', borderRadius: '1.25rem' }}
                        >
                            {t('add_section_button' as any)}
                        </button>
                    }
                />

                {/* List View */}
                {isLoading ? (
                    <div className="flex flex-col items-center justify-center py-20 space-y-4">
                        <div className="w-12 h-12 border-4 border-indigo-200 border-t-indigo-600 rounded-full animate-spin"></div>
                        <p className="text-slate-500 font-medium animate-pulse">{t('loading_filters')}</p>
                    </div>
                ) : filteredSections.length === 0 ? (
                    <div className="glass-card flex flex-col items-center justify-center py-12 text-center text-slate-500">
                        <span className="text-4xl mb-2">📂</span>
                        <h3 className="text-lg font-bold text-slate-800">{t('no_sections_found' as any)}</h3>
                        <p className="max-w-xs mx-auto mt-1 mb-4">
                            {searchQuery ? `${t('no_matches_found' as any)} "${searchQuery}"` : t('add_first_section_msg' as any)}
                        </p>
                    </div>
                ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                        {filteredSections.map((section, index) => (
                            <div
                                key={section.id}
                                className="glass-card hover:bg-white/60 transition-all duration-300 p-4 border border-white/40 shadow-sm relative overflow-hidden"
                                style={{
                                    animationDelay: `${index * 50}ms`,
                                    marginBottom: '0.5rem'
                                }}
                            >
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%', gap: '1rem' }}>
                                    {/* Left Side: Title & Info */}
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                                        <h3 className="text-lg font-semibold text-slate-800 leading-tight" style={{ margin: 0 }}>
                                            {section.title}
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
                                            {section._count.notes} {section._count.notes === 1 ? t('note_label' as any) : t('notes_label' as any)}
                                        </span>
                                    </div>

                                    {/* Action Buttons Container */}
                                    <div style={{ display: 'flex', gap: '0.5rem', marginLeft: locale === 'ar' ? '0' : 'auto', marginRight: locale === 'ar' ? 'auto' : '0' }}>
                                        <Link
                                            href={`/dashboard/clients/${clientId}/sections/${section.id}`}
                                            className="btn btn-primary"
                                            style={{
                                                textDecoration: 'none',
                                                fontSize: '0.875rem',
                                                padding: '0.5rem 1rem',
                                                display: 'inline-block'
                                            }}
                                        >
                                            {t('view_section_button' as any)}
                                        </Link>
                                        <button
                                            onClick={() => {
                                                setEditingSectionId(section.id)
                                                setEditSectionTitle(section.title)
                                                setIsEditSectionModalOpen(true)
                                            }}
                                            className="btn"
                                            style={{
                                                background: '#dbeafe',
                                                color: '#1e40af',
                                                padding: '0.5rem 1rem',
                                                fontSize: '0.875rem',
                                                border: 'none',
                                                cursor: 'pointer'
                                            }}
                                        >
                                            {t('edit')}
                                        </button>
                                        <button
                                            onClick={(e) => {
                                                e.preventDefault()
                                                setDeleteConfirm({ isOpen: true, section })
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

                                <div style={{
                                    fontSize: '0.75rem',
                                    color: '#94a3b8',
                                    display: 'flex',
                                    flexDirection: 'column',
                                    gap: '0.25rem',
                                    marginTop: '0.75rem',
                                    paddingTop: '0.75rem',
                                    borderTop: '1px dashed #f1f5f9'
                                }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                                        <span style={{
                                            padding: '0.15rem 0.4rem',
                                            background: '#f1f5f9',
                                            borderRadius: '0.4rem',
                                            fontWeight: '700',
                                            fontSize: '0.65rem',
                                            color: '#64748b'
                                        }}>
                                            {(section.createdBy?.role || 'SYSTEM').replace(/_/g, ' ')}
                                        </span>
                                        <span>
                                            {t('created_by' as any) || 'Created by'} {section.createdBy ? `${section.createdBy.firstName} ${section.createdBy.lastName}` : 'System'} {t('at' as any) || 'at'} {new Date(section.createdAt).toLocaleDateString(locale === 'ar' ? 'ar-EG' : 'en-GB', { day: 'numeric', month: 'short' }) + ', ' + new Date(section.createdAt).toLocaleDateString(locale === 'ar' ? 'ar-EG' : 'en-GB', { year: 'numeric' }) + ', ' + new Date(section.createdAt).toLocaleTimeString(locale === 'ar' ? 'ar-EG' : 'en-US', { hour: 'numeric', minute: '2-digit', hour12: true })}
                                        </span>
                                    </div>
                                    {section.lastEditedBy && (
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                                            <span style={{
                                                padding: '0.15rem 0.4rem',
                                                background: '#f0f9ff',
                                                borderRadius: '0.4rem',
                                                fontWeight: '700',
                                                fontSize: '0.65rem',
                                                color: '#0ea5e9'
                                            }}>
                                                {section.lastEditedBy.role.replace(/_/g, ' ')}
                                            </span>
                                            <span>
                                                {t('updated_by' as any) || 'Updated by'} {section.lastEditedBy.firstName} {section.lastEditedBy.lastName} {t('at' as any) || 'at'} {new Date(section.updatedAt).toLocaleDateString(locale === 'ar' ? 'ar-EG' : 'en-GB', { day: 'numeric', month: 'short' }) + ', ' + new Date(section.updatedAt).toLocaleDateString(locale === 'ar' ? 'ar-EG' : 'en-GB', { year: 'numeric' }) + ', ' + new Date(section.updatedAt).toLocaleTimeString(locale === 'ar' ? 'ar-EG' : 'en-US', { hour: 'numeric', minute: '2-digit', hour12: true })}
                                            </span>
                                        </div>
                                    )}
                                </div>
                            </div>
                        ))}
                    </div>
                )}

                <Pagination
                    currentPage={page}
                    totalPages={totalPages}
                    onPageChange={(p) => setPage(p)}
                />
            </div>

            {/* Create Section Modal - Portal */}
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
                    <div style={{ background: 'white', padding: '2rem', borderRadius: '12px', width: '100%', maxWidth: '500px', position: 'relative', zIndex: 10, direction: locale === 'ar' ? 'rtl' : 'ltr' }}>
                        <h2 style={{ fontSize: '1.5rem', fontWeight: 'bold', marginBottom: '1.5rem', color: '#1e293b', textAlign: locale === 'ar' ? 'right' : 'left' }}>{t('add_section_title' as any)}</h2>

                        <form onSubmit={handleCreateSection}>
                            <div style={{ marginBottom: '1.5rem' }}>
                                <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: '600', color: '#64748b', marginBottom: '0.5rem', textAlign: locale === 'ar' ? 'right' : 'left' }}>
                                    {t('section_title_label' as any)}
                                </label>
                                <input
                                    type="text"
                                    required
                                    value={newSectionTitle}
                                    onChange={(e) => setNewSectionTitle(e.target.value)}
                                    placeholder={t('section_title_placeholder' as any)}
                                    style={{
                                        width: '100%',
                                        padding: '0.75rem 1rem',
                                        borderRadius: '0.5rem',
                                        border: '1px solid #e2e8f0',
                                        outline: 'none',
                                        fontSize: '0.875rem',
                                        textAlign: locale === 'ar' ? 'right' : 'left'
                                    }}
                                />
                            </div>

                            <div style={{ display: 'flex', gap: '1rem', justifyContent: 'flex-end' }}>
                                <button
                                    type="button"
                                    onClick={() => setIsModalOpen(false)}
                                    style={{
                                        padding: '0.625rem 1.25rem',
                                        borderRadius: '0.5rem',
                                        fontSize: '0.875rem',
                                        fontWeight: '600',
                                        color: '#64748b',
                                        background: '#f1f5f9',
                                        border: 'none',
                                        cursor: 'pointer'
                                    }}
                                >
                                    {t('cancel')}
                                </button>
                                <button
                                    type="submit"
                                    disabled={!newSectionTitle.trim() || isSubmitting}
                                    className="btn btn-primary"
                                    style={{
                                        padding: '0.625rem 1.25rem',
                                        borderRadius: '0.5rem',
                                        fontSize: '0.875rem',
                                        fontWeight: '600',
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '0.5rem'
                                    }}
                                >
                                    {isSubmitting ? (
                                        <>
                                            <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                                            {t('creating_task' as any)}
                                        </>
                                    ) : t('create_section_button' as any)}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>,
                document.body
            )}

            {/* Delete Section Confirm */}
            {deleteConfirm.isOpen && (
                <ConfirmModal
                    isOpen={deleteConfirm.isOpen}
                    title={t('confirm_delete')}
                    message={(t('delete_section_warning' as any) || 'Are you sure you want to delete this section?') + (locale === 'ar' ? '؟' : '?')}
                    confirmText={t('delete')}
                    cancelText={t('cancel')}
                    onConfirm={async () => {
                        if (!deleteConfirm.section) return
                        setIsSubmitting(true)
                        try {
                            const res = await fetch(`/api/clients/${clientId}/sections?id=${deleteConfirm.section.id}`, {
                                method: 'DELETE'
                            })
                            if (res.ok) {
                                fetchData()
                                setDeleteConfirm({ isOpen: false, section: null })
                            } else {
                                const err = await res.json()
                                showToast(`${t('error_generic')}: ${err.error}`, 'error')
                            }
                        } catch (e) {
                            showToast(t('error_generic'), 'error')
                        } finally {
                            setIsSubmitting(false)
                        }
                    }}
                    onCancel={() => setDeleteConfirm({ isOpen: false, section: null })}
                />
            )}

            {/* Edit Client Modal */}
            {isEditClientModalOpen && (
                <Modal
                    isOpen={isEditClientModalOpen}
                    onClose={() => setIsEditClientModalOpen(false)}
                    title={t('edit_client_name' as any)}
                >
                    <form onSubmit={handleEditClient} style={{ direction: locale === 'ar' ? 'rtl' : 'ltr' }}>
                        <div style={{ marginBottom: '1.25rem' }}>
                            <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: '600', color: '#64748b', marginBottom: '0.5rem', textAlign: locale === 'ar' ? 'right' : 'left' }}>
                                {t('client_name_label' as any)}
                            </label>
                            <input
                                type="text"
                                required
                                value={editClientName}
                                onChange={(e) => setEditClientName(e.target.value)}
                                style={{
                                    width: '100%',
                                    padding: '0.75rem 1rem',
                                    borderRadius: '0.5rem',
                                    border: '1px solid #e2e8f0',
                                    outline: 'none',
                                    fontSize: '0.875rem',
                                    textAlign: locale === 'ar' ? 'right' : 'left'
                                }}
                            />
                        </div>
                        <div style={{ display: 'flex', gap: '1rem', justifyContent: 'flex-end' }}>
                            <button
                                type="button"
                                onClick={() => setIsEditClientModalOpen(false)}
                                className="btn btn-outline"
                            >
                                {t('cancel')}
                            </button>
                            <button
                                type="submit"
                                disabled={!editClientName.trim() || isEditingClient}
                                className="btn btn-primary"
                            >
                                {isEditingClient ? t('submitting') : t('save')}
                            </button>
                        </div>
                    </form>
                </Modal>
            )}

            {/* Edit Section Modal */}
            {isEditSectionModalOpen && (
                <Modal
                    isOpen={isEditSectionModalOpen}
                    onClose={() => setIsEditSectionModalOpen(false)}
                    title={t('edit_section_title' as any)}
                >
                    <form onSubmit={handleEditSection} style={{ direction: locale === 'ar' ? 'rtl' : 'ltr' }}>
                        <div style={{ marginBottom: '1.25rem' }}>
                            <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: '600', color: '#64748b', marginBottom: '0.5rem', textAlign: locale === 'ar' ? 'right' : 'left' }}>
                                {t('section_title_label' as any)}
                            </label>
                            <input
                                type="text"
                                required
                                value={editSectionTitle}
                                onChange={(e) => setEditSectionTitle(e.target.value)}
                                style={{
                                    width: '100%',
                                    padding: '0.75rem 1rem',
                                    borderRadius: '0.5rem',
                                    border: '1px solid #e2e8f0',
                                    outline: 'none',
                                    fontSize: '0.875rem',
                                    textAlign: locale === 'ar' ? 'right' : 'left'
                                }}
                            />
                        </div>
                        <div style={{ display: 'flex', gap: '1rem', justifyContent: 'flex-end' }}>
                            <button
                                type="button"
                                onClick={() => setIsEditSectionModalOpen(false)}
                                className="btn btn-outline"
                            >
                                {t('cancel')}
                            </button>
                            <button
                                type="submit"
                                disabled={!editSectionTitle.trim() || isEditingSection}
                                className="btn btn-primary"
                            >
                                {isEditingSection ? t('submitting') : t('save')}
                            </button>
                        </div>
                    </form>
                </Modal>
            )}
        </div>
    )
}

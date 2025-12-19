'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { useHeader } from '@/context/HeaderContext'
import { createPortal } from 'react-dom'
import ConfirmModal from '@/components/ConfirmModal'

interface Section {
    id: string
    title: string
    _count: {
        notes: number
    }
}

interface ClientData {
    id: string
    name: string
}

export default function ClientDetailsPage() {
    const params = useParams()
    const router = useRouter()
    const clientId = params.id as string

    const [client, setClient] = useState<ClientData | null>(null)
    const [sections, setSections] = useState<Section[]>([])
    const [isLoading, setIsLoading] = useState(true)
    const [isModalOpen, setIsModalOpen] = useState(false)
    const [newSectionTitle, setNewSectionTitle] = useState('')
    const [isSubmitting, setIsSubmitting] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const { setTitle } = useHeader()

    // UI State
    const [searchQuery, setSearchQuery] = useState('')
    const [showSuggestions, setShowSuggestions] = useState(false)
    const [mounted, setMounted] = useState(false)
    const [deleteConfirm, setDeleteConfirm] = useState<{ isOpen: boolean, section: Section | null }>({ isOpen: false, section: null })

    useEffect(() => {
        setMounted(true)
    }, [])

    useEffect(() => {
        if (clientId) {
            fetchData()
        }
    }, [clientId])

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
                fetch(`/api/clients/${clientId}/sections`)
            ])

            if (clientsRes.ok && sectionsRes.ok) {
                const clientsData = await clientsRes.json()
                const sectionsData = await sectionsRes.json()

                const foundClient = clientsData.find((c: any) => c.id === clientId)
                if (foundClient) {
                    setClient(foundClient)
                } else {
                    // Start of mismatch detection - if client list doesn't have it, but sections fetch worked?
                    // Currently sections fetch validates existence too.
                }

                setSections(sectionsData)
            } else {
                if (sectionsRes.status === 404) {
                    console.error('Sections API returned 404')
                    setError('Client not found or access denied.')
                    setIsLoading(false)
                    return
                }
                setError('Failed to load client data.')
            }
        } catch (error) {
            console.error('Failed to fetch data', error)
            setError('An unexpected error occurred.')
        } finally {
            setIsLoading(false)
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

    const filteredSections = sections.filter(section =>
        section.title.toLowerCase().includes(searchQuery.toLowerCase())
    )

    if (error) {
        return (
            <div className="flex flex-col items-center justify-center min-h-[50vh] text-center space-y-4">
                <div className="text-red-500 text-5xl">⚠️</div>
                <h2 className="text-2xl font-bold text-slate-800">Error Loading Client</h2>
                <p className="text-slate-500 max-w-md">{error}</p>
                <div className="flex gap-4">
                    <button onClick={fetchData} className="btn btn-outline">Retry</button>
                    <Link href="/dashboard/clients" className="btn btn-primary">Back to Clients</Link>
                </div>
            </div>
        )
    }

    return (
        <>
            <div className="space-y-6 animate-in fade-in duration-500">
                {/* Header Row */}
                <div style={{ marginBottom: '1.5rem' }}>
                    <Link
                        href="/dashboard/clients"
                        className="glass"
                        style={{
                            width: '40px',
                            height: '40px',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            marginBottom: '0.75rem',
                            color: 'var(--primary)',
                            textDecoration: 'none',
                            transition: 'all 0.3s ease',
                            border: '1px solid rgba(255, 255, 255, 0.4)',
                            transform: 'translateY(-2px)'
                        }}
                        onMouseOver={(e) => {
                            e.currentTarget.style.transform = 'translateY(-4px)'
                            e.currentTarget.style.background = 'rgba(255, 255, 255, 0.9)'
                        }}
                        onMouseOut={(e) => {
                            e.currentTarget.style.transform = 'translateY(-2px)'
                            e.currentTarget.style.background = 'rgba(255, 255, 255, 0.7)'
                        }}
                        title="Back to Clients"
                    >
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                            <line x1="19" y1="12" x2="5" y2="12"></line>
                            <polyline points="12 19 5 12 12 5"></polyline>
                        </svg>
                    </Link>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <h1 className="text-3xl font-bold text-slate-800 tracking-tight">Sections</h1>
                        <button
                            onClick={() => setIsModalOpen(true)}
                            className="btn btn-primary"
                        >
                            Add Section
                        </button>
                    </div>
                </div>

                {/* Filter/Search Row */}
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
                                Search Sections
                            </label>
                            <input
                                type="text"
                                placeholder="e.g. Marketing..."
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
                                    {sections
                                        .filter(s => s.title.toLowerCase().includes(searchQuery.toLowerCase()))
                                        .map(section => (
                                            <div
                                                key={section.id}
                                                onClick={() => {
                                                    setSearchQuery(section.title)
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
                                                {section.title}
                                            </div>
                                        ))}
                                    {sections.filter(s => s.title.toLowerCase().includes(searchQuery.toLowerCase())).length === 0 && (
                                        <div style={{ padding: '0.5rem 1rem', fontSize: '0.875rem', color: '#94a3b8' }}>
                                            No sections found
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
                        <p className="text-slate-500 font-medium animate-pulse">Loading sections...</p>
                    </div>
                ) : filteredSections.length === 0 ? (
                    <div className="glass-card flex flex-col items-center justify-center py-12 text-center text-slate-500">
                        <span className="text-4xl mb-2">📂</span>
                        <h3 className="text-lg font-bold text-slate-800">No sections found</h3>
                        <p className="max-w-xs mx-auto mt-1 mb-4">
                            {searchQuery ? `No matches for "${searchQuery}"` : "Get started by adding your first section."}
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
                                            {section._count.notes} {section._count.notes === 1 ? 'Note' : 'Notes'}
                                        </span>
                                    </div>

                                    {/* Right Side: Action Button */}
                                    <div style={{ marginLeft: 'auto', display: 'flex', gap: '0.5rem' }}>
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
                                            View Section
                                        </Link>
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
                                            Delete
                                        </button>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
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
                    <div style={{ background: 'white', padding: '2rem', borderRadius: '12px', width: '100%', maxWidth: '500px', position: 'relative', zIndex: 10 }}>
                        <h2 style={{ fontSize: '1.5rem', fontWeight: 'bold', marginBottom: '1.5rem', color: '#1e293b' }}>Add New Section</h2>

                        <form onSubmit={handleCreateSection}>
                            <div style={{ marginBottom: '1.5rem' }}>
                                <label style={{ display: 'block', fontSize: '0.875rem', marginBottom: '0.5rem', color: '#64748b' }}>
                                    Section Title
                                </label>
                                <input
                                    type="text"
                                    value={newSectionTitle}
                                    onChange={(e) => setNewSectionTitle(e.target.value)}
                                    className="input"
                                    style={{ width: '100%', padding: '0.5rem', border: '1px solid #e2e8f0', borderRadius: '0.5rem' }}
                                    placeholder="e.g. Marketing, Legal, Finance"
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
                                    disabled={!newSectionTitle.trim() || isSubmitting}
                                    className="btn btn-primary"
                                >
                                    {isSubmitting ? 'Creating...' : 'Create Section'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>,
                document.body
            )}

            <ConfirmModal
                isOpen={deleteConfirm.isOpen}
                title="Delete Section"
                message={`Are you sure you want to delete "${deleteConfirm.section?.title}"? This will permanently delete all notes in this section. This action cannot be undone.`}
                confirmText="Delete Section"
                onConfirm={async () => {
                    if (deleteConfirm.section) {
                        try {
                            const res = await fetch(`/api/clients/${clientId}/sections?id=${deleteConfirm.section.id}`, { method: 'DELETE' })
                            if (res.ok) {
                                fetchData()
                                setDeleteConfirm({ isOpen: false, section: null })
                            } else {
                                const err = await res.json()
                                alert(`Failed to delete: ${err.error}`)
                            }
                        } catch (error) {
                            alert('Error deleting section')
                        }
                    }
                }}
                onCancel={() => setDeleteConfirm({ isOpen: false, section: null })}
                variant="danger"
            />
        </>
    )
}

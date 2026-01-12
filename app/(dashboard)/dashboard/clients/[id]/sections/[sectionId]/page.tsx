'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { useHeader } from '@/context/HeaderContext'
import { createPortal } from 'react-dom'
import ConfirmModal from '@/components/ConfirmModal'
import { useLanguage } from '@/context/LanguageContext'
import { useSession } from 'next-auth/react'
import { useToast } from '@/context/ToastContext'
import Modal from '@/components/Modal'
import EmployeeFilter from '@/components/EmployeeFilter'

interface Note {
    id: string
    content: string
    createdAt: string
    attachment?: string | null
    expiryDate?: string | null
    reminderDays?: number | null
    createdBy?: {
        id: string
        firstName: string
        lastName: string
        avatar: string | null
        role: string
    }
    lastEditedBy?: {
        firstName: string
        lastName: string
        role: string
    } | null
    lastEditedAt?: string | null
}

interface SectionData {
    id: string
    title: string
}

export default function SectionNotesPage() {
    const { t, locale } = useLanguage()
    const params = useParams()
    const router = useRouter()
    const clientId = params.id as string
    const sectionId = params.sectionId as string

    const [section, setSection] = useState<SectionData | null>(null)
    const [notes, setNotes] = useState<Note[]>([])
    const [isLoading, setIsLoading] = useState(true)
    const [isModalOpen, setIsModalOpen] = useState(false)
    const [newNoteContent, setNewNoteContent] = useState('')
    const [isSubmitting, setIsSubmitting] = useState(false)
    const [mounted, setMounted] = useState(false)
    const [deleteConfirm, setDeleteConfirm] = useState<{ isOpen: boolean, note: Note | null }>({ isOpen: false, note: null })
    const { setTitle } = useHeader()
    const { data: session } = useSession()
    const { showToast } = useToast()
    const [isEditSectionModalOpen, setIsEditSectionModalOpen] = useState(false)
    const [editSectionTitle, setEditSectionTitle] = useState('')
    const [isEditingSection, setIsEditingSection] = useState(false)

    const canEdit = session?.user?.role === 'SUPER_ADMIN' || session?.user?.role === 'ADMIN' || session?.user?.role === 'TEAM_LEADER'
    const isAuthorized = session?.user?.role === 'SUPER_ADMIN' || session?.user?.role === 'ADMIN'

    const [isEditModalOpen, setIsEditModalOpen] = useState(false)
    const [editingNote, setEditingNote] = useState<Note | null>(null)
    const [editNoteContent, setEditNoteContent] = useState('')
    const [editExpiryDate, setEditExpiryDate] = useState('')
    const [editReminderDays, setEditReminderDays] = useState('')


    // New Fields
    const [expiryDate, setExpiryDate] = useState('')
    const [reminderDays, setReminderDays] = useState('')
    const [selectedFile, setSelectedFile] = useState<File | null>(null)
    const [uploading, setUploading] = useState(false)
    const [searchQuery, setSearchQuery] = useState('')

    const filteredNotes = notes.filter(note => {
        const query = searchQuery.toLowerCase()
        const contentMatch = note.content.toLowerCase().includes(query)
        const creatorMatch = note.createdBy ? `${note.createdBy.firstName} ${note.createdBy.lastName}`.toLowerCase().includes(query) : false
        return contentMatch || creatorMatch
    })

    useEffect(() => {
        setMounted(true)
    }, [])

    useEffect(() => {
        if (clientId && sectionId) {
            fetchData()
        }
    }, [clientId, sectionId])

    useEffect(() => {
        if (section?.title) {
            setTitle(section.title)
        }
        return () => setTitle(null) // Reset on unmount
    }, [section, setTitle])

    const handleEditSection = async (e: React.FormEvent) => {
        e.preventDefault()
        if (!editSectionTitle.trim() || !section) return

        setIsEditingSection(true)
        try {
            const res = await fetch(`/api/clients/${clientId}/sections`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: section.id, title: editSectionTitle })
            })

            if (res.ok) {
                const updated = await res.json()
                setSection(updated)
                setIsEditSectionModalOpen(false)
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

    const fetchData = async () => {
        try {
            const [sectionsRes, notesRes] = await Promise.all([
                fetch(`/api/clients/${clientId}/sections`),
                fetch(`/api/clients/${clientId}/sections/${sectionId}/notes`)
            ])

            if (sectionsRes.ok && notesRes.ok) {
                const sectionsData = await sectionsRes.ok ? await sectionsRes.json() : []
                const notesData = await notesRes.json()

                const foundSection = sectionsData.find((s: any) => s.id === sectionId)
                if (foundSection) setSection(foundSection)

                setNotes(notesData)
            } else {
                if (notesRes.status === 404) router.push(`/dashboard/clients/${clientId}`)
            }
        } catch (error) {
            console.error('Failed to fetch data', error)
        } finally {
            setIsLoading(false)
        }
    }

    const handleCreateNote = async (e: React.FormEvent) => {
        e.preventDefault()
        if (!newNoteContent.trim()) return

        setIsSubmitting(true)
        setUploading(true)

        try {
            let attachmentUrl = null
            if (selectedFile) {
                const formData = new FormData()
                formData.append('file', selectedFile)
                formData.append('folder', 'notes')
                const uploadRes = await fetch('/api/upload', { method: 'POST', body: formData })
                const uploadData = await uploadRes.json()
                if (uploadData.success) {
                    attachmentUrl = uploadData.url
                } else {
                    throw new Error(uploadData.error || t('photo_upload_failed'))
                }
            }

            const res = await fetch(`/api/clients/${clientId}/sections/${sectionId}/notes`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    content: newNoteContent,
                    attachment: attachmentUrl,
                    expiryDate: expiryDate || null,
                    reminderDays: reminderDays || null
                })
            })

            if (res.ok) {
                setNewNoteContent('')
                setExpiryDate('')
                setReminderDays('')
                setSelectedFile(null)
                setIsModalOpen(false)
                fetchData() // Refresh
                showToast(t('note_created_success' as any) || 'Note Created Successfully', 'success')
            } else {
                const err = await res.json()
                showToast(`${t('failed_save_generic')}: ${err.error}`, 'error')
            }
        } catch (error) {
            console.error('Failed to create note', error)
            showToast(t('failed_save_generic'), 'error')
        } finally {
            setIsSubmitting(false)
            setUploading(false)
        }
    }

    const handleUpdateNote = async (e: React.FormEvent) => {
        e.preventDefault()
        if (!editNoteContent.trim() || !editingNote) return

        setIsSubmitting(true)

        try {
            const res = await fetch(`/api/clients/${clientId}/sections/${sectionId}/notes`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    noteId: editingNote.id,
                    content: editNoteContent,
                    expiryDate: editExpiryDate || null,
                    reminderDays: editReminderDays || null
                })
            })

            if (res.ok) {
                setIsEditModalOpen(false)
                setEditingNote(null)
                fetchData() // Refresh
                showToast(t('note_updated_success' as any) || 'Note Updated Successfully', 'success')
            } else {
                const err = await res.json()
                showToast(`${t('failed_save_generic')}: ${err.error}`, 'error')
            }
        } catch (error) {
            console.error('Failed to update note', error)
            showToast(t('failed_save_generic'), 'error')
        } finally {
            setIsSubmitting(false)
        }
    }


    const MAX_CHARS = 500

    const containerStyle: React.CSSProperties = {
        direction: locale === 'ar' ? 'rtl' : 'ltr',
        textAlign: locale === 'ar' ? 'right' : 'left'
    }

    return (
        <div style={containerStyle}>
            <div className="space-y-6 animate-in fade-in duration-500">
                {/* Header Row */}
                <div style={{ marginBottom: '1.5rem' }}>
                    <Link
                        href={`/dashboard/clients/${clientId}`}
                        className="glass"
                        style={{
                            width: '40px',
                            height: '40px',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            marginBottom: '1rem',
                            color: 'var(--primary)',
                            textDecoration: 'none',
                            transition: 'all 0.3s ease',
                            border: '1px solid rgba(255, 255, 255, 0.4)',
                            transform: `translateY(-2px)${locale === 'ar' ? ' scaleX(-1)' : ''}`,
                            float: locale === 'ar' ? 'right' : 'left'
                        }}
                        onMouseOver={(e) => {
                            e.currentTarget.style.transform = `translateY(-4px)${locale === 'ar' ? ' scaleX(-1)' : ''}`
                            e.currentTarget.style.background = 'rgba(255, 255, 255, 0.9)'
                        }}
                        onMouseOut={(e) => {
                            e.currentTarget.style.transform = `translateY(-2px)${locale === 'ar' ? ' scaleX(-1)' : ''}`
                            e.currentTarget.style.background = 'rgba(255, 255, 255, 0.7)'
                        }}
                    >
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                            <line x1="19" y1="12" x2="5" y2="12"></line>
                            <polyline points="12 19 5 12 12 5"></polyline>
                        </svg>
                    </Link>
                    <div style={{ clear: 'both' }}></div>

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
                        totalCount={filteredNotes.length}
                        primaryAction={
                            <button
                                onClick={() => setIsModalOpen(true)}
                                className="btn btn-primary"
                                style={{ height: '48px', display: 'flex', alignItems: 'center', borderRadius: '1.25rem' }}
                            >
                                {t('add_note_button' as any)}
                            </button>
                        }
                    />
                </div>

                {isLoading ? (
                    <div className="text-center py-10 text-slate-500">{t('loading_filters')}</div>
                ) : filteredNotes.length === 0 ? (
                    <div className="glass-card flex flex-col items-center justify-center py-12 text-center text-slate-500">
                        <span className="text-4xl mb-2">📝</span>
                        <h3 className="text-lg font-bold text-slate-800">
                            {searchQuery ? t('no_search_results' as any) || 'No matching notes found' : t('no_notes_found' as any)}
                        </h3>
                        <p className="max-w-xs mx-auto mt-1 mb-4">
                            {searchQuery ? t('try_different_search_msg' as any) || 'Try searching for different content or creator.' : t('start_documenting_msg' as any)}
                        </p>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                        {filteredNotes.map((note, index) => (
                            <div
                                key={note.id}
                                className="glass-card group relative flex flex-col h-full hover:shadow-xl hover:-translate-y-1 transition-all duration-300"
                                style={{
                                    animationDelay: `${index * 50}ms`,
                                    background: 'rgba(255, 255, 255, 0.7)',
                                    backdropFilter: 'blur(10px)',
                                    border: '1px solid rgba(255, 255, 255, 0.5)',
                                    borderRadius: '1.25rem',
                                    padding: '1.5rem'
                                }}
                            >
                                {/* Header: Icons & Expiry */}
                                <div className="flex justify-between items-start mb-4">
                                    <div className="flex gap-2">
                                        <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center text-primary group-hover:scale-110 transition-transform duration-300">
                                            {note.attachment ? (
                                                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                                    <path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48"></path>
                                                </svg>
                                            ) : (
                                                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                                    <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"></path>
                                                    <polyline points="14 2 14 8 20 8"></polyline>
                                                    <line x1="16" y1="13" x2="8" y2="13"></line>
                                                    <line x1="16" y1="17" x2="8" y2="17"></line>
                                                    <polyline points="10 9 9 9 8 9"></polyline>
                                                </svg>
                                            )}
                                        </div>
                                    </div>
                                    {note.expiryDate && (
                                        <div className="px-3 py-1 bg-amber-50 rounded-full text-[11px] font-bold text-amber-600 flex items-center gap-1.5 border border-amber-100/50">
                                            <div className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
                                            {new Date(note.expiryDate).toLocaleDateString(locale === 'ar' ? 'ar-EG' : 'en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                                        </div>
                                    )}
                                </div>

                                {/* Content */}
                                <div className="flex-grow mb-6">
                                    <p className="text-slate-700 text-sm leading-relaxed whitespace-pre-wrap line-clamp-6 group-hover:line-clamp-none transition-all duration-300">
                                        {note.content}
                                    </p>
                                </div>

                                {/* Divider */}
                                <div className="h-px w-full bg-gradient-to-r from-transparent via-slate-200 to-transparent mb-4 opacity-50" />

                                {/* Footer: Audit & Actions */}
                                <div className="space-y-4">
                                    {/* Audit Trail */}
                                    <div className="flex flex-col gap-2">
                                        <div className="flex items-center gap-2">
                                            <div className="px-2 py-0.5 bg-slate-100 rounded text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                                                {(note.createdBy?.role || 'USER').replace(/_/g, ' ')}
                                            </div>
                                            <div className="text-[11px] text-slate-500">
                                                <span className="font-semibold text-slate-700">{note.createdBy ? `${note.createdBy.firstName} ${note.createdBy.lastName}` : 'System'}</span>
                                                <span className="mx-1">•</span>
                                                {new Date(note.createdAt).toLocaleDateString(locale === 'ar' ? 'ar-EG' : 'en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                                            </div>
                                        </div>
                                        {note.lastEditedBy && note.lastEditedAt && (
                                            <div className="flex items-center gap-2">
                                                <div className="px-2 py-0.5 bg-sky-50 rounded text-[10px] font-bold text-sky-600 uppercase tracking-wider">
                                                    {(note.lastEditedBy.role || 'USER').replace(/_/g, ' ')}
                                                </div>
                                                <div className="text-[11px] text-slate-400 italic">
                                                    {t('updated_by' as any)} <span className="font-medium text-slate-500">{note.lastEditedBy.firstName} {note.lastEditedBy.lastName}</span>
                                                </div>
                                            </div>
                                        )}
                                    </div>

                                    {/* Action Buttons */}
                                    <div className="flex gap-2">
                                        {note.attachment && (
                                            <a
                                                href={note.attachment}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="flex-grow flex items-center justify-center gap-2 px-3 py-2 bg-primary/5 hover:bg-primary/10 text-primary text-xs font-bold rounded-xl transition-all duration-200 border border-primary/10"
                                            >
                                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                                                    <path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48"></path>
                                                </svg>
                                                {t('view_attachment' as any) || 'View File'}
                                            </a>
                                        )}
                                        {isAuthorized && (
                                            <div className="flex gap-1.5 ml-auto">
                                                <button
                                                    onClick={() => {
                                                        setEditingNote(note)
                                                        setEditNoteContent(note.content)
                                                        setEditExpiryDate(note.expiryDate ? new Date(note.expiryDate).toISOString().split('T')[0] : '')
                                                        setEditReminderDays(note.reminderDays ? note.reminderDays.toString() : '')
                                                        setIsEditModalOpen(true)
                                                    }}
                                                    className="w-9 h-9 flex items-center justify-center rounded-xl bg-slate-50 hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-all border border-slate-200/50"
                                                    title={t('edit')}
                                                >
                                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
                                                </button>
                                                <button
                                                    onClick={() => setDeleteConfirm({ isOpen: true, note })}
                                                    className="w-9 h-9 flex items-center justify-center rounded-xl bg-red-50 hover:bg-red-100 text-red-400 hover:text-red-500 transition-all border border-red-200/50"
                                                    title={t('delete')}
                                                >
                                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>
                                                </button>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* Create Note Modal - Portal */}
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
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
                            <h2 style={{ fontSize: '1.5rem', fontWeight: 'bold', color: '#1e293b', margin: 0 }}>{t('add_note_button' as any)}</h2>
                            <span style={{ fontSize: '0.75rem', color: newNoteContent.length > MAX_CHARS ? '#ef4444' : '#64748b' }}>
                                {newNoteContent.length}/{MAX_CHARS}
                            </span>
                        </div>
                        <form onSubmit={handleCreateNote}>
                            <div style={{ marginBottom: '1.5rem' }}>
                                <label style={{ display: 'block', fontSize: '0.875rem', marginBottom: '0.5rem', color: '#64748b', textAlign: locale === 'ar' ? 'right' : 'left' }}>
                                    {t('note_content_label' as any)}
                                </label>
                                <textarea
                                    value={newNoteContent}
                                    onChange={(e) => setNewNoteContent(e.target.value)}
                                    className="input"
                                    style={{
                                        width: '100%',
                                        padding: '0.75rem',
                                        border: `1px solid ${newNoteContent.length > MAX_CHARS ? '#ef4444' : '#e2e8f0'}`,
                                        borderRadius: '0.5rem',
                                        minHeight: '120px',
                                        lineHeight: '1.5',
                                        outline: 'none',
                                        marginBottom: '0.5rem',
                                        textAlign: locale === 'ar' ? 'right' : 'left'
                                    }}
                                    placeholder={t('note_placeholder' as any)}
                                    autoFocus
                                />
                                {newNoteContent.length > MAX_CHARS && (
                                    <p style={{ color: '#ef4444', fontSize: '0.75rem', marginTop: '0.5rem' }}>
                                        {t('note_limit_exceeded' as any)}
                                    </p>
                                )}
                            </div>

                            <div style={{ marginBottom: '1.5rem' }}>
                                <label style={{ display: 'block', fontSize: '0.875rem', marginBottom: '0.5rem', color: '#64748b', textAlign: locale === 'ar' ? 'right' : 'left' }}>
                                    {t('attachment_label' as any)}
                                </label>
                                <input
                                    type="file"
                                    accept=".jpg,.jpeg,.png,.gif,.webp,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx"
                                    onChange={(e) => {
                                        const file = e.target.files?.[0]
                                        if (file) {
                                            const MAX_SIZE = 4 * 1024 * 1024
                                            const allowedExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx']

                                            if (file.size > MAX_SIZE) {
                                                showToast(t('failed_upload_files') || `File ${file.name} is too large (max 4MB)`, 'error')
                                                e.target.value = ''
                                                setSelectedFile(null)
                                                return
                                            }

                                            const ext = file.name.substring(file.name.lastIndexOf('.')).toLowerCase()
                                            if (!allowedExtensions.includes(ext)) {
                                                showToast(`${t('error_generic') || 'Invalid file type'}: ${file.name}`, 'error')
                                                e.target.value = ''
                                                setSelectedFile(null)
                                                return
                                            }

                                            setSelectedFile(file)
                                        } else {
                                            setSelectedFile(null)
                                        }
                                    }}
                                    className="input"
                                    style={{
                                        width: '100%',
                                        padding: '0.5rem',
                                        borderRadius: '0.5rem',
                                        fontSize: '0.875rem',
                                        textAlign: locale === 'ar' ? 'right' : 'left'
                                    }}
                                />
                            </div>

                            <div style={{ display: 'flex', gap: '1rem', marginBottom: '1.5rem' }}>
                                <div style={{ flex: 1 }}>
                                    <label style={{ display: 'block', fontSize: '0.875rem', marginBottom: '0.5rem', color: '#64748b', textAlign: locale === 'ar' ? 'right' : 'left' }}>
                                        {t('expiry_date_label' as any)}
                                    </label>
                                    <input
                                        type="date"
                                        value={expiryDate}
                                        onChange={(e) => setExpiryDate(e.target.value)}
                                        className="input"
                                        style={{ width: '100%', padding: '0.5rem', borderRadius: '0.5rem', textAlign: locale === 'ar' ? 'right' : 'left' }}
                                    />
                                </div>
                                <div style={{ flex: 1 }}>
                                    <label style={{ display: 'block', fontSize: '0.875rem', marginBottom: '0.5rem', color: '#64748b', textAlign: locale === 'ar' ? 'right' : 'left' }}>
                                        {t('reminder_days_label' as any)}
                                    </label>
                                    <input
                                        type="number"
                                        value={reminderDays}
                                        onChange={(e) => setReminderDays(e.target.value)}
                                        placeholder={t('days_label')}
                                        min="1"
                                        className="input"
                                        style={{ width: '100%', padding: '0.5rem', borderRadius: '0.5rem', textAlign: locale === 'ar' ? 'right' : 'left' }}
                                    />
                                </div>
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
                                    disabled={!newNoteContent.trim() || isSubmitting || newNoteContent.length > MAX_CHARS}
                                    className="btn btn-primary"
                                    style={{ opacity: (!newNoteContent.trim() || isSubmitting || newNoteContent.length > MAX_CHARS) ? 0.5 : 1 }}
                                >
                                    {isSubmitting ? (uploading ? t('uploading_photo') : t('saving')) : t('add_note_button' as any)}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>,
                document.body
            )}

            <ConfirmModal
                isOpen={deleteConfirm.isOpen}
                title={t('delete_note_title' as any)}
                message={t('delete_note_msg' as any)}
                confirmText={t('delete')}
                onConfirm={async () => {
                    if (deleteConfirm.note) {
                        try {
                            const res = await fetch(`/api/clients/${clientId}/sections/${sectionId}/notes?noteId=${deleteConfirm.note.id}`, { method: 'DELETE' })
                            if (res.ok) {
                                fetchData()
                                setDeleteConfirm({ isOpen: false, note: null })
                            } else {
                                const err = await res.json()
                                alert(`${t('failed_save_generic')}: ${err.error}`)
                            }
                        } catch (error) {
                            alert(t('failed_save_generic'))
                        }
                    }
                }}
                onCancel={() => setDeleteConfirm({ isOpen: false, note: null })}
                variant="danger"
            />

            {/* Edit Section Modal */}
            <Modal
                isOpen={isEditSectionModalOpen}
                onClose={() => setIsEditSectionModalOpen(false)}
                title={t('edit_section_title' as any) || 'Edit Section Name'}
            >
                <form onSubmit={handleEditSection} style={{ direction: locale === 'ar' ? 'rtl' : 'ltr' }}>
                    <div style={{ marginBottom: '1.5rem' }}>
                        <label style={{ display: 'block', fontSize: '0.875rem', marginBottom: '0.5rem', color: '#64748b', textAlign: locale === 'ar' ? 'right' : 'left' }}>
                            {t('section_title_label' as any)}
                        </label>
                        <input
                            type="text"
                            value={editSectionTitle}
                            onChange={(e) => setEditSectionTitle(e.target.value)}
                            className="input"
                            style={{ width: '100%', padding: '0.5rem', border: '1px solid #e2e8f0', borderRadius: '0.5rem', textAlign: locale === 'ar' ? 'right' : 'left' }}
                            placeholder={t('section_title_placeholder' as any)}
                            autoFocus
                        />
                    </div>

                    <div style={{ display: 'flex', gap: '1rem', justifyContent: 'flex-end' }}>
                        <button
                            type="button"
                            onClick={() => setIsEditSectionModalOpen(false)}
                            className="btn"
                            style={{ background: '#f1f5f9' }}
                        >
                            {t('cancel')}
                        </button>
                        <button
                            type="submit"
                            disabled={!editSectionTitle.trim() || isEditingSection}
                            className="btn btn-primary"
                        >
                            {isEditingSection ? t('saving') : t('save')}
                        </button>
                    </div>
                </form>
            </Modal>

            {/* Edit Note Modal - Portal */}
            {isEditModalOpen && mounted && createPortal(
                <div style={{
                    position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
                    background: 'rgba(0,0,0,0.5)', display: 'flex', justifyContent: 'center',
                    alignItems: 'center', zIndex: 9999
                }}>
                    <div
                        className="absolute inset-0"
                        onClick={() => !isSubmitting && setIsEditModalOpen(false)}
                    />
                    <div style={{ background: 'white', padding: '2rem', borderRadius: '12px', width: '100%', maxWidth: '500px', position: 'relative', zIndex: 10, direction: locale === 'ar' ? 'rtl' : 'ltr' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
                            <h2 style={{ fontSize: '1.5rem', fontWeight: 'bold', color: '#1e293b', margin: 0 }}>{t('edit_note_title' as any) || 'Edit Note'}</h2>
                            <span style={{ fontSize: '0.75rem', color: editNoteContent.length > MAX_CHARS ? '#ef4444' : '#64748b' }}>
                                {editNoteContent.length}/{MAX_CHARS}
                            </span>
                        </div>
                        <form onSubmit={handleUpdateNote}>
                            <div style={{ marginBottom: '1.5rem' }}>
                                <label style={{ display: 'block', fontSize: '0.875rem', marginBottom: '0.5rem', color: '#64748b', textAlign: locale === 'ar' ? 'right' : 'left' }}>
                                    {t('note_content_label' as any)}
                                </label>
                                <textarea
                                    value={editNoteContent}
                                    onChange={(e) => setEditNoteContent(e.target.value)}
                                    className="input"
                                    style={{
                                        width: '100%',
                                        padding: '0.75rem',
                                        border: `1px solid ${editNoteContent.length > MAX_CHARS ? '#ef4444' : '#e2e8f0'}`,
                                        borderRadius: '0.5rem',
                                        minHeight: '120px',
                                        lineHeight: '1.5',
                                        outline: 'none',
                                        marginBottom: '0.5rem',
                                        textAlign: locale === 'ar' ? 'right' : 'left'
                                    }}
                                    placeholder={t('note_placeholder' as any)}
                                    autoFocus
                                />
                                {editNoteContent.length > MAX_CHARS && (
                                    <p style={{ color: '#ef4444', fontSize: '0.75rem', marginTop: '0.5rem' }}>
                                        {t('note_limit_exceeded' as any)}
                                    </p>
                                )}
                            </div>

                            <div style={{ display: 'flex', gap: '1rem', marginBottom: '1.5rem' }}>
                                <div style={{ flex: 1 }}>
                                    <label style={{ display: 'block', fontSize: '0.875rem', marginBottom: '0.5rem', color: '#64748b', textAlign: locale === 'ar' ? 'right' : 'left' }}>
                                        {t('expiry_date_label' as any)}
                                    </label>
                                    <input
                                        type="date"
                                        value={editExpiryDate}
                                        onChange={(e) => setEditExpiryDate(e.target.value)}
                                        className="input"
                                        style={{ width: '100%', padding: '0.5rem', borderRadius: '0.5rem', textAlign: locale === 'ar' ? 'right' : 'left' }}
                                    />
                                </div>
                                <div style={{ flex: 1 }}>
                                    <label style={{ display: 'block', fontSize: '0.875rem', marginBottom: '0.5rem', color: '#64748b', textAlign: locale === 'ar' ? 'right' : 'left' }}>
                                        {t('reminder_days_label' as any)}
                                    </label>
                                    <input
                                        type="number"
                                        value={editReminderDays}
                                        onChange={(e) => setEditReminderDays(e.target.value)}
                                        placeholder={t('days_label')}
                                        min="1"
                                        className="input"
                                        style={{ width: '100%', padding: '0.5rem', borderRadius: '0.5rem', textAlign: locale === 'ar' ? 'right' : 'left' }}
                                    />
                                </div>
                            </div>
                            <div style={{ display: 'flex', gap: '1rem', justifyContent: 'flex-end' }}>
                                <button
                                    type="button"
                                    onClick={() => setIsEditModalOpen(false)}
                                    style={{ padding: '0.75rem 1.5rem', border: '1px solid #e2e8f0', borderRadius: '0.5rem', background: 'transparent', cursor: 'pointer' }}
                                >
                                    {t('cancel')}
                                </button>
                                <button
                                    type="submit"
                                    disabled={!editNoteContent.trim() || isSubmitting || editNoteContent.length > MAX_CHARS}
                                    className="btn btn-primary"
                                    style={{ opacity: (!editNoteContent.trim() || isSubmitting || editNoteContent.length > MAX_CHARS) ? 0.5 : 1 }}
                                >
                                    {isSubmitting ? t('saving') : t('save')}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>,
                document.body
            )}
        </div>
    )
}

'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { useParams, useSearchParams } from 'next/navigation'
import { useHeader } from '@/context/HeaderContext'
import { createPortal } from 'react-dom'
import ConfirmModal from '@/components/ConfirmModal'
import { useLanguage } from '@/context/LanguageContext'
import LoadingSpinner from '@/components/LoadingSpinner'
import { useSession } from 'next-auth/react'
import { useToast } from '@/context/ToastContext'
import Modal from '@/components/Modal'
import EmployeeFilter from '@/components/EmployeeFilter'
import DatePickerSingle from '@/components/DatePickerSingle'
import Pagination from '@/components/Pagination'

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
    const searchParams = useSearchParams()
    const urlTitle = searchParams.get('title')
    const urlClientName = searchParams.get('clientName')
    const clientId = params.id as string
    const sectionId = params.sectionId as string

    const [section, setSection] = useState<SectionData | null>(null)
    const [notes, setNotes] = useState<Note[]>([])
    const [isLoading, setIsLoading] = useState(true)
    const [isModalOpen, setIsModalOpen] = useState(false)
    const [newNoteContent, setNewNoteContent] = useState('')
    const [isSubmitting, setIsSubmitting] = useState(false)
    const [deleteConfirm, setDeleteConfirm] = useState<{ isOpen: boolean, note: Note | null }>({ isOpen: false, note: null })
    const { setTitle } = useHeader()
    const { data: session } = useSession()
    const { showToast } = useToast()
    const [isEditSectionModalOpen, setIsEditSectionModalOpen] = useState(false)
    const [editSectionTitle, setEditSectionTitle] = useState('')
    const [isEditingSection, setIsEditingSection] = useState(false)


    const canEdit = !!session?.user
    const canDelete = session?.user?.role === 'SUPER_ADMIN' || session?.user?.role === 'ADMIN'

    const [isEditModalOpen, setIsEditModalOpen] = useState(false)
    const [editingNote, setEditingNote] = useState<Note | null>(null)
    const [editNoteContent, setEditNoteContent] = useState('')
    const [editExpiryDate, setEditExpiryDate] = useState('')
    const [editReminderDays, setEditReminderDays] = useState('')
    const [editExistingAttachments, setEditExistingAttachments] = useState<any[]>([])


    const [expiryDate, setExpiryDate] = useState('')
    const [reminderDays, setReminderDays] = useState('')
    const [pendingFiles, setPendingFiles] = useState<File[]>([])
    const [isDragging, setIsDragging] = useState(false)
    const [uploading, setUploading] = useState(false)
    const [searchQuery, setSearchQuery] = useState('')
    const [page, setPage] = useState(1)
    const [total, setTotal] = useState(0)
    const [totalPages, setTotalPages] = useState(0)
    const limit = 10
    const highlightId = searchParams.get('highlight')
    const [visualHighlightId, setVisualHighlightId] = useState<string | null>(highlightId)

    useEffect(() => {
        if (highlightId) {
            setVisualHighlightId(highlightId)
            const timer = setTimeout(() => {
                setVisualHighlightId(null)
            }, 6000)
            return () => clearTimeout(timer)
        } else {
            setVisualHighlightId(null)
        }
    }, [highlightId])

    // Server-side filtering is now implemented
    const filteredNotes = notes




    useEffect(() => {
        if (urlTitle) {
            setTitle(urlTitle)
        } else if (section?.title) {
            setTitle(section.title)
        }
        return () => setTitle(null) // Reset on unmount
    }, [section, urlTitle, setTitle])

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
                const result = await res.json()
                setSection(result.data || result)
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

    const fetchData = useCallback(async () => {
        try {
            const [sectionsRes, notesRes] = await Promise.all([
                fetch(`/api/clients/${clientId}/sections?limit=999`), // Fetch all sections for the title list
                fetch(`/api/clients/${clientId}/sections/${sectionId}/notes?page=${page}&limit=${limit}&search=${encodeURIComponent(searchQuery)}`)
            ])

            if (sectionsRes.ok && notesRes.ok) {
                const sectionsData = await sectionsRes.json()
                const notesData = await notesRes.json()

                // sections API is now paginated too, so we need to handle that if it's used for the title
                const sectionsList = sectionsData.data.data || sectionsData.data || sectionsData
                const foundSection = sectionsList.find((s: any) => s.id === sectionId)
                if (foundSection) setSection(foundSection)

                const data = notesData.data
                setNotes(data.data || [])
                setTotal(data.total || 0)
                setTotalPages(data.totalPages || 1)
            } else {
                if (notesRes.status === 404) {
                    // Using window.location instead of router since it's unused elsewhere and we removed it
                    window.location.href = `/dashboard/clients/${clientId}`
                }
            }
        } catch (error) {
            console.error('Failed to fetch data', error)
        } finally {
            setIsLoading(false)
        }
    }, [clientId, sectionId, page, searchQuery, limit])

    useEffect(() => {
        if (clientId && sectionId) {
            fetchData()
        }
    }, [fetchData, clientId, sectionId])

    // Scroll to highlighted note
    useEffect(() => {
        if (highlightId && !isLoading && notes.length > 0) {
            const element = document.getElementById(`note-${highlightId}`);
            if (element) {
                element.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
        }
    }, [highlightId, isLoading, notes]);

    const handleFiles = (files: File[]) => {
        const MAX_SIZE = 4 * 1024 * 1024
        const validFiles = files.filter(f => {
            if (f.size > MAX_SIZE) {
                showToast(`${t('failed_upload_files')}: ${f.name} is too large (max 4MB)`, 'error')
                return false
            }
            return true
        })
        setPendingFiles(prev => [...prev, ...validFiles])
    }

    const removePendingFile = (index: number) => {
        setPendingFiles(prev => prev.filter((_, i) => i !== index))
    }

    const getNoteAttachments = (attachment: string | null | undefined): any[] => {
        if (!attachment) return []
        try {
            const parsed = JSON.parse(attachment)
            if (Array.isArray(parsed)) {
                return parsed.filter(i => i !== null && i !== undefined)
            }
            if (parsed === null) return []
            return [parsed]
        } catch {
            // Backward compatibility for single URL strings
            if (typeof attachment === 'string' && attachment.startsWith('http')) {
                return [{ url: attachment, name: attachment.split('/').pop() || 'File', size: 0, type: 'unknown' }]
            }
            return []
        }
    }

    const handleCreateNote = async (e: React.FormEvent) => {
        e.preventDefault()
        if (!newNoteContent.trim() && pendingFiles.length === 0) return

        setIsSubmitting(true)
        setUploading(true)

        try {
            const attachmentUrls: string[] = []

            // Upload multiple files
            for (const file of pendingFiles) {
                const formData = new FormData()
                formData.append('file', file)
                formData.append('folder', 'notes')
                const uploadRes = await fetch('/api/upload', { method: 'POST', body: formData })
                const result = await uploadRes.json()
                if (result.success) {
                    attachmentUrls.push({
                        url: result.data.url,
                        name: file.name,
                        size: file.size,
                        type: file.type || 'application/octet-stream',
                        uploadedAt: new Date().toISOString()
                    } as any)
                } else {
                    throw new Error(result.error || t('photo_upload_failed'))
                }
            }

            const res = await fetch(`/api/clients/${clientId}/sections/${sectionId}/notes`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    content: newNoteContent,
                    attachment: attachmentUrls,
                    expiryDate: expiryDate || null,
                    reminderDays: reminderDays || null
                })
            })

            if (res.ok) {
                setNewNoteContent('')
                setExpiryDate('')
                setReminderDays('')
                setPendingFiles([])
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
        setUploading(true)

        try {
            const newAttachmentUrls: string[] = []

            // Upload new pending files
            for (const file of pendingFiles) {
                const formData = new FormData()
                formData.append('file', file)
                formData.append('folder', 'notes')
                const uploadRes = await fetch('/api/upload', { method: 'POST', body: formData })
                const result = await uploadRes.json()
                if (result.success) {
                    newAttachmentUrls.push({
                        url: result.data.url,
                        name: file.name,
                        size: file.size,
                        type: file.type || 'application/octet-stream',
                        uploadedAt: new Date().toISOString()
                    } as any)
                } else {
                    throw new Error(result.error || t('photo_upload_failed'))
                }
            }

            // Combine with remaining existing attachments and new uploads
            const finalAttachments = [...editExistingAttachments, ...newAttachmentUrls]

            const res = await fetch(`/api/clients/${clientId}/sections/${sectionId}/notes`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    noteId: editingNote.id,
                    content: editNoteContent,
                    attachment: finalAttachments,
                    expiryDate: editExpiryDate || null,
                    reminderDays: editReminderDays || null
                })
            })

            if (res.ok) {
                setIsEditModalOpen(false)
                setEditingNote(null)
                setPendingFiles([])
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
            setUploading(false)
        }
    }

    const handleRemoveExistingAttachment = (itemToRemove: any) => {
        setEditExistingAttachments(prev => prev.filter(item =>
            (typeof item === 'string' ? item : item.url) !== (typeof itemToRemove === 'string' ? itemToRemove : itemToRemove.url)
        ))
    }

    const MAX_CHARS = 500


    const getRoleStyles = (role: string) => {
        switch (role) {
            case 'SUPER_ADMIN':
                return { background: 'rgba(254, 243, 199, 0.5)', color: 'var(--warn-fg)', border: '1px solid rgba(251, 191, 36, 0.3)' }
            case 'ADMIN':
                return { background: 'rgba(224, 242, 254, 0.5)', color: 'var(--info-fg-deep)', border: '1px solid rgba(56, 189, 248, 0.3)' }
            case 'TEAM_LEADER':
                return { background: 'rgba(245, 243, 199, 0.5)', color: 'var(--accent-fg)', border: '1px solid rgba(167, 139, 250, 0.3)' }
            default:
                return { background: 'rgba(241, 245, 249, 0.5)', color: 'var(--text-muted)', border: '1px solid rgba(148, 163, 184, 0.3)' }
        }
    }

    const containerStyle: React.CSSProperties = {
        direction: locale === 'ar' ? 'rtl' : 'ltr',
        textAlign: locale === 'ar' ? 'right' : 'left'
    }

    return (
        <div style={containerStyle}>
            <div className="space-y-6 animate-in fade-in duration-500">
                {/* Header Row */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '1rem' }}>
                    <Link
                        href={`/dashboard/clients/${clientId}?name=${encodeURIComponent(urlClientName || '')}`}
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
                            border: '1px solid var(--veil-40)',
                            transform: `translateY(-2px)${locale === 'ar' ? ' scaleX(-1)' : ''}`
                        }}
                        title={t('back_to_sections' as any)}
                    >
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                            <line x1="19" y1="12" x2="5" y2="12"></line>
                            <polyline points="12 19 5 12 12 5"></polyline>
                        </svg>
                    </Link>
                    <h1 className="text-3xl font-bold text-slate-800 tracking-tight">{t('notes_label' as any)}</h1>
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
                    placeholder={locale === 'ar' ? 'بحث في الملاحظات أو المنشئ' : 'Search Note Content or Creator'}
                    totalCount={total}
                    primaryAction={
                        <button
                            onClick={() => {
                                setPendingFiles([])
                                setIsModalOpen(true)
                            }}
                            className="btn btn-primary"
                            style={{ height: '48px', display: 'flex', alignItems: 'center', borderRadius: '1.25rem' }}
                        >
                            {t('add_note_button' as any)}
                        </button>
                    }
                />

                {isLoading ? (
                    <LoadingSpinner />
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
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.625rem' }}>
                        {filteredNotes.map((note, index) => (
                            <div
                                id={`note-${note.id}`}
                                key={note.id}
                                className={`glass-card group flex flex-col hover:shadow-xl transition-all duration-300 ${visualHighlightId === note.id ? 'highlight-pulse' : ''}`}
                                style={{
                                    animationDelay: `${index * 50}ms`,
                                    padding: '1.5rem',
                                    display: 'flex',
                                    flexDirection: 'column',
                                    marginBottom: '0.25rem',
                                    borderRadius: '1.5rem',
                                    background: visualHighlightId === note.id ? 'var(--highlight-tint)' : '',
                                    borderInlineStart: visualHighlightId === note.id ? '4px solid var(--accent-solid)' : ''
                                }}
                            >
                                {/* Header: User & Role */}
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1rem' }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                                        <div style={{
                                            width: '36px',
                                            height: '36px',
                                            borderRadius: '50%',
                                            background: 'var(--primary)',
                                            color: 'var(--text-on-accent)',
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                            fontSize: '0.8rem',
                                            fontWeight: 'bold',
                                            boxShadow: '0 2px 4px var(--shadow-weak)'
                                        }}>
                                            {note.createdBy?.firstName?.[0]}{note.createdBy?.lastName?.[0]}
                                        </div>
                                        <div style={{ display: 'flex', flexDirection: 'column' }}>
                                            <span style={{ fontSize: '0.9rem', fontWeight: '700', color: 'var(--text-main)', lineHeight: '1.2' }}>
                                                {note.createdBy ? `${note.createdBy.firstName} ${note.createdBy.lastName}` : 'System'}
                                            </span>
                                            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                                                {new Date(note.createdAt).toLocaleDateString(locale === 'ar' ? 'ar-EG' : 'en-GB', { day: 'numeric', month: 'short' })}
                                            </span>
                                        </div>
                                    </div>
                                    <div
                                        style={{
                                            ...getRoleStyles(note.createdBy?.role || ''),
                                            padding: '0.2rem 0.6rem',
                                            borderRadius: '0.75rem',
                                            fontSize: '0.65rem',
                                            fontWeight: '800',
                                            textTransform: 'uppercase',
                                            letterSpacing: '0.025em'
                                        }}
                                    >
                                        {t(`role_${(note.createdBy?.role || 'USER').toLowerCase()}` as any) || (note.createdBy?.role || 'USER').replace(/_/g, ' ')}
                                    </div>
                                </div>

                                {/* Content */}
                                <div style={{ flexGrow: 1, marginBottom: '1.25rem' }}>
                                    <p style={{
                                        fontSize: '0.95rem',
                                        color: 'var(--text-body)',
                                        lineHeight: '1.6',
                                        margin: 0,
                                        display: '-webkit-box',
                                        WebkitLineClamp: 4,
                                        WebkitBoxOrient: 'vertical',
                                        overflow: 'hidden',
                                        transition: 'all 0.3s ease'
                                    }} className="group-hover:line-clamp-none">
                                        {note.content}
                                    </p>
                                </div>

                                {/* Divider */}
                                <div style={{ height: '1px', width: '100%', background: 'rgba(226, 232, 240, 0.5)', marginBottom: '1rem' }} />

                                {/* Footer Actions */}
                                <div style={{ display: 'flex', flexDirection: 'column', marginTop: 'auto' }}>
                                    <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.5rem' }}>
                                        {getNoteAttachments(note.attachment).map((att, i) => {
                                            const url = typeof att === 'string' ? att : att.url
                                            const name = typeof att === 'string' ? url.split('/').pop() : att.name
                                            return (
                                                <a
                                                    key={i}
                                                    href={url}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    className="hover:scale-110 transition-transform"
                                                    style={{
                                                        color: 'var(--primary)',
                                                        display: 'flex',
                                                        alignItems: 'center',
                                                        gap: '0.25rem',
                                                        background: 'rgba(56, 189, 248, 0.1)',
                                                        padding: '0.25rem 0.5rem',
                                                        borderRadius: '0.5rem',
                                                        textDecoration: 'none',
                                                        fontSize: '0.75rem'
                                                    }}
                                                    title={name}
                                                >
                                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                                                        <path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48"></path>
                                                    </svg>
                                                    <span style={{ maxWidth: '100px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</span>
                                                </a>
                                            )
                                        })}
                                    </div>

                                    <div style={{
                                        fontSize: '0.75rem',
                                        color: 'var(--text-faint)',
                                        display: 'flex',
                                        flexDirection: 'column',
                                        gap: '0.25rem',
                                        marginTop: '0.75rem',
                                        paddingTop: '0.75rem',
                                        borderTop: '1px dashed var(--surface-sunk)',
                                        width: '100%',
                                        position: 'relative'
                                    }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap' }}>
                                            <span style={{
                                                padding: '0.15rem 0.4rem',
                                                background: 'var(--surface-sunk)',
                                                borderRadius: '0.4rem',
                                                fontWeight: '700',
                                                fontSize: '0.65rem',
                                                color: 'var(--text-soft)'
                                            }}>
                                                {(note.createdBy?.role || 'SYSTEM').replace(/_/g, ' ')}
                                            </span>
                                            <span>
                                                {t('created_by' as any) || 'Created by'} {note.createdBy ? `${note.createdBy.firstName} ${note.createdBy.lastName}` : 'System'} {t('at' as any) || 'at'} {new Date(note.createdAt).toLocaleDateString(locale === 'ar' ? 'ar-EG' : 'en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) + ', ' + new Date(note.createdAt).toLocaleTimeString(locale === 'ar' ? 'ar-EG' : 'en-US', { hour: 'numeric', minute: '2-digit', hour12: true })}
                                            </span>
                                        </div>
                                        {note.lastEditedBy && (
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap' }}>
                                                <span style={{
                                                    padding: '0.15rem 0.4rem',
                                                    background: 'var(--info-bg-sky)',
                                                    borderRadius: '0.4rem',
                                                    fontWeight: '700',
                                                    fontSize: '0.65rem',
                                                    color: 'var(--info-solid-sky)'
                                                }}>
                                                    {(note.lastEditedBy.role || 'SYSTEM').replace(/_/g, ' ')}
                                                </span>
                                                <span style={{ color: 'var(--info-solid-sky)' }}>
                                                    {t('updated_by' as any) || 'Updated by'} {note.lastEditedBy.firstName} {note.lastEditedBy.lastName} {t('at' as any) || 'at'} {note.lastEditedAt ? new Date(note.lastEditedAt).toLocaleDateString(locale === 'ar' ? 'ar-EG' : 'en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) + ', ' + new Date(note.lastEditedAt).toLocaleTimeString(locale === 'ar' ? 'ar-EG' : 'en-US', { hour: 'numeric', minute: '2-digit', hour12: true }) : ''}
                                                </span>
                                            </div>
                                        )}

                                        <div style={{ display: 'flex', gap: '0.75rem', position: 'absolute', bottom: '0', [locale === 'ar' ? 'left' : 'right']: '0' }}>
                                            {canEdit && (
                                                <button
                                                    onClick={() => {
                                                        setEditingNote(note)
                                                        setEditNoteContent(note.content)
                                                        const date = note.expiryDate ? new Date(note.expiryDate) : null
                                                        setEditExpiryDate(date && !isNaN(date.getTime()) ? date.toISOString().split('T')[0] : '')
                                                        setEditReminderDays(note.reminderDays ? note.reminderDays.toString() : '')
                                                        setEditExistingAttachments(getNoteAttachments(note.attachment))
                                                        setPendingFiles([])
                                                        setIsEditModalOpen(true)
                                                    }}
                                                    style={{ padding: '0.4rem', color: 'var(--text-soft)', background: 'none', border: 'none', cursor: 'pointer' }}
                                                    className="hover:text-blue-500 transition-colors"
                                                >
                                                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
                                                </button>
                                            )}
                                            {canDelete && (
                                                <button
                                                    onClick={() => setDeleteConfirm({ isOpen: true, note })}
                                                    style={{ padding: '0.4rem', color: 'var(--text-soft)', background: 'none', border: 'none', cursor: 'pointer' }}
                                                    className="hover:text-red-500 transition-colors"
                                                >
                                                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>
                                                </button>
                                            )}
                                        </div>
                                    </div>
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

                {/* Create Note Modal - Portal */}
                {
                    isModalOpen && createPortal(
                        <div style={{
                            position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
                            background: 'var(--scrim)', display: 'flex', justifyContent: 'center',
                            alignItems: 'center', zIndex: 9999
                        }}>
                            <div
                                className="absolute inset-0"
                                onClick={() => !isSubmitting && setIsModalOpen(false)}
                            />
                            <div style={{
                                background: 'var(--surface)',
                                padding: '2rem',
                                borderRadius: '1.5rem',
                                width: '95%',
                                maxWidth: '550px',
                                maxHeight: '90vh',
                                overflowY: 'auto',
                                position: 'relative',
                                zIndex: 10,
                                direction: locale === 'ar' ? 'rtl' : 'ltr',
                                boxShadow: '0 25px 50px -12px var(--shadow-mid)',
                                border: '1px solid var(--veil-40)'
                            }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
                                    <h2 style={{ fontSize: '1.5rem', fontWeight: 'bold', color: 'var(--text-main)', margin: 0 }}>{t('add_note_button' as any)}</h2>
                                    <span style={{ fontSize: '0.75rem', color: newNoteContent.length > MAX_CHARS ? 'var(--danger-solid)' : 'var(--text-soft)' }}>
                                        {newNoteContent.length}/{MAX_CHARS}
                                    </span>
                                </div>
                                <form onSubmit={handleCreateNote}>
                                    <div style={{ marginBottom: '1.5rem' }}>
                                        <label style={{ display: 'block', fontSize: '0.875rem', marginBottom: '0.5rem', color: 'var(--text-soft)', textAlign: locale === 'ar' ? 'right' : 'left' }}>
                                            {t('note_content_label' as any)}
                                        </label>
                                        <textarea
                                            value={newNoteContent}
                                            onChange={(e) => setNewNoteContent(e.target.value)}
                                            className="input"
                                            style={{
                                                width: '100%',
                                                padding: '0.75rem',
                                                border: `1px solid ${newNoteContent.length > MAX_CHARS ? 'var(--danger-solid)' : 'var(--border)'}`,
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
                                            <p style={{ color: 'var(--danger-solid)', fontSize: '0.75rem', marginTop: '0.5rem' }}>
                                                {t('note_limit_exceeded' as any)}
                                            </p>
                                        )}
                                    </div>

                                    <div style={{ marginBottom: '1.5rem' }}>
                                        <label style={{ display: 'block', fontSize: '0.875rem', marginBottom: '0.75rem', color: 'var(--text-soft)', textAlign: locale === 'ar' ? 'right' : 'left' }}>
                                            {t('attachment_label' as any)}
                                        </label>
                                        <div
                                            onDragOver={e => { e.preventDefault(); setIsDragging(true); }}
                                            onDragLeave={() => setIsDragging(false)}
                                            onDrop={e => { e.preventDefault(); setIsDragging(false); if (e.dataTransfer.files.length) handleFiles(Array.from(e.dataTransfer.files)); }}
                                            style={{ border: `2px dashed ${isDragging ? 'var(--info-solid)' : 'var(--border-firm)'}`, borderRadius: '0.75rem', padding: '1.5rem', textAlign: 'center', background: isDragging ? 'var(--info-bg-subtle)' : 'var(--surface-subtle)', transition: 'all 0.2s', cursor: 'pointer', position: 'relative' }}
                                        >
                                            <input
                                                type="file"
                                                multiple
                                                accept=".jpg,.jpeg,.png,.gif,.webp,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx"
                                                onChange={e => { if (e.target.files) { handleFiles(Array.from(e.target.files)); e.target.value = ''; } }}
                                                style={{ opacity: 0, position: 'absolute', inset: 0, cursor: 'pointer' }}
                                                disabled={uploading}
                                            />
                                            <div style={{ pointerEvents: 'none' }}>
                                                <div style={{ fontSize: '1.5rem', marginBottom: '0.25rem' }}>☁️</div>
                                                <div style={{ fontSize: '0.85rem', fontWeight: '600', color: 'var(--text-muted)' }}>{t('upload_drag_files_msg')}</div>
                                            </div>
                                        </div>

                                        {pendingFiles.length > 0 && (
                                            <div style={{ marginTop: '0.75rem', display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                                                {pendingFiles.map((f, i) => (
                                                    <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.5rem 0.75rem', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '0.5rem' }}>
                                                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', overflow: 'hidden' }}>
                                                            <span style={{ fontSize: '1rem' }}>📄</span>
                                                            <div style={{ fontSize: '0.75rem', fontWeight: '500', color: 'var(--text-main)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{f.name}</div>
                                                        </div>
                                                        <button type="button" onClick={() => removePendingFile(i)} style={{ color: 'var(--danger-solid)', background: 'none', border: 'none', cursor: 'pointer', fontSize: '1rem', fontWeight: 'bold' }}>×</button>
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                    </div>

                                    <div style={{ display: 'flex', gap: '1rem', marginBottom: '1.5rem' }}>
                                        <div style={{ flex: 1 }}>
                                            <DatePickerSingle
                                                label={t('expiry_date_label' as any)}
                                                value={expiryDate}
                                                onChange={setExpiryDate}
                                                minDate={new Date().toISOString().split('T')[0]}
                                            />
                                        </div>
                                        <div style={{ flex: 1 }}>
                                            <label style={{ display: 'block', fontSize: '0.875rem', marginBottom: '0.5rem', color: 'var(--text-soft)', textAlign: locale === 'ar' ? 'right' : 'left' }}>
                                                {t('reminder_days_label' as any)}
                                            </label>
                                            <input
                                                type="number"
                                                value={reminderDays}
                                                onChange={(e) => setReminderDays(e.target.value)}
                                                placeholder={t('days_label')}
                                                min="1"
                                                className="input"
                                                style={{ width: '100%', padding: '0 1rem', borderRadius: '1.25rem', height: '48px', textAlign: locale === 'ar' ? 'right' : 'left' }}
                                            />
                                        </div>
                                    </div>
                                    <div style={{ display: 'flex', gap: '1rem', justifyContent: 'flex-end' }}>
                                        <button
                                            type="button"
                                            onClick={() => {
                                                setPendingFiles([])
                                                setIsModalOpen(false)
                                            }}
                                            style={{ padding: '0.75rem 1.5rem', border: '1px solid var(--border)', borderRadius: '0.5rem', background: 'transparent', cursor: 'pointer' }}
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
                    )
                }

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
                            } catch {
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
                    hideFooter={true}
                >
                    <form onSubmit={handleEditSection} style={{ direction: locale === 'ar' ? 'rtl' : 'ltr' }}>
                        <div style={{ marginBottom: '1.5rem' }}>
                            <label style={{ display: 'block', fontSize: '0.875rem', marginBottom: '0.5rem', color: 'var(--text-soft)', textAlign: locale === 'ar' ? 'right' : 'left' }}>
                                {t('section_title_label' as any)}
                            </label>
                            <input
                                type="text"
                                value={editSectionTitle}
                                onChange={(e) => setEditSectionTitle(e.target.value)}
                                className="input"
                                style={{ width: '100%', padding: '0.5rem', border: '1px solid var(--border)', borderRadius: '0.5rem', textAlign: locale === 'ar' ? 'right' : 'left' }}
                                placeholder={t('section_title_placeholder' as any)}
                                autoFocus
                            />
                        </div>

                        <div style={{ display: 'flex', gap: '1rem', justifyContent: 'flex-end' }}>
                            <button
                                type="button"
                                onClick={() => setIsEditSectionModalOpen(false)}
                                className="btn"
                                style={{ background: 'var(--surface-sunk)' }}
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
                {
                    isEditModalOpen && createPortal(
                        <div style={{
                            position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
                            background: 'var(--scrim)', display: 'flex', justifyContent: 'center',
                            alignItems: 'center', zIndex: 9999
                        }}>
                            <div
                                className="absolute inset-0"
                                onClick={() => !isSubmitting && setIsEditModalOpen(false)}
                            />
                            <div style={{
                                background: 'var(--surface)',
                                padding: '2rem',
                                borderRadius: '1.5rem',
                                width: '95%',
                                maxWidth: '550px',
                                maxHeight: '90vh',
                                overflowY: 'auto',
                                position: 'relative',
                                zIndex: 10,
                                direction: locale === 'ar' ? 'rtl' : 'ltr',
                                boxShadow: '0 25px 50px -12px var(--shadow-mid)',
                                border: '1px solid var(--veil-40)'
                            }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
                                    <h2 style={{ fontSize: '1.5rem', fontWeight: 'bold', color: 'var(--text-main)', margin: 0 }}>{t('edit_note_title' as any) || 'Edit Note'}</h2>
                                    <span style={{ fontSize: '0.75rem', color: editNoteContent.length > MAX_CHARS ? 'var(--danger-solid)' : 'var(--text-soft)' }}>
                                        {editNoteContent.length}/{MAX_CHARS}
                                    </span>
                                </div>
                                <form onSubmit={handleUpdateNote}>
                                    <div style={{ marginBottom: '1.5rem' }}>
                                        <label style={{ display: 'block', fontSize: '0.875rem', marginBottom: '0.5rem', color: 'var(--text-soft)', textAlign: locale === 'ar' ? 'right' : 'left' }}>
                                            {t('note_content_label' as any)}
                                        </label>
                                        <textarea
                                            value={editNoteContent}
                                            onChange={(e) => setEditNoteContent(e.target.value)}
                                            className="input"
                                            style={{
                                                width: '100%',
                                                padding: '0.75rem',
                                                border: `1px solid ${editNoteContent.length > MAX_CHARS ? 'var(--danger-solid)' : 'var(--border)'}`,
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
                                            <p style={{ color: 'var(--danger-solid)', fontSize: '0.75rem', marginTop: '0.5rem' }}>
                                                {t('note_limit_exceeded' as any)}
                                            </p>
                                        )}
                                    </div>

                                    <div style={{ marginBottom: '1.5rem' }}>
                                        <label style={{ display: 'block', fontSize: '0.875rem', marginBottom: '0.75rem', color: 'var(--text-soft)', textAlign: locale === 'ar' ? 'right' : 'left' }}>
                                            {t('attachment_label' as any)}
                                        </label>

                                        {/* Existing Attachments */}
                                        {editExistingAttachments.length > 0 && (
                                            <div style={{ marginBottom: '1rem', display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                                                {editExistingAttachments.map((url, i) => {
                                                    if (!url) return null;
                                                    return (
                                                        <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.5rem 0.75rem', background: 'var(--surface-subtle)', border: '1px solid var(--border)', borderRadius: '0.5rem' }}>
                                                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', overflow: 'hidden' }}>
                                                                <span style={{ fontSize: '1rem' }}>🔗</span>
                                                                <div style={{ fontSize: '0.75rem', fontWeight: '500', color: 'var(--info-fg)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                                                    {typeof url === 'string' ? url.split('/').pop() : url.name}
                                                                </div>
                                                            </div>
                                                            <button type="button" onClick={() => handleRemoveExistingAttachment(url)} style={{ color: 'var(--danger-solid)', background: 'none', border: 'none', cursor: 'pointer', fontSize: '1rem', fontWeight: 'bold' }}>×</button>
                                                        </div>
                                                    )
                                                })}
                                            </div>
                                        )}

                                        <div
                                            onDragOver={e => { e.preventDefault(); setIsDragging(true); }}
                                            onDragLeave={() => setIsDragging(false)}
                                            onDrop={e => { e.preventDefault(); setIsDragging(false); if (e.dataTransfer.files.length) handleFiles(Array.from(e.dataTransfer.files)); }}
                                            style={{ border: `2px dashed ${isDragging ? 'var(--info-solid)' : 'var(--border-firm)'}`, borderRadius: '0.75rem', padding: '1.5rem', textAlign: 'center', background: isDragging ? 'var(--info-bg-subtle)' : 'var(--surface-subtle)', transition: 'all 0.2s', cursor: 'pointer', position: 'relative' }}
                                        >
                                            <input
                                                type="file"
                                                multiple
                                                accept=".jpg,.jpeg,.png,.gif,.webp,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx"
                                                onChange={e => { if (e.target.files) { handleFiles(Array.from(e.target.files)); e.target.value = ''; } }}
                                                style={{ opacity: 0, position: 'absolute', inset: 0, cursor: 'pointer' }}
                                                disabled={uploading}
                                            />
                                            <div style={{ pointerEvents: 'none' }}>
                                                <div style={{ fontSize: '1.5rem', marginBottom: '0.25rem' }}>☁️</div>
                                                <div style={{ fontSize: '0.85rem', fontWeight: '600', color: 'var(--text-muted)' }}>{t('upload_drag_files_msg')}</div>
                                            </div>
                                        </div>

                                        {pendingFiles.length > 0 && (
                                            <div style={{ marginTop: '0.75rem', display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                                                {pendingFiles.map((f, i) => (
                                                    <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.5rem 0.75rem', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '0.5rem' }}>
                                                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', overflow: 'hidden' }}>
                                                            <span style={{ fontSize: '1rem' }}>📄</span>
                                                            <div style={{ fontSize: '0.75rem', fontWeight: '500', color: 'var(--text-main)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{f.name}</div>
                                                        </div>
                                                        <button type="button" onClick={() => removePendingFile(i)} style={{ color: 'var(--danger-solid)', background: 'none', border: 'none', cursor: 'pointer', fontSize: '1rem', fontWeight: 'bold' }}>×</button>
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                    </div>

                                    <div style={{ display: 'flex', gap: '1rem', marginBottom: '1.5rem' }}>
                                        <div style={{ flex: 1 }}>
                                            <DatePickerSingle
                                                label={t('expiry_date_label' as any)}
                                                value={editExpiryDate}
                                                onChange={setEditExpiryDate}
                                                minDate={new Date().toISOString().split('T')[0]}
                                            />
                                        </div>
                                        <div style={{ flex: 1 }}>
                                            <label style={{ display: 'block', fontSize: '0.875rem', marginBottom: '0.5rem', color: 'var(--text-soft)', textAlign: locale === 'ar' ? 'right' : 'left' }}>
                                                {t('reminder_days_label' as any)}
                                            </label>
                                            <input
                                                type="number"
                                                value={editReminderDays}
                                                onChange={(e) => setEditReminderDays(e.target.value)}
                                                placeholder={t('days_label')}
                                                min="1"
                                                className="input"
                                                style={{ width: '100%', padding: '0 1rem', borderRadius: '1.25rem', height: '48px', textAlign: locale === 'ar' ? 'right' : 'left' }}
                                            />
                                        </div>
                                    </div>
                                    <div style={{ display: 'flex', gap: '1rem', justifyContent: 'flex-end' }}>
                                        <button
                                            type="button"
                                            onClick={() => {
                                                setPendingFiles([])
                                                setIsEditModalOpen(false)
                                            }}
                                            style={{ padding: '0.75rem 1.5rem', border: '1px solid var(--border)', borderRadius: '0.5rem', background: 'transparent', cursor: 'pointer' }}
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
                    )
                }
            </div>
        </div>
    )
}

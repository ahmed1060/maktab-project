'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { useHeader } from '@/context/HeaderContext'
import { createPortal } from 'react-dom'
import Image from 'next/image'
import ConfirmModal from '@/components/ConfirmModal'
import { useLanguage } from '@/context/LanguageContext'
import { useSession } from 'next-auth/react'
import { useToast } from '@/context/ToastContext'
import Modal from '@/components/Modal'

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

    // New Fields
    const [expiryDate, setExpiryDate] = useState('')
    const [reminderDays, setReminderDays] = useState('')
    const [selectedFile, setSelectedFile] = useState<File | null>(null)
    const [uploading, setUploading] = useState(false)

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
                const sectionsData = await sectionsRes.json()
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
            } else {
                const err = await res.json()
                alert(`${t('failed_save_generic')}: ${err.error}`)
            }
        } catch (error) {
            console.error('Failed to create note', error)
            alert(t('failed_save_generic'))
        } finally {
            setIsSubmitting(false)
            setUploading(false)
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
                            marginBottom: '0.75rem',
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
                        title={t('back_to_sections' as any)}
                    >
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                            <line x1="19" y1="12" x2="5" y2="12"></line>
                            <polyline points="12 19 5 12 12 5"></polyline>
                        </svg>
                    </Link>
                    <div style={{ clear: 'both' }}></div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                            <h1 className="text-3xl font-bold text-slate-800 tracking-tight">{t('notes_label' as any)}</h1>
                            {canEdit && section && (
                                <button
                                    onClick={() => {
                                        setEditSectionTitle(section.title)
                                        setIsEditSectionModalOpen(true)
                                    }}
                                    className="btn"
                                    style={{
                                        background: '#dbeafe',
                                        color: '#1e40af',
                                        padding: '0.5rem 1rem',
                                        fontSize: '0.875rem',
                                        marginLeft: locale === 'ar' ? '0' : '0.5rem',
                                        marginRight: locale === 'ar' ? '0.5rem' : '0',
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '0.25rem'
                                    }}
                                >
                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                                        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                                        <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                                    </svg>
                                    {t('edit')}
                                </button>
                            )}
                        </div>
                        <button
                            onClick={() => setIsModalOpen(true)}
                            className="btn btn-primary"
                        >
                            {t('add_note_button' as any)}
                        </button>
                    </div>
                </div>

                {isLoading ? (
                    <div className="text-center py-10 text-slate-500">{t('loading_filters')}</div>
                ) : notes.length === 0 ? (
                    <div className="glass-card flex flex-col items-center justify-center py-12 text-center text-slate-500">
                        <span className="text-4xl mb-2">📝</span>
                        <h3 className="text-lg font-bold text-slate-800">{t('no_notes_found' as any)}</h3>
                        <p className="max-w-xs mx-auto mt-1 mb-4">
                            {t('start_documenting_msg' as any)}
                        </p>
                    </div>
                ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                        {notes.map((note, index) => (
                            <div
                                key={note.id}
                                className="glass-card hover:bg-white/60 transition-all duration-300 p-6 border border-white/40 shadow-sm relative overflow-hidden"
                                style={{
                                    animationDelay: `${index * 50}ms`,
                                    marginBottom: '0.5rem',
                                    textAlign: locale === 'ar' ? 'right' : 'left'
                                }}
                            >
                                {/* Note Content at the top */}
                                <div className="text-slate-700 whitespace-pre-wrap mb-3" style={{ fontSize: '0.9rem', lineHeight: '1.6' }}>
                                    {note.content}
                                </div>

                                {/* Render Attachment and Expiry if they exist */}
                                {(note.attachment || note.expiryDate) && (
                                    <div style={{ display: 'flex', gap: '1rem', marginBottom: '1rem', fontSize: '0.8rem', color: '#64748b', alignItems: 'center', flexWrap: 'wrap' }}>
                                        {note.attachment && (
                                            <a href={note.attachment} target="_blank" rel="noopener noreferrer" className="hover:underline" style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', color: '#4f46e5', fontWeight: '600', textDecoration: 'none' }}>
                                                <span>📎</span>
                                                {t('attachment_label' as any)}
                                            </a>
                                        )}
                                        {note.expiryDate && (
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                                                <span>📅</span>
                                                {t('expires_label' as any)}: {new Date(note.expiryDate).toLocaleDateString(locale === 'ar' ? 'ar-EG' : 'en-GB')}
                                                {note.reminderDays && note.reminderDays > 0 && (
                                                    <span style={{ [locale === 'ar' ? 'marginRight' : 'marginLeft']: '0.25rem' }}>({t('reminder_label' as any)}: {note.reminderDays}{t('days_label').split('')[0]} {t('by').split('')[0]} {t('deadline_label').split('')[0]})</span>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                )}

                                {/* Author info and Delete button at the bottom */}
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                    <div className="flex items-center gap-2">
                                        <div className="w-8 h-8 rounded-full bg-indigo-100 flex items-center justify-center text-indigo-700 font-bold text-[10px] uppercase shrink-0 px-1 overflow-hidden" title={note.createdBy?.role}>
                                            {note.createdBy?.avatar ? (
                                                <Image
                                                    src={note.createdBy.avatar}
                                                    alt="Avatar"
                                                    width={32}
                                                    height={32}
                                                    className="w-full h-full rounded-full object-cover"
                                                />
                                            ) : (
                                                <span style={{ fontSize: (note.createdBy?.role?.length || 0) > 10 ? '8px' : '9px', textAlign: 'center' }}>
                                                    {note.createdBy?.role?.replace('_', ' ')}
                                                </span>
                                            )}
                                        </div>
                                        <div className="text-sm" style={{ textAlign: locale === 'ar' ? 'right' : 'left' }}>
                                            <span className="font-semibold text-slate-800">
                                                {note.createdBy?.firstName} {note.createdBy?.lastName}
                                            </span>
                                            <span className="text-slate-400" style={{ margin: '0 0.5rem' }}>•</span>
                                            <span className="text-slate-500">
                                                {new Date(note.createdAt).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })} - {new Date(note.createdAt).toLocaleDateString(locale === 'ar' ? 'ar-EG' : 'en-GB')}
                                            </span>
                                        </div>
                                    </div>
                                    <button
                                        onClick={() => {
                                            setDeleteConfirm({ isOpen: true, note })
                                        }}
                                        className="btn"
                                        style={{
                                            background: '#fee2e2',
                                            color: '#b91c1c',
                                            padding: '0.5rem 1rem',
                                            fontSize: '0.875rem',
                                            border: 'none',
                                            cursor: 'pointer',
                                            flexShrink: 0
                                        }}
                                    >
                                        {t('delete')}
                                    </button>
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
                                    onChange={(e) => setSelectedFile(e.target.files?.[0] || null)}
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
        </div>
    )
}

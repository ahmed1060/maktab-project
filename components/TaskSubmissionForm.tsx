'use client'
import { useState } from 'react'
import { useLanguage } from '@/context/LanguageContext'

// F-23: extracted verbatim out of tasks/[id]/client.tsx. `isDragging` is
// local (only ever read by this dropzone's own border style), but every
// other piece of state here — pendingFiles, cost/costDescription,
// costEntries, note, capturingLocation/locationStatus, uploading/loadingType
// — is also read by handlers that live in the parent (handleUpload,
// handleAddCost, handleUploadRequest, handleCaptureLocation, and the
// suspend-save effect), so those stay in the parent and get threaded
// through as props.
interface TaskSubmissionFormProps {
    pendingFiles: File[]
    onAddFiles: (files: File[]) => void
    onRemoveFile: (index: number) => void
    uploading: boolean
    costDescription: string
    setCostDescription: (v: string) => void
    cost: string
    setCost: (v: string) => void
    onAddCost: () => void
    costEntries: any[]
    onRemoveCostEntry: (index: number) => void
    note: string
    setNote: (v: string) => void
    capturingLocation: boolean
    locationStatus: string
    onCaptureLocation: () => void
    onSaveDraft: () => void
    onSubmitRequest: () => void
    loadingType: 'DRAFT' | 'SUBMIT' | null
}

export default function TaskSubmissionForm({
    pendingFiles, onAddFiles, onRemoveFile, uploading,
    costDescription, setCostDescription, cost, setCost, onAddCost, costEntries, onRemoveCostEntry,
    note, setNote,
    capturingLocation, locationStatus, onCaptureLocation,
    onSaveDraft, onSubmitRequest, loadingType
}: TaskSubmissionFormProps) {
    const { t, locale } = useLanguage()
    const [isDragging, setIsDragging] = useState(false)

    return (
        <div style={{ marginTop: '3rem', borderTop: '2px solid #e2e8f0', paddingTop: '2rem' }}>
            <h3 style={{ marginBottom: '1.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem', flexDirection: 'row' }}>
                <span>📤</span> {t('submit_task_title')}
            </h3>

            <div style={{ marginBottom: '1.5rem' }}>
                <label style={{ display: 'block', fontWeight: '600', marginBottom: '0.75rem' }}>{t('attachments_optional_label')}</label>
                <div
                    onDragOver={e => { e.preventDefault(); setIsDragging(true); }}
                    onDragLeave={() => setIsDragging(false)}
                    onDrop={e => { e.preventDefault(); setIsDragging(false); if (e.dataTransfer.files.length) onAddFiles(Array.from(e.dataTransfer.files)); }}
                    style={{ border: `2px dashed ${isDragging ? '#3b82f6' : '#cbd5e1'}`, borderRadius: '0.75rem', padding: '2.5rem', textAlign: 'center', background: isDragging ? '#eff6ff' : '#f8fafc', transition: 'all 0.2s', cursor: 'pointer', position: 'relative' }}
                >
                    <input
                        type="file"
                        multiple
                        accept=".jpg,.jpeg,.png,.gif,.webp,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx"
                        onChange={e => {
                            if (e.target.files) {
                                onAddFiles(Array.from(e.target.files))
                                // Reset input so the same file can be selected again if removed
                                e.target.value = ''
                            }
                        }}
                        style={{ opacity: 0, position: 'absolute', inset: 0, cursor: 'pointer' }}
                        disabled={uploading}
                    />
                    <div style={{ pointerEvents: 'none' }}>
                        <div style={{ fontSize: '2.5rem', marginBottom: '0.5rem' }}>☁️</div>
                        <div style={{ fontWeight: '600', color: '#475569' }}>{t('upload_drag_files_msg')}</div>
                        <div style={{ fontSize: '0.8rem', color: '#94a3b8', marginTop: '0.25rem' }}>{t('upload_allowed_types_msg')}</div>
                    </div>
                </div>

                {pendingFiles.length > 0 && (
                    <div style={{ marginTop: '1rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                        {pendingFiles.map((f, i) => (
                            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.75rem 1rem', background: 'white', border: '1px solid #e2e8f0', borderRadius: '0.5rem', flexDirection: 'row' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexDirection: 'row' }}>
                                    <span style={{ fontSize: '1.25rem' }}>📄</span>
                                    <div style={{ textAlign: locale === 'ar' ? 'right' : 'left' }}>
                                        <div style={{ fontSize: '0.9rem', fontWeight: '500' }}>{f.name}</div>
                                        <div style={{ fontSize: '0.7rem', color: '#94a3b8' }}>{(f.size / 1024 / 1024).toFixed(2)} MB</div>
                                    </div>
                                </div>
                                <button onClick={() => onRemoveFile(i)} style={{ color: '#ef4444', background: '#fef2f2', border: 'none', borderRadius: '0.375rem', padding: '0.4rem 0.75rem', cursor: 'pointer', fontSize: '0.8rem', fontWeight: '600' }}>{t('delete')}</button>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            <div style={{ marginBottom: '1.5rem' }}>
                <label style={{ display: 'block', fontWeight: '600', marginBottom: '0.75rem' }}>{t('add_costs_label')}</label>
                <div style={{ display: 'flex', gap: '0.5rem', flexDirection: 'row' }}>
                    <input type="text" className="input" placeholder={t('cost_description_placeholder')} value={costDescription} onChange={e => setCostDescription(e.target.value)} style={{ flex: 1 }} />
                    <input type="number" className="input" placeholder={t('cost_amount_placeholder')} value={cost} onChange={e => setCost(e.target.value)} style={{ width: '120px' }} />
                    <button onClick={onAddCost} disabled={!cost} className="btn" style={{ background: '#e2e8f0', color: '#0369a1', fontWeight: '700', minWidth: '80px', opacity: 1, cursor: 'pointer' }}>{t('add_label')}</button>
                </div>
                {costEntries.length > 0 && (
                    <div style={{ marginTop: '1rem', background: 'white', border: '1px solid #e2e8f0', borderRadius: '0.5rem', overflow: 'hidden' }}>
                        {costEntries.map((e, i) => (
                            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.75rem 1rem', borderBottom: i < costEntries.length - 1 ? '1px solid #f1f5f9' : 'none', flexDirection: 'row' }}>
                                <div style={{ display: 'flex', gap: '0.5rem', fontWeight: '500', flexDirection: 'row' }}>
                                    <span>{e.description || t('no_description')}</span>
                                    <span style={{ color: '#94a3b8' }}>•</span>
                                    <span style={{ color: '#b45309' }}>{e.amount.toFixed(2)} {t('egp')}</span>
                                </div>
                                <button onClick={() => onRemoveCostEntry(i)} style={{ color: '#ef4444', padding: '0.25rem', cursor: 'pointer', border: 'none', background: 'none', fontWeight: 'bold', fontSize: '1.2rem' }}>×</button>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            <div style={{ marginBottom: '1.5rem' }}>
                <label style={{ display: 'block', fontWeight: '600', marginBottom: '0.75rem' }}>{t('note_optional_label')}</label>
                <textarea className="input" rows={3} placeholder={t('note_placeholder')} value={note} onChange={e => setNote(e.target.value)} style={{ width: '100%', resize: 'none' }} maxLength={500} />
                <div style={{ textAlign: locale === 'ar' ? 'left' : 'right', fontSize: '0.75rem', color: note.length >= 500 ? '#ef4444' : '#94a3b8', marginTop: '0.25rem' }}>{note.length}/500</div>
            </div>

            <div style={{ marginBottom: '2rem' }}>
                <label style={{ display: 'block', fontWeight: '600', marginBottom: '0.75rem' }}>{t('current_location_label')}</label>
                <div style={{ display: 'flex', gap: '1rem', alignItems: 'center', flexDirection: 'row' }}>
                    <button onClick={onCaptureLocation} disabled={capturingLocation || uploading} className="btn" style={{ background: capturingLocation ? '#e2e8f0' : '#3b82f6', color: capturingLocation ? '#64748b' : 'white', fontWeight: '600', display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
                        {capturingLocation ? t('capturing_location_button').replace('📍', '') : t('capture_location_button').replace('📍', '')}
                    </button>
                    <span style={{ fontSize: '0.875rem', fontWeight: '500', color: locationStatus.includes('✓') ? '#16a34a' : locationStatus.includes('Failed') ? '#dc2626' : '#64748b' }}>{locationStatus}</span>
                </div>
            </div>

            <div style={{ display: 'flex', gap: '1rem', flexDirection: 'row' }}>
                <button onClick={onSaveDraft} disabled={uploading} className="btn" style={{ background: '#e2e8f0', color: '#1e293b', fontWeight: '600', flex: 1, opacity: 1, cursor: 'pointer' }}>{loadingType === 'DRAFT' ? t('saving') : t('save_draft_button')}</button>
                <button onClick={onSubmitRequest} disabled={uploading} className="btn btn-primary" style={{ fontWeight: '700', flex: 2, opacity: 1, cursor: 'pointer' }}>{loadingType === 'SUBMIT' ? t('submitting') : t('submit_task_button')}</button>
            </div>
        </div>
    )
}

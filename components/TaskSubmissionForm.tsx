'use client'
import { useState } from 'react'
import { useLanguage } from '@/context/LanguageContext'
import { COST_DESCRIPTION_MAX, RECEIPT_ACCEPT } from '@/lib/task-costs'
import { FileChip, FileChips, FilePicker, NamePicker, type PickedName } from '@/components/ui'
import { useListNames } from '@/components/lists/useListNames'

// F-23: extracted verbatim out of tasks/[id]/client.tsx. `isDragging` is
// local (only ever read by this dropzone's own border style), but every
// other piece of state here — pendingFiles, cost/costName,
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
    /** The cost's name, typed or picked from the company's cost names (CLIENTS_PLAN.md §5). */
    costName: PickedName
    setCostName: (v: PickedName) => void
    /** The task's company, whose cost names are offered. */
    companyId?: string | null
    cost: string
    setCost: (v: string) => void
    onAddCost: () => void
    /** The next cost's receipt photo, if one was picked (CLIENTS_PLAN.md §6.2). */
    costReceipt: File | null
    onCostReceipt: (files: File[]) => void
    onClearCostReceipt: () => void
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
    costName, setCostName, companyId, cost, setCost, onAddCost, costReceipt, onCostReceipt, onClearCostReceipt, costEntries, onRemoveCostEntry,
    note, setNote,
    capturingLocation, locationStatus, onCaptureLocation,
    onSaveDraft, onSubmitRequest, loadingType
}: TaskSubmissionFormProps) {
    const { t, locale } = useLanguage()
    const costNames = useListNames('COST_NAME', companyId)
    const [isDragging, setIsDragging] = useState(false)

    return (
        <div style={{ marginTop: '3rem', borderTop: '2px solid var(--border)', paddingTop: '2rem' }}>
            <h3 style={{ marginBottom: '1.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem', flexDirection: 'row' }}>
                <span aria-hidden="true">📤</span> {t('submit_task_title')}
            </h3>

            <div style={{ marginBottom: '1.5rem' }}>
                <label style={{ display: 'block', fontWeight: '600', marginBottom: '0.75rem' }}>{t('attachments_optional_label')}</label>
                <div
                    onDragOver={e => { e.preventDefault(); setIsDragging(true); }}
                    onDragLeave={() => setIsDragging(false)}
                    onDrop={e => { e.preventDefault(); setIsDragging(false); if (e.dataTransfer.files.length) onAddFiles(Array.from(e.dataTransfer.files)); }}
                    style={{ border: `2px dashed ${isDragging ? 'var(--info-solid)' : 'var(--border-firm)'}`, borderRadius: '0.75rem', padding: '2.5rem', textAlign: 'center', background: isDragging ? 'var(--info-bg-subtle)' : 'var(--surface-subtle)', transition: 'all 0.2s', cursor: 'pointer', position: 'relative' }}
                >
                    <input
                        aria-label={t('attachments_label' as any)}
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
                        <div aria-hidden="true" style={{ fontSize: '2.5rem', marginBottom: '0.5rem' }}>☁️</div>
                        <div style={{ fontWeight: '600', color: 'var(--text-muted)' }}>{t('upload_drag_files_msg')}</div>
                        <div style={{ fontSize: '0.8rem', color: 'var(--text-faint)', marginTop: '0.25rem' }}>{t('upload_allowed_types_msg')}</div>
                    </div>
                </div>

                {pendingFiles.length > 0 && (
                    <div style={{ marginTop: '1rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                        {pendingFiles.map((f, i) => (
                            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.75rem 1rem', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '0.5rem', flexDirection: 'row' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexDirection: 'row' }}>
                                    <span aria-hidden="true" style={{ fontSize: '1.25rem' }}>📄</span>
                                    <div style={{ textAlign: locale === 'ar' ? 'right' : 'left' }}>
                                        <div style={{ fontSize: '0.9rem', fontWeight: '500' }}>{f.name}</div>
                                        <div style={{ fontSize: '0.7rem', color: 'var(--text-faint)' }}>{(f.size / 1024 / 1024).toFixed(2)} MB</div>
                                    </div>
                                </div>
                                <button onClick={() => onRemoveFile(i)} style={{ color: 'var(--danger-fg-strong)', background: 'var(--danger-bg-subtle)', border: 'none', borderRadius: '0.375rem', padding: '0.4rem 0.75rem', cursor: 'pointer', fontSize: '0.8rem', fontWeight: '600' }}>{t('delete')}</button>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            <div style={{ marginBottom: '1.5rem' }}>
                <label htmlFor="cost-name" style={{ display: 'block', fontWeight: '600', marginBottom: '0.75rem' }}>{t('add_costs_label')}</label>
                {/* On a phone the name takes the line, and the amount goes below: its suggestions need the width. */}
                <div style={{ display: 'flex', gap: '0.5rem', flexDirection: 'row', flexWrap: 'wrap' }}>
                    <div style={{ flex: '1 1 220px', minWidth: 0 }}>
                        <NamePicker
                            id="cost-name"
                            placeholder={t('cost_description_placeholder')}
                            value={costName}
                            onChange={setCostName}
                            {...costNames}
                            addLabel={t('lists_add_to_list')}
                            failedLabel={t('lists_add_failed')}
                            maxLength={COST_DESCRIPTION_MAX}
                        />
                    </div>
                    <input type="number" aria-label={t('cost_amount_placeholder')} className="input" placeholder={t('cost_amount_placeholder')} value={cost} onChange={e => setCost(e.target.value)} style={{ width: '120px' }} />
                    <button onClick={onAddCost} disabled={!cost} className="btn" style={{ background: 'var(--border)', color: 'var(--info-fg)', fontWeight: '700', minWidth: '80px', opacity: 1, cursor: 'pointer' }}>{t('add_label')}</button>
                </div>
                {/* Its receipt, picked before Add, goes with the cost added next; picked again, it's replaced. */}
                <div style={{ marginTop: 'var(--space-3)', display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
                    {costReceipt && (
                        <FileChips label={t('cost_receipt')}>
                            <FileChip name={costReceipt.name} size={costReceipt.size} onRemove={onClearCostReceipt} />
                        </FileChips>
                    )}
                    <FilePicker label={t('cost_receipt_attach')} hint={t('cost_receipt_hint')} accept={RECEIPT_ACCEPT} onFiles={onCostReceipt} disabled={uploading} multiple={false} />
                </div>
                {costEntries.length > 0 && (
                    <div style={{ marginTop: '1rem', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '0.5rem', overflow: 'hidden' }}>
                        {costEntries.map((e, i) => (
                            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 'var(--space-2)', padding: '0.75rem 1rem', borderBottom: i < costEntries.length - 1 ? '1px solid var(--surface-sunk)' : 'none', flexDirection: 'row' }}>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)', minWidth: 0 }}>
                                    <div style={{ display: 'flex', gap: '0.5rem', fontWeight: '500', flexDirection: 'row', overflowWrap: 'anywhere' }}>
                                        <span>{e.description || t('no_description')}</span>
                                        <span style={{ color: 'var(--text-faint)' }}>•</span>
                                        <span style={{ color: 'var(--warn-fg-mid)', whiteSpace: 'nowrap' }}>{e.amount.toFixed(2)} {t('egp')}</span>
                                    </div>
                                    {e.receipt && (
                                        <FileChips label={t('cost_receipt_of').replace('{name}', e.description || t('no_description'))}>
                                            <FileChip name={e.receipt.name} size={e.receipt.size} />
                                        </FileChips>
                                    )}
                                </div>
                                <button aria-label={t('remove' as any)} onClick={() => onRemoveCostEntry(i)} style={{ color: 'var(--danger-fg-strong)', padding: '0.25rem', cursor: 'pointer', border: 'none', background: 'none', fontWeight: 'bold', fontSize: '1.2rem' }}>×</button>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            <div style={{ marginBottom: '1.5rem' }}>
                <label style={{ display: 'block', fontWeight: '600', marginBottom: '0.75rem' }}>{t('note_optional_label')}</label>
                <textarea aria-label={t('note_optional_label')} className="input" rows={3} placeholder={t('note_placeholder')} value={note} onChange={e => setNote(e.target.value)} style={{ width: '100%', resize: 'none' }} maxLength={500} />
                <div style={{ textAlign: locale === 'ar' ? 'left' : 'right', fontSize: '0.75rem', color: note.length >= 500 ? 'var(--danger-fg-strong)' : 'var(--text-faint)', marginTop: '0.25rem' }}>{note.length}/500</div>
            </div>

            <div style={{ marginBottom: '2rem' }}>
                <label style={{ display: 'block', fontWeight: '600', marginBottom: '0.75rem' }}>{t('current_location_label')}</label>
                <div style={{ display: 'flex', gap: '1rem', alignItems: 'center', flexDirection: 'row' }}>
                    <button onClick={onCaptureLocation} disabled={capturingLocation || uploading} className="btn" style={{ background: capturingLocation ? 'var(--border)' : 'var(--info-fill)', color: capturingLocation ? 'var(--text-soft)' : 'var(--surface)', fontWeight: '600', display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
                        {capturingLocation ? t('capturing_location_button').replace('📍', '') : t('capture_location_button').replace('📍', '')}
                    </button>
                    <span style={{ fontSize: '0.875rem', fontWeight: '500', color: locationStatus.includes('✓') ? 'var(--ok-solid-hover)' : locationStatus.includes('Failed') ? 'var(--danger-solid-hover)' : 'var(--text-soft)' }}>{locationStatus}</span>
                </div>
            </div>

            <div style={{ display: 'flex', gap: '1rem', flexDirection: 'row' }}>
                <button onClick={onSaveDraft} disabled={uploading} className="btn" style={{ background: 'var(--border)', color: 'var(--text-main)', fontWeight: '600', flex: 1, opacity: 1, cursor: 'pointer' }}>{loadingType === 'DRAFT' ? t('saving') : t('save_draft_button')}</button>
                <button onClick={onSubmitRequest} disabled={uploading} className="btn btn-primary" style={{ fontWeight: '700', flex: 2, opacity: 1, cursor: 'pointer' }}>{loadingType === 'SUBMIT' ? t('submitting') : t('submit_task_button')}</button>
            </div>
        </div>
    )
}

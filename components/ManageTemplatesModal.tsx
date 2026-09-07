'use client'
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useLanguage } from '@/context/LanguageContext'
import { useToast } from '@/context/ToastContext'
import { useCompany } from '@/context/CompanyContext'

// F-23: extracted verbatim out of tasks/new/page.tsx, which had grown to
// 1386 lines. This modal's state (the two selected files and their upload
// flags) was only ever read here, so it moved in with the JSX rather than
// staying threaded through props from the parent page.
const UKFlag = () => (
    <svg width="24" height="18" viewBox="0 0 32 24" style={{ borderRadius: '2px', verticalAlign: 'middle', marginRight: '10px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
        <rect width="32" height="24" fill="#012169" />
        <path d="M0 0 L32 24 M32 0 L0 24" stroke="#fff" strokeWidth="3" />
        <path d="M0 0 L32 24 M32 0 L0 24" stroke="#C8102E" strokeWidth="1.5" />
        <path d="M16 0 V24 M0 12 H32" stroke="#fff" strokeWidth="5" />
        <path d="M16 0 V24 M0 12 H32" stroke="#C8102E" strokeWidth="3" />
    </svg>
)

const SAFlag = () => (
    <svg width="24" height="18" viewBox="0 0 32 24" style={{ borderRadius: '2px', verticalAlign: 'middle', marginRight: '10px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
        <rect width="32" height="24" fill="#006C35" />
        {/* Simplified but clearer SA sword */}
        <path d="M8 18 H24 M10 18 L12 20 M10 18 L12 16" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
        {/* Simplified Shahada calligraphic curve */}
        <path d="M10 11 Q16 8 22 11" stroke="#fff" strokeWidth="1.2" fill="none" />
    </svg>
)

interface ManageTemplatesModalProps {
    isOpen: boolean
    onClose: () => void
}

export default function ManageTemplatesModal({ isOpen, onClose }: ManageTemplatesModalProps) {
    const { t, locale } = useLanguage()
    const { showToast } = useToast()
    const { selectedCompanyId } = useCompany()

    const [mounted, setMounted] = useState(false)
    useEffect(() => {
        setMounted(true)
    }, [])

    const [enTemplateFile, setEnTemplateFile] = useState<File | null>(null)
    const [arTemplateFile, setArTemplateFile] = useState<File | null>(null)
    const [isEnUploading, setIsEnUploading] = useState(false)
    const [isArUploading, setIsArUploading] = useState(false)

    const handleClose = () => {
        onClose()
        setEnTemplateFile(null)
        setArTemplateFile(null)
    }

    if (!(mounted && isOpen)) return null

    return createPortal(
        <div className="modal-overlay" style={{ zIndex: 10000 }}>
            <div className="modal-content glass" style={{ width: '90%', maxWidth: '550px' }}>
                <div className="modal-header">
                    <h2 className="modal-title">{t('manage_templates')}</h2>
                    <button className="modal-close" onClick={handleClose}>×</button>
                </div>

                <div className="modal-body">
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
                        <div className="glass" style={{ padding: '1.25rem', background: 'rgba(255, 255, 255, 0.3)' }}>
                            <label style={{ display: 'flex', alignItems: 'center', marginBottom: '1rem', fontWeight: '600', color: 'var(--text-main)' }}>
                                <UKFlag /> {t('upload_en_template')}
                            </label>
                            <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
                                <label className="btn" style={{
                                    flex: 1,
                                    cursor: 'pointer',
                                    background: 'rgba(255, 255, 255, 0.6)',
                                    fontSize: '0.85rem',
                                    justifyContent: 'flex-start',
                                    overflow: 'hidden',
                                    textOverflow: 'ellipsis',
                                    whiteSpace: 'nowrap'
                                }}>
                                    <span>📂</span>
                                    {enTemplateFile ? enTemplateFile.name : t('choose_file')}
                                    <input
                                        type="file"
                                        accept=".xlsx"
                                        style={{ display: 'none' }}
                                        onChange={(e) => setEnTemplateFile(e.target.files?.[0] || null)}
                                    />
                                </label>
                                {enTemplateFile && (
                                    <button
                                        className="btn btn-primary"
                                        style={{ padding: '0.5rem 1rem', fontSize: '0.85rem', minWidth: '100px' }}
                                        disabled={isEnUploading}
                                        onClick={async () => {
                                            setIsEnUploading(true)
                                            const fd = new FormData()
                                            fd.append('file', enTemplateFile)
                                            fd.append('locale', 'en')
                                            try {
                                                const res = await fetch('/api/templates/upload', { method: 'POST', body: fd })
                                                const result = await res.json().catch(() => ({}))
                                                if (res.ok) {
                                                    showToast('English Template Updated', 'success')
                                                    setEnTemplateFile(null)
                                                } else {
                                                    showToast(result.error || 'Upload Failed', 'error')
                                                }
                                            } catch {
                                                showToast('Upload Error', 'error')
                                            } finally {
                                                setIsEnUploading(false)
                                            }
                                        }}
                                    >
                                        {isEnUploading ? <div className="spinner-small" style={{ width: '16px', height: '16px' }} /> : 'Upload'}
                                    </button>
                                )}
                            </div>
                        </div>

                        <div className="glass" style={{ padding: '1.25rem', background: 'rgba(255, 255, 255, 0.3)' }}>
                            <label style={{ display: 'flex', alignItems: 'center', marginBottom: '1rem', fontWeight: '600', color: 'var(--text-main)' }}>
                                <SAFlag /> {t('upload_ar_template')}
                            </label>
                            <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
                                <label className="btn" style={{
                                    flex: 1,
                                    cursor: 'pointer',
                                    background: 'rgba(255, 255, 255, 0.6)',
                                    fontSize: '0.85rem',
                                    justifyContent: 'flex-start',
                                    overflow: 'hidden',
                                    textOverflow: 'ellipsis',
                                    whiteSpace: 'nowrap'
                                }}>
                                    <span>📂</span>
                                    {arTemplateFile ? arTemplateFile.name : t('choose_file')}
                                    <input
                                        type="file"
                                        accept=".xlsx"
                                        style={{ display: 'none' }}
                                        onChange={(e) => setArTemplateFile(e.target.files?.[0] || null)}
                                    />
                                </label>
                                {arTemplateFile && (
                                    <button
                                        className="btn btn-primary"
                                        style={{ padding: '0.5rem 1rem', fontSize: '0.85rem', minWidth: '100px' }}
                                        disabled={isArUploading}
                                        onClick={async () => {
                                            setIsArUploading(true)
                                            const fd = new FormData()
                                            fd.append('file', arTemplateFile)
                                            fd.append('locale', 'ar')
                                            try {
                                                const res = await fetch('/api/templates/upload', { method: 'POST', body: fd })
                                                const result = await res.json().catch(() => ({}))
                                                if (res.ok) {
                                                    showToast('Arabic Template Updated', 'success')
                                                    setArTemplateFile(null)
                                                } else {
                                                    showToast(result.error || 'Upload Failed', 'error')
                                                }
                                            } catch {
                                                showToast('Upload Error', 'error')
                                            } finally {
                                                setIsArUploading(false)
                                            }
                                        }}
                                    >
                                        {isArUploading ? <div className="spinner-small" style={{ width: '16px', height: '16px' }} /> : 'Upload'}
                                    </button>
                                )}
                            </div>
                        </div>
                    </div>
                </div>

                <div className="modal-footer" style={{ background: 'rgba(0, 0, 0, 0.03)' }}>
                    <button
                        className="btn"
                        disabled={!selectedCompanyId}
                        title={!selectedCompanyId ? (t('select_company_prompt' as any) || 'Select a company first') : ''}
                        style={{
                            background: 'rgba(255, 255, 255, 0.6)',
                            border: '1px solid var(--glass-border)',
                            flex: 1,
                            opacity: !selectedCompanyId ? 0.5 : 1,
                            cursor: !selectedCompanyId ? 'not-allowed' : 'pointer'
                        }}
                        onClick={() => selectedCompanyId && window.open(`/api/templates/download?locale=${locale}&companyId=${selectedCompanyId}`, '_blank')}
                    >
                        📥 {t('download_current_template')}
                    </button>
                    <button className="btn btn-primary" onClick={handleClose} style={{ flex: 1 }}>
                        {t('cancel')}
                    </button>
                </div>
            </div>
        </div>,
        document.body
    )
}

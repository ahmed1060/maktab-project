'use client'
import { useState } from 'react'
import { createPortal } from 'react-dom'
import useSWR from 'swr'
import { useLanguage } from '@/context/LanguageContext'
import { useToast } from '@/context/ToastContext'
import { useCompany } from '@/context/CompanyContext'
import { fetcher } from '@/lib/swr-fetcher'
import SafeDate from '@/components/SafeDate'
import { useHydrated } from '@/lib/useHydrated'

// F-23: extracted verbatim out of tasks/new/page.tsx, which had grown to
// 1386 lines. This modal's state (the two selected files and their upload
// flags) was only ever read here, so it moved in with the JSX rather than
// staying threaded through props from the parent page.
const UKFlag = () => (
    <svg width="24" height="18" viewBox="0 0 32 24" style={{ borderRadius: '2px', verticalAlign: 'middle', marginRight: '10px', boxShadow: '0 1px 3px var(--shadow-weak)' }}>
        <rect width="32" height="24" fill="#012169" />
        <path d="M0 0 L32 24 M32 0 L0 24" stroke="#fff" strokeWidth="3" />
        <path d="M0 0 L32 24 M32 0 L0 24" stroke="#C8102E" strokeWidth="1.5" />
        <path d="M16 0 V24 M0 12 H32" stroke="#fff" strokeWidth="5" />
        <path d="M16 0 V24 M0 12 H32" stroke="#C8102E" strokeWidth="3" />
    </svg>
)

const SAFlag = () => (
    <svg width="24" height="18" viewBox="0 0 32 24" style={{ borderRadius: '2px', verticalAlign: 'middle', marginRight: '10px', boxShadow: '0 1px 3px var(--shadow-weak)' }}>
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

    const mounted = useHydrated()

    const [enTemplateFile, setEnTemplateFile] = useState<File | null>(null)
    const [arTemplateFile, setArTemplateFile] = useState<File | null>(null)
    const [isEnUploading, setIsEnUploading] = useState(false)
    const [isArUploading, setIsArUploading] = useState(false)

    // Viewing the raw base file is exclusive to "All Companies" — it's the
    // same file regardless of which company you'd pick, so showing it only
    // there (rather than duplicating it under every single-company view)
    // keeps it from being confused with the per-company generated template
    // the footer button below already downloads.
    const isAllCompaniesView = isOpen && !selectedCompanyId
    const { data: statusResult, mutate: mutateStatus } = useSWR(
        isAllCompaniesView ? '/api/templates/status' : null,
        fetcher
    )
    const templateStatus: { en?: { exists: boolean, updatedAt: string | null }, ar?: { exists: boolean, updatedAt: string | null } } = statusResult?.data || {}

    const handleClose = () => {
        onClose()
        setEnTemplateFile(null)
        setArTemplateFile(null)
    }

    if (!(mounted && isOpen)) return null

    return createPortal(
        <div className="modal-overlay" style={{ zIndex: 10000 }}>
            {/* Overrides on header/body/footer padding below: the shared
                .modal-* classes are sized for bigger dialogs elsewhere in
                the app — at this modal's actual content (two short upload
                rows), that padding plus the default 2rem section gap made
                it look oversized and mostly empty space. */}
            <div className="modal-content glass" style={{ width: '90%', maxWidth: '460px' }}>
                <div className="modal-header" style={{ padding: '1.1rem 1.5rem' }}>
                    <h2 className="modal-title" style={{ fontSize: '1.1rem' }}>{t('manage_templates')}</h2>
                    <button className="modal-close" onClick={handleClose}>×</button>
                </div>

                <div className="modal-body" style={{ padding: '1.25rem 1.5rem' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                        <div className="glass" style={{ padding: '1rem', background: 'var(--veil-30)' }}>
                            <label style={{ display: 'flex', alignItems: 'center', marginBottom: '0.75rem', fontWeight: '600', fontSize: '0.9rem', color: 'var(--text-main)' }}>
                                <UKFlag /> {t('upload_en_template')}
                            </label>
                            <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
                                <label className="btn" style={{
                                    flex: 1,
                                    cursor: 'pointer',
                                    background: 'var(--veil-60)',
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
                                                    mutateStatus()
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
                            {isAllCompaniesView && (
                                <TemplateStatusRow
                                    status={templateStatus.en}
                                    locale="en"
                                    t={t}
                                />
                            )}
                        </div>

                        <div className="glass" style={{ padding: '1rem', background: 'var(--veil-30)' }}>
                            <label style={{ display: 'flex', alignItems: 'center', marginBottom: '0.75rem', fontWeight: '600', fontSize: '0.9rem', color: 'var(--text-main)' }}>
                                <SAFlag /> {t('upload_ar_template')}
                            </label>
                            <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
                                <label className="btn" style={{
                                    flex: 1,
                                    cursor: 'pointer',
                                    background: 'var(--veil-60)',
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
                                                    mutateStatus()
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
                            {isAllCompaniesView && (
                                <TemplateStatusRow
                                    status={templateStatus.ar}
                                    locale="ar"
                                    t={t}
                                />
                            )}
                        </div>

                        {!isAllCompaniesView && (
                            <div style={{ fontSize: '0.75rem', color: '#64748b', textAlign: 'center' }}>
                                {t('template_view_all_companies_only' as any) || 'Select "All Companies" to view the currently uploaded base templates.'}
                            </div>
                        )}
                    </div>
                </div>

                <div className="modal-footer" style={{ background: 'var(--hairline)', padding: '0.9rem 1.5rem' }}>
                    <button
                        className="btn"
                        disabled={!selectedCompanyId}
                        title={!selectedCompanyId ? (t('select_company_prompt' as any) || 'Select a company first') : ''}
                        style={{
                            background: 'var(--veil-60)',
                            border: '1px solid var(--glass-border)',
                            flex: 1,
                            fontSize: '0.85rem',
                            padding: '0.5rem 0.75rem',
                            opacity: !selectedCompanyId ? 0.5 : 1,
                            cursor: !selectedCompanyId ? 'not-allowed' : 'pointer'
                        }}
                        onClick={() => selectedCompanyId && window.open(`/api/templates/download?locale=${locale}&companyId=${selectedCompanyId}`, '_blank')}
                    >
                        📥 {t('download_current_template')}
                    </button>
                    <button className="btn btn-primary" onClick={handleClose} style={{ flex: 1, fontSize: '0.85rem', padding: '0.5rem 0.75rem' }}>
                        {t('cancel')}
                    </button>
                </div>
            </div>
        </div>,
        document.body
    )
}

// "Currently uploaded" status for one locale — last-updated date plus a
// button to actually view the raw file, so a Super Admin can confirm
// what's live without re-uploading blindly. Only rendered in the "all
// companies" view (see isAllCompaniesView above).
function TemplateStatusRow({ status, locale, t }: {
    status: { exists: boolean, updatedAt: string | null } | undefined
    locale: 'en' | 'ar'
    t: (key: any) => string
}) {
    return (
        <div style={{
            marginTop: '0.6rem',
            paddingTop: '0.6rem',
            borderTop: '1px solid var(--hairline)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '0.5rem',
            flexWrap: 'wrap'
        }}>
            <span style={{ fontSize: '0.78rem', color: '#64748b' }}>
                {status?.exists ? (
                    <>{t('template_last_updated' as any) || 'Last updated'}: <SafeDate date={status.updatedAt} format="short" locale={locale} /></>
                ) : (
                    t('template_not_uploaded_yet' as any) || 'Not uploaded yet'
                )}
            </span>
            <button
                type="button"
                disabled={!status?.exists}
                onClick={() => window.open(`/api/templates/raw?locale=${locale}`, '_blank')}
                className="btn"
                style={{
                    background: 'var(--veil-60)',
                    padding: '0.3rem 0.7rem',
                    fontSize: '0.78rem',
                    border: '1px solid var(--glass-border)',
                    opacity: status?.exists ? 1 : 0.5,
                    cursor: status?.exists ? 'pointer' : 'not-allowed'
                }}
            >
                👁 {t('view_current_template' as any) || 'View current template'}
            </button>
        </div>
    )
}

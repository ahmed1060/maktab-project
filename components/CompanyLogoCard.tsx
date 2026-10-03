'use client'

import { useRef, useState } from 'react'
import { useLanguage } from '@/context/LanguageContext'
import { useToast } from '@/context/ToastContext'
import { MAX_LOGO_BYTES } from '@/lib/company-logo'

type Props = {
    companyId: string
    companyName: string
    logoUrl: string | null
    onChanged: (logoUrl: string | null) => void
    /** Shown, not changed: someone who holds settings.view without settings.edit. */
    readOnly?: boolean
}

export default function CompanyLogoCard({ companyId, companyName, logoUrl, onChanged, readOnly = false }: Props) {
    const { t, locale } = useLanguage()
    const { showToast } = useToast()
    const isRtl = locale === 'ar'

    const inputRef = useRef<HTMLInputElement | null>(null)
    const [busy, setBusy] = useState(false)

    const handleFile = async (file: File) => {
        // A local size check so the obvious rejection does not cost an upload of
        // the very bytes that are too big. The server checks again regardless —
        // this is a courtesy, not the rule.
        if (file.size > MAX_LOGO_BYTES) {
            showToast(t('company_logo_setting_hint'), 'error')
            return
        }
        setBusy(true)
        try {
            const body = new FormData()
            body.append('companyId', companyId)
            body.append('file', file)
            const res = await fetch('/api/companies/logo', { method: 'POST', body })
            const result = await res.json().catch(() => ({}))
            if (res.ok && result?.data?.logoUrl) {
                onChanged(result.data.logoUrl)
                showToast(t('settings_saved_success') || 'Settings saved', 'success')
            } else {
                showToast(result?.error || t('error_generic'), 'error')
            }
        } catch {
            showToast(t('error_generic'), 'error')
        } finally {
            setBusy(false)
            if (inputRef.current) inputRef.current.value = ''
        }
    }

    const handleRemove = async () => {
        setBusy(true)
        try {
            const res = await fetch(`/api/companies/logo?companyId=${encodeURIComponent(companyId)}`, { method: 'DELETE' })
            const result = await res.json().catch(() => ({}))
            if (res.ok) {
                onChanged(null)
                showToast(t('company_logo_removed'), 'success')
            } else {
                showToast(result?.error || t('error_generic'), 'error')
            }
        } catch {
            showToast(t('error_generic'), 'error')
        } finally {
            setBusy(false)
        }
    }

    return (
        <div className="glass" style={{ padding: '1.5rem', borderRadius: '1rem', textAlign: isRtl ? 'right' : 'left' }}>
            <div style={{ fontWeight: 500, marginBottom: '0.15rem' }}>{t('company_logo_setting')}</div>
            <div style={{ fontSize: '0.8rem', color: 'var(--text-soft)', marginBottom: '0.35rem' }}>
                {t('company_logo_setting_hint')}
            </div>
            <div style={{ fontSize: '0.78rem', color: 'var(--text-faint)', marginBottom: '1rem' }}>
                {t('company_logo_plate_note')}
            </div>

            {/* The preview is the sidebar's own header, at its own size, on its
                own ground — because a logo judged against a white settings card
                tells you nothing about how it will read where it actually
                appears. This is the entire reason the plate decision is visible
                rather than a surprise after saving. */}
            <div className="glass-dark" style={{
                padding: '0.85rem 1rem',
                borderRadius: '0.85rem',
                border: '1px solid var(--veil-20)',
                display: 'flex',
                alignItems: 'center',
                gap: '0.75rem',
                direction: isRtl ? 'rtl' : 'ltr',
            }}>
                <span style={{ fontSize: '1.4rem', flexShrink: 0, display: 'flex' }}>
                    {logoUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                            src={logoUrl}
                            alt=""
                            style={{
                                width: '2rem', height: '2rem', objectFit: 'contain',
                                background: 'var(--logo-plate)', borderRadius: '0.45rem',
                                padding: '0.15rem', boxSizing: 'border-box',
                            }}
                        />
                    ) : '🚀'}
                </span>
                <span style={{
                    color: 'var(--sidebar-fg)', fontWeight: 600, fontSize: '0.95rem',
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0,
                }}>
                    {companyName}
                </span>
            </div>

            {!logoUrl && (
                <div style={{ fontSize: '0.78rem', color: 'var(--text-faint)', marginTop: '0.5rem' }}>
                    {t('company_logo_none')}
                </div>
            )}

            <input
                ref={inputRef}
                aria-label={t('company_logo_setting')}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                hidden
                onChange={(e) => {
                    const file = e.target.files?.[0]
                    if (file) handleFile(file)
                }}
            />

            {!readOnly && <div style={{ display: 'flex', gap: '0.5rem', marginTop: '1rem', justifyContent: isRtl ? 'flex-start' : 'flex-end' }}>
                {logoUrl && (
                    <button type="button" className="btn" onClick={handleRemove} disabled={busy}>
                        {t('company_logo_remove')}
                    </button>
                )}
                <button type="button" className="btn btn-primary" onClick={() => inputRef.current?.click()} disabled={busy}>
                    {busy ? t('saving') : (logoUrl ? t('company_logo_replace') : t('company_logo_upload'))}
                </button>
            </div>}
        </div>
    )
}

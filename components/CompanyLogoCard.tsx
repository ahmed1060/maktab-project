'use client'

import { useRef, useState } from 'react'
import { Button, Card } from '@/components/ui'
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

/**
 * The company's logo (Company Settings → Branding). On the building blocks
 * (UI_PLAN.md §5 step 5, company settings part 2): a card, the logo as the
 * side bar will show it, and Upload or Replace and Remove on its end side.
 */
export default function CompanyLogoCard({ companyId, companyName, logoUrl, onChanged, readOnly = false }: Props) {
    const { t } = useLanguage()
    const { showToast } = useToast()

    const inputRef = useRef<HTMLInputElement | null>(null)
    // Which button is at work, so only it says so.
    const [busy, setBusy] = useState<'upload' | 'remove' | null>(null)

    const handleFile = async (file: File) => {
        // A local size check so the obvious rejection does not cost an upload of
        // the very bytes that are too big. The server checks again regardless —
        // this is a courtesy, not the rule.
        if (file.size > MAX_LOGO_BYTES) {
            showToast(t('company_logo_setting_hint'), 'error')
            if (inputRef.current) inputRef.current.value = ''
            return
        }
        setBusy('upload')
        try {
            const body = new FormData()
            body.append('companyId', companyId)
            body.append('file', file)
            const res = await fetch('/api/companies/logo', { method: 'POST', body })
            const result = await res.json().catch(() => ({}))
            if (res.ok && result?.data?.logoUrl) {
                onChanged(result.data.logoUrl)
                showToast(t('settings_saved_success'), 'success')
            } else {
                showToast(result?.error || t('error_generic'), 'error')
            }
        } catch {
            showToast(t('error_generic'), 'error')
        } finally {
            setBusy(null)
            if (inputRef.current) inputRef.current.value = ''
        }
    }

    const handleRemove = async () => {
        setBusy('remove')
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
            setBusy(null)
        }
    }

    return (
        <Card title={t('company_logo_setting')}>
            <p className="ui-card-note">{t('company_logo_setting_hint')}</p>

            {/* The preview is the side bar's own header, on its own dark
                ground: a logo judged against a white settings card tells you
                nothing about how it will read where it appears. That is why
                the light plate it's drawn on is shown here rather than being
                a surprise after saving. */}
            <div className="ui-logo-preview-wrap">
                <p className="ui-label">{t('company_logo_preview')}</p>
                <div className="ui-logo-preview">
                    {logoUrl
                        // eslint-disable-next-line @next/next/no-img-element -- next/image would need every company's storage host in next.config, for one small image
                        ? <img src={logoUrl} alt="" className="ui-logo-plate" />
                        : <span className="ui-logo-mark" aria-hidden="true">🚀</span>}
                    <span className="ui-logo-preview-name"><bdi>{companyName}</bdi></span>
                </div>
                {!logoUrl && <p className="ui-card-note">{t('company_logo_none')}</p>}
                <p className="ui-card-note">{t('company_logo_plate_note')}</p>
            </div>

            <input
                ref={inputRef}
                aria-label={t('company_logo_setting')}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                hidden
                onChange={(e) => {
                    const file = e.target.files?.[0]
                    if (file) void handleFile(file)
                }}
            />

            {!readOnly && (
                <div className="ui-card-actions">
                    {logoUrl && (
                        <Button onClick={() => { void handleRemove() }} busy={busy === 'remove'} disabled={!!busy}>
                            {t('company_logo_remove')}
                        </Button>
                    )}
                    <Button variant="primary" onClick={() => inputRef.current?.click()} busy={busy === 'upload'} disabled={!!busy}>
                        {t(logoUrl ? 'company_logo_replace' : 'company_logo_upload')}
                    </Button>
                </div>
            )}
        </Card>
    )
}

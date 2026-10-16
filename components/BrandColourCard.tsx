'use client'

import { useState, type CSSProperties, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { WarningIcon } from '@phosphor-icons/react/ssr'
import { Button, Card, ColourChoice, Icon } from '@/components/ui'
import { useLanguage } from '@/context/LanguageContext'
import { useToast } from '@/context/ToastContext'
import { BRAND_PRESETS, brandTokens, EXAMPLE_BRAND_CODE, nearErrorRed } from '@/lib/brand-colour'
import { useAdjustOnChange } from '@/lib/useAdjustOnChange'
import { useReportUnsaved } from '@/lib/useUnsavedChanges'
import type { TranslationKey } from '@/lib/translations'

/**
 * The brand colour setting (UI_PLAN.md §4.6): the system's default in System
 * Settings, or a company's own in Company Settings → Branding, which can go
 * back to the default. Ready-made colours or a typed code, a preview in light
 * and dark before saving, and a warning for a colour close to the error red
 * (DESIGN.md §2.1, §5.3).
 *
 * After a save the page is fetched again, so it takes the colour at once for
 * whoever sees it here. Everyone else sees it the next time they open or
 * reload a page, or sign in: moving to another page inside the app doesn't
 * draw the layouts that hold it again (lib/page-brand-colour.ts).
 */
export default function BrandColourCard({ saved, defaultColour, hint, onSave, readOnly = false }: {
    /** What's stored: a company's colour or null for the default, or the default itself. */
    saved: string | null
    /** The system's default, for a company's "Use the default". Left out for the default's own card. */
    defaultColour?: string
    hint: ReactNode
    /** Saves the colour, null for the default; true when it was saved. */
    onSave: (next: string | null) => Promise<boolean>
    readOnly?: boolean
}) {
    const { t } = useLanguage()
    const { showToast } = useToast()
    const router = useRouter()
    const [picked, setPicked] = useState<string | null | undefined>(saved)
    const [saving, setSaving] = useState(false)
    // The stored colour changing (another tab's save, a refetch): start from it.
    useAdjustOnChange([saved], () => setPicked(saved))

    const changed = picked !== undefined && picked !== saved
    useReportUnsaved('brand-colour', changed || picked === undefined)
    // What the preview shows: the pick, the default it goes back to, or the
    // stored colour while the typed code isn't one yet.
    const shown = (picked === null ? defaultColour : picked) ?? (saved ?? defaultColour)
    const tokens = shown ? brandTokens(shown) : null

    const save = async () => {
        if (picked === undefined) return
        setSaving(true)
        try {
            if (await onSave(picked)) {
                showToast(t('brand_colour_saved'), 'success')
                router.refresh()
            } else {
                showToast(t('error_generic'), 'error')
            }
        } finally {
            setSaving(false)
        }
    }

    const code = (sentence: TranslationKey) => {
        const [before, after] = t(sentence).split('{code}')
        return <>{before}<bdi dir="ltr" translate="no">{EXAMPLE_BRAND_CODE}</bdi>{after}</>
    }

    return (
        <Card title={t('brand_colour')}>
            <p className="ui-card-note">{hint}</p>
            <ColourChoice
                legend={t('brand_colour_choose')}
                value={picked}
                onChange={setPicked}
                disabled={readOnly || saving}
                swatches={BRAND_PRESETS.map(p => ({ value: p.hex, label: t(`brand_preset_${p.key}` as TranslationKey) }))}
                defaultOption={defaultColour ? { label: t('brand_colour_use_default'), colour: defaultColour } : undefined}
                codeLabel={t('brand_colour_code')}
                codeHint={code('brand_colour_code_hint')}
                invalidCode={code('brand_colour_code_invalid')}
            />
            {typeof picked === 'string' && nearErrorRed(picked) && (
                <p className="ui-colour-warning" role="status">
                    <Icon icon={WarningIcon} size={16} />
                    <span>{t('brand_colour_near_red')}</span>
                </p>
            )}
            {tokens && (
                <div className="ui-colour-preview" aria-hidden="true">
                    {(['light', 'dark'] as const).map(theme => (
                        <div key={theme} className="ui-colour-preview-theme" data-preview={theme} style={tokens[theme] as CSSProperties}>
                            <span className="ui-colour-preview-name">{t(theme === 'light' ? 'theme_light' : 'theme_dark')}</span>
                            <span className="ui-btn ui-btn-primary ui-btn-sm">{t('brand_preview_button')}</span>
                            <span className="ui-colour-preview-link">{t('brand_preview_link')}</span>
                            <span className="ui-colour-preview-tab">{t('brand_preview_tab')}</span>
                        </div>
                    ))}
                </div>
            )}
            {!readOnly && (
                <div className="ui-card-actions">
                    <Button variant="primary" busy={saving} disabled={!changed} onClick={save}>{t('brand_colour_save')}</Button>
                </div>
            )}
        </Card>
    )
}

'use client'

import { useEffect, useId, useState, type ReactNode } from 'react'
import { BookmarkSimpleIcon, CheckIcon, CopyIcon } from '@phosphor-icons/react/ssr'
import { useLanguage } from '@/context/LanguageContext'
import { useToast } from '@/context/ToastContext'
import { Button, ButtonBookmark, Card } from '@/components/ui'
import { taxExportBookmark } from '@/lib/tax-export-button'
import { TAX_EXPORT_NOTES, TAX_EXPORT_STEPS, TAX_PORTAL_WORDS } from '@/lib/tax-export-page'
import type { TranslationKey } from '@/lib/translations'

/**
 * A line with what it leaves to be filled in: the tax portal's and the
 * panel's own words as they have them, in Arabic and in bold in either
 * language (DESIGN.md §5.5), and Nizmo's own as the page's language has them.
 */
function filled(line: string, ours: Record<string, string>): ReactNode[] {
    return line.split(/\{([a-z]+)\}/).map((part, at) => {
        if (at % 2 === 0) return part
        const theirs = (TAX_PORTAL_WORDS as Record<string, string | undefined>)[part]
        return theirs ? <bdi key={at} lang="ar" translate="no" className="ui-their-word">{theirs}</bdi> : ours[part] ?? `{${part}}`
    })
}

/**
 * The tax portal's export button, to take and to learn (CLIENT_PORTAL_PLAN.md
 * §10; DESIGN.md §5.5, The tax portal's export button; PR 319): the button
 * to drag to the browser's bookmarks bar on a computer, with Copy address
 * for whoever can't drag; how it's used, in numbered steps; and what to
 * know. The button itself is lib/tax-export-button.ts: it runs on the tax
 * portal's page, not here, so pressing it here only says that it's dragged.
 */
export default function TaxExportButton() {
    const { t, locale } = useLanguage()
    const { showToast } = useToast()
    const drag = useId()
    const [copied, setCopied] = useState(false)
    useEffect(() => {
        if (!copied) return
        const back = setTimeout(() => setCopied(false), 2000)
        return () => clearTimeout(back)
    }, [copied])

    const copy = async () => {
        try {
            await navigator.clipboard.writeText(taxExportBookmark())
            setCopied(true)
        } catch {
            // A browser that keeps the clipboard to itself: dragging is still there.
            showToast(t('tax_export_copy_failed'), 'error')
        }
    }

    const intl = locale === 'ar' ? 'ar-EG' : 'en-GB'
    const ours = { upload: t('tax_upload'), section: t('tax_position') }
    const said = (key: TranslationKey) => <li key={key}>{filled(t(key), ours)}</li>

    return (
        <div className="ui-tax-export">
            <Card title={t('tax_export_add_title')}>
                {/* On a computer. A phone has no bookmarks bar to drag to, and says so instead. */}
                <div className="ui-card-lines ui-tax-export-computer">
                    <p id={drag}>{t('tax_export_add_drag')}</p>
                    <div className="ui-tax-export-take">
                        <ButtonBookmark address={taxExportBookmark()} icon={BookmarkSimpleIcon} describedBy={drag} onPress={() => showToast(t('tax_export_pressed'), 'info')}>
                            {t('tax_export_bookmark')}
                        </ButtonBookmark>
                        <Button icon={copied ? CheckIcon : CopyIcon} onClick={() => { void copy() }}>
                            {copied ? t('tax_export_copied') : t('tax_export_copy')}
                        </Button>
                        <span className="ui-visually-hidden" role="status">{copied ? t('tax_export_copied') : ''}</span>
                    </div>
                    <p className="ui-card-note">{t('tax_export_by_hand')}</p>
                    <p className="ui-card-note">{t('tax_export_keeps_copy')}</p>
                </div>
                <p className="ui-tax-export-phone">{t('tax_export_phone')}</p>
            </Card>

            <Card title={t('tax_export_use_title')}>
                <ol className="ui-guide-steps" role="list">
                    {TAX_EXPORT_STEPS.map((step, i) => (
                        <li key={step.title} className="ui-guide-step">
                            <span className="ui-guide-number" aria-hidden="true">{(i + 1).toLocaleString(intl)}</span>
                            <div className="ui-guide-body">
                                <h3 className="ui-guide-title">{t(step.title)}</h3>
                                <p className="ui-guide-who">{t(step.where)}</p>
                                <ul className="ui-guide-lines">{step.lines.map(said)}</ul>
                            </div>
                        </li>
                    ))}
                </ol>
            </Card>

            <Card title={t('tax_export_know_title')}>
                <ul className="ui-guide-lines">{TAX_EXPORT_NOTES.map(said)}</ul>
            </Card>
        </div>
    )
}

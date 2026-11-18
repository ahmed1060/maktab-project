'use client'

import Link from 'next/link'
import { useLanguage } from '@/context/LanguageContext'
import { TAX_EXPORT_PAGE } from '@/lib/tax-export-page'

/**
 * How to get the portal's file (CLIENT_PORTAL_PLAN.md §10, §12 step 4c;
 * DESIGN.md §5.5, A client's tax position, for the company's people, and
 * Uploading the tax portal's file; PR 320): the link to the tax portal's
 * export button's page, where the upload is and where it says a file isn't
 * right. It's named for the portal's file, not "this file", as it's read
 * beside a file that was refused.
 *
 * In one of the upload's dialogs it opens in a new tab, so what the dialog
 * shows of a file stays as it is, and says so to screen readers.
 *
 * It's on a page opened often and is seldom pressed, so nothing of its page
 * is fetched ahead as it comes into view.
 *
 * On a phone it's 44px under a finger, laid over its line so no line around
 * it moves (`.ui-tax-how`, components/ui/ui.css).
 */
export default function TaxExportLink({ newTab = false }: { newTab?: boolean }) {
    const { t } = useLanguage()
    return (
        <Link className="ui-text-link ui-tax-how" href={TAX_EXPORT_PAGE} prefetch={false} {...(newTab && { target: '_blank', rel: 'noopener noreferrer' })}>
            {t('tax_export_how')}{newTab && <span className="ui-visually-hidden"> {t('ui_opens_new_tab')}</span>}
        </Link>
    )
}

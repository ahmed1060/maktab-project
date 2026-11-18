'use client'

import { useLanguage } from '@/context/LanguageContext'
import AccessDenied from '@/components/AccessDenied'
import { Page, PageHeader } from '@/components/ui'
import TaxExportButton from '@/components/tax/TaxExportButton'
import { useCan } from '@/lib/useCan'
import { useModules } from '@/lib/useModules'

/**
 * The tax portal's export button (CLIENT_PORTAL_PLAN.md §10; DESIGN.md §5.5,
 * The tax portal's export button; PR 319): where the button is taken from,
 * and how it's used, for whoever may update clients' tax position. Its
 * layout refuses a company whose package hasn't the client portal.
 */
export default function TaxExportButtonPage() {
    const { t } = useLanguage()
    const { can } = useCan()
    const modules = useModules()

    // Decided on the first paint, from who the dashboard's layout read: the
    // page is the button itself, so nobody without the permission has it for
    // the moment the session takes to load.
    if (!can('tax.manage')) return <AccessDenied />

    return (
        <Page>
            <PageHeader
                title={t('tax_export_title')}
                subtitle={t('tax_export_subtitle').replace('{upload}', t('tax_upload'))}
                back={{ href: '/dashboard/clients', label: modules.label('clients') }}
            />
            <TaxExportButton />
        </Page>
    )
}

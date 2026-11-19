'use client'

import { Page, PageHeader } from '@/components/ui'
import { useLanguage } from '@/context/LanguageContext'

/**
 * The client's area's first page (CLIENT_PORTAL_PLAN.md §5.3, §12 step 7b;
 * PR 332): the client's name above Tax position, and a line saying it will
 * be shown there soon, until the tax position itself (step 8). Sign out is in
 * the top bar's account menu (PR 334). The client's name comes from the
 * session, never the address.
 */
export function PortalHome({ client }: { client: string }) {
    const { t } = useLanguage()
    return (
        <Page>
            <PageHeader overline={client} title={t('tax_position')} subtitle={t('portal_tax_soon')} />
        </Page>
    )
}

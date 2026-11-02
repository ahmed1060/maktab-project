'use client'

import { useSearchParams } from 'next/navigation'
import { useSession } from 'next-auth/react'
import AccessDenied from '@/components/AccessDenied'
import RoleChangeRequests from '@/components/RoleChangeRequests'
import { Page, PageHeader } from '@/components/ui'
import { useLanguage } from '@/context/LanguageContext'

/**
 * The Super Admin's queue of companies' role change requests (ROLES_PLAN.md
 * §6.9). On the building blocks' page header (UI_PLAN.md §5 step 5, the Super
 * Admin's pages part 2a), where its name was the old top bar's.
 */
export default function RoleChangeRequestsPage() {
    const { t } = useLanguage()
    const { data: session, status } = useSession()
    const highlight = useSearchParams().get('highlight')

    if (status === 'loading') return null
    if (session?.user?.role !== 'SUPER_ADMIN') return <AccessDenied />
    return (
        <Page>
            <PageHeader title={t('role_changes_title')} subtitle={t('role_changes_hint')} />
            <RoleChangeRequests side="superAdmin" highlight={highlight} />
        </Page>
    )
}

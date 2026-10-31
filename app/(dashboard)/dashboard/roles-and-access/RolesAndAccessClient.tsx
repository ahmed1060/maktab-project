'use client'
import RoleChangeRequests from '@/components/RoleChangeRequests'
import AccessReviews from '@/components/AccessReviews'
import { Page, PageHeader, TabLinks } from '@/components/ui'
import { useLanguage } from '@/context/LanguageContext'

/**
 * Roles and access's two tabs, each in the address so a notice or a reload
 * lands on it: asking the Super Admin to change a role, and access reviews.
 */
export default function RolesAndAccessClient({ tab, highlight }: { tab: 'changes' | 'reviews'; highlight: string | null }) {
    const { t } = useLanguage()
    return (
        <Page>
            <PageHeader title={t('roles_access_title')} subtitle={t('roles_access_hint')} />
            <TabLinks label={t('roles_access_title')} items={[
                { href: '/dashboard/roles-and-access?tab=changes', label: t('role_changes_tab_changes'), current: tab === 'changes' },
                // Periodic access review (ROLES_PLAN.md §6.14), when the company has it.
                { href: '/dashboard/roles-and-access?tab=reviews', label: t('access_review_tab'), current: tab === 'reviews' },
            ]} />
            {tab === 'reviews'
                ? <AccessReviews side="company" highlight={highlight} />
                : <RoleChangeRequests side="company" highlight={highlight} />}
        </Page>
    )
}

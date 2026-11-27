'use client'
import RoleChangeRequests from '@/components/RoleChangeRequests'
import AccessReviews from '@/components/AccessReviews'
import { Page, PageHeader, TabLinks } from '@/components/ui'
import { useLanguage } from '@/context/LanguageContext'
import type { RolesAndAccessTab } from '@/lib/roles-and-access'

/**
 * Roles and access's two tabs, each in the address so a notice or a reload
 * lands on it: asking the Super Admin to change a role, and access reviews.
 * Each for whoever holds its permission, as the page says (PR 439).
 */
export default function RolesAndAccessClient({ tabs, tab, highlight }: { tabs: RolesAndAccessTab[]; tab: RolesAndAccessTab; highlight: string | null }) {
    const { t } = useLanguage()
    // What the tabs they hold are for, holding one (DESIGN.md, Answering access reviews).
    const hint = tabs.length > 1 ? 'roles_access_hint' : tabs[0] === 'reviews' ? 'roles_access_hint_reviews' : 'roles_access_hint_changes'
    return (
        <Page>
            <PageHeader title={t('roles_access_title')} subtitle={t(hint)} />
            <TabLinks label={t('roles_access_title')} items={[
                ...(tabs.includes('changes') ? [{ href: '/dashboard/roles-and-access?tab=changes', label: t('role_changes_tab_changes'), current: tab === 'changes' }] : []),
                // Periodic access review (ROLES_PLAN.md §6.14), when the company has it.
                ...(tabs.includes('reviews') ? [{ href: '/dashboard/roles-and-access?tab=reviews', label: t('access_review_tab'), current: tab === 'reviews' }] : []),
            ]} />
            {tab === 'reviews'
                ? <AccessReviews side="company" highlight={highlight} />
                : <RoleChangeRequests side="company" highlight={highlight} />}
        </Page>
    )
}

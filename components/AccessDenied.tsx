'use client'

import { usePathname } from 'next/navigation'
import { ButtonLink, Page, PageHeader } from '@/components/ui'
import { useLanguage } from '@/context/LanguageContext'
import { useViewer } from '@/lib/useCan'
import { accountRefusal } from '@/lib/account-refusal'

/**
 * A page someone can't open (DESIGN.md §5.5): its header says so, in the
 * page's language, and under it why, and who can change it.
 *
 * On the building blocks (UI_PLAN.md §5 step 5, the pages left): it was a
 * page of its own making, its title in English only, in Title Case, under
 * a no-entry emoji. It told everyone to ask their administrator, an Admin
 * on a Super Admin's page too, and on the dashboard itself it sent them
 * back to the dashboard.
 *
 * `superAdmins`: the page is one only a Super Admin opens, which nobody's
 * role changes. `notInPackage`: the company's package doesn't include its
 * module (lib/features/guard.tsx). The rest it knows from who is asking.
 */
export default function AccessDenied({ superAdmins = false, notInPackage = false }: { superAdmins?: boolean; notInPackage?: boolean }) {
    const { t } = useLanguage()
    const viewer = useViewer()
    const pathname = usePathname()
    // An account that can't open pages at all for now, such as a suspended
    // one, until the heartbeat signs it out and says why (UserHeartbeat):
    // every page says this, so it isn't sent to another.
    const refused = !!viewer && !!accountRefusal(viewer)

    const why = superAdmins ? t('access_denied_super_admins')
        : notInPackage ? t('access_denied_package')
            : refused ? t('access_denied_account')
                : viewer?.role === 'SUPER_ADMIN' ? t('access_denied_company')
                    : t('access_denied_role')
    const onwards = !refused && pathname !== '/dashboard'

    return (
        <Page>
            <PageHeader
                title={t('access_denied_title')}
                subtitle={why}
                action={onwards ? <ButtonLink href="/dashboard">{t('access_denied_dashboard')}</ButtonLink> : undefined}
            />
        </Page>
    )
}

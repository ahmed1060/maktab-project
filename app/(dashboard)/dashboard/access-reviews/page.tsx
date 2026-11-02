'use client'

import { useSearchParams } from 'next/navigation'
import { useSession } from 'next-auth/react'
import AccessDenied from '@/components/AccessDenied'
import AccessReviews from '@/components/AccessReviews'
import { Page, PageHeader } from '@/components/ui'
import { useLanguage } from '@/context/LanguageContext'

/**
 * Every company's access reviews, for the Super Admin: which are unanswered
 * (ROLES_PLAN.md §6.14). On the building blocks' page header (UI_PLAN.md §5
 * step 5, the Super Admin's pages part 2a), where its name was the old top bar's.
 */
export default function AccessReviewsPage() {
    const { t } = useLanguage()
    const { data: session, status } = useSession()
    const highlight = useSearchParams().get('highlight')

    if (status === 'loading') return null
    if (session?.user?.role !== 'SUPER_ADMIN') return <AccessDenied />
    return (
        <Page>
            <PageHeader title={t('access_review_title')} subtitle={t('access_review_hint')} />
            <AccessReviews side="superAdmin" highlight={highlight} />
        </Page>
    )
}

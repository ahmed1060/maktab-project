'use client'

import { useEffect } from 'react'
import { useSearchParams } from 'next/navigation'
import { useSession } from 'next-auth/react'
import AccessDenied from '@/components/AccessDenied'
import AccessReviews from '@/components/AccessReviews'
import { useLanguage } from '@/context/LanguageContext'
import { useHeader } from '@/context/HeaderContext'

/** Every company's access reviews, for the Super Admin: which are unanswered (ROLES_PLAN.md §6.14). */
export default function AccessReviewsPage() {
    const { t } = useLanguage()
    const { setTitle, setSubtitle } = useHeader()
    const { data: session } = useSession()
    const highlight = useSearchParams().get('highlight')

    useEffect(() => {
        setTitle(t('access_review_title'))
        setSubtitle(t('access_review_hint'))
        return () => { setTitle(null); setSubtitle(null) }
    }, [t, setTitle, setSubtitle])

    if (session && session.user?.role !== 'SUPER_ADMIN') return <AccessDenied />
    return <AccessReviews side="superAdmin" highlight={highlight} />
}

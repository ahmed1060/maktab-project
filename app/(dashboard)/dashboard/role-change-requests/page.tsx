'use client'

import { useEffect } from 'react'
import { useSearchParams } from 'next/navigation'
import { useSession } from 'next-auth/react'
import AccessDenied from '@/components/AccessDenied'
import RoleChangeRequests from '@/components/RoleChangeRequests'
import { useLanguage } from '@/context/LanguageContext'
import { useHeader } from '@/context/HeaderContext'

/** The Super Admin's queue of companies' role change requests (ROLES_PLAN.md §6.9). */
export default function RoleChangeRequestsPage() {
    const { t } = useLanguage()
    const { setTitle, setSubtitle } = useHeader()
    const { data: session } = useSession()
    const highlight = useSearchParams().get('highlight')

    useEffect(() => {
        setTitle(t('role_changes_title'))
        setSubtitle(t('role_changes_hint'))
        return () => { setTitle(null); setSubtitle(null) }
    }, [t, setTitle, setSubtitle])

    if (session && session.user?.role !== 'SUPER_ADMIN') return <AccessDenied />
    return <RoleChangeRequests side="superAdmin" highlight={highlight} />
}

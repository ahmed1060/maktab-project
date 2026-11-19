'use client'

import { useState } from 'react'
import { signOut } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import { Button, Page, PageHeader } from '@/components/ui'
import { useLanguage } from '@/context/LanguageContext'

/**
 * The client's area's first page (CLIENT_PORTAL_PLAN.md §5.3, §12 step 7b;
 * PR 332): the client's name above Tax position, a line saying it will be
 * shown there soon, and Sign out, until the area's top bar and account menu
 * (step 7d) and the tax position itself (step 8). The client's name comes
 * from the session, never the address.
 */
export function PortalHome({ client }: { client: string }) {
    const { t } = useLanguage()
    const router = useRouter()
    const [leaving, setLeaving] = useState(false)

    // As the account menu signs out (components/DashboardHeader.tsx).
    const leave = async () => {
        setLeaving(true)
        await signOut({ redirect: false })
        router.push('/login')
    }

    return (
        <Page>
            <PageHeader
                overline={client}
                title={t('tax_position')}
                subtitle={t('portal_tax_soon')}
                action={<Button onClick={leave} busy={leaving}>{t('sign_out')}</Button>}
            />
        </Page>
    )
}

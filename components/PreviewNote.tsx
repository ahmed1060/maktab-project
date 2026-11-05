'use client'

import { useState } from 'react'
import { useSession } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import { Button, PageNote } from '@/components/ui'
import { useLanguage } from '@/context/LanguageContext'
import { roleLabel } from '@/lib/role-label'

/**
 * A role the Super Admin is previewing (ROLES_PLAN.md §6.6), as a note above
 * every page (DESIGN.md §5.5): which role, at which company, that nothing
 * can be changed while it lasts, and Exit preview.
 *
 * On the building blocks (UI_PLAN.md §5 step 5, the pages left): it was a box
 * of its own making under an eye emoji, with the old primary button.
 */
export default function PreviewNote({ preview }: { preview: { roleName: string; roleBuiltIn?: string | null; companyId: string; companyName: string } | null | undefined }) {
    const { t } = useLanguage()
    const { update } = useSession()
    const router = useRouter()
    const [leaving, setLeaving] = useState(false)
    if (!preview) return null

    const exit = async () => {
        setLeaving(true)
        await update({ previewRoleId: null })
        // Refreshed, so every screen reads the Super Admin's own session again.
        router.push(`/dashboard/companies/${preview.companyId}/settings`)
        router.refresh()
    }

    return (
        <PageNote tone="waiting" action={<Button onClick={exit} busy={leaving}>{t('preview_exit')}</Button>}>
            {t('preview_banner').replace('{role}', roleLabel({ name: preview.roleName, builtIn: preview.roleBuiltIn }, t)).replace('{company}', preview.companyName)}
        </PageNote>
    )
}

'use client'

import { useState } from 'react'
import { useSession } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import { useLanguage } from '@/context/LanguageContext'
import { roleLabel } from '@/lib/role-label'

/**
 * Shown on every screen while the Super Admin previews a role (ROLES_PLAN.md
 * §6.6): which role, where, that nothing can be changed, and the way out.
 */
export default function PreviewBanner({ preview }: { preview: { roleName: string; roleBuiltIn?: string | null; companyId: string; companyName: string } | null | undefined }) {
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
        <div role="status" style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap',
            padding: '0.75rem 1rem', marginBottom: '1rem', borderRadius: '0.75rem',
            background: 'var(--warn-bg)', border: '1px solid var(--warn-border)',
        }}>
            <span>👁️ {t('preview_banner').replace('{role}', roleLabel({ name: preview.roleName, builtIn: preview.roleBuiltIn }, t)).replace('{company}', preview.companyName)}</span>
            <button type="button" className="btn btn-primary" onClick={exit} disabled={leaving}>{t('preview_exit')}</button>
        </div>
    )
}

'use client'

import type { ReactNode } from 'react'
import { useLanguage } from '@/context/LanguageContext'
import { PageHeader } from '@/components/ui'
import { useModules } from '@/lib/useModules'

/**
 * The Costs page's header, the same on each of its tabs (DESIGN.md §5.5),
 * with the tab's main button: Mark all as paid on Employee costs.
 */
export default function CostsHeader({ action }: { action?: ReactNode }) {
    const { t } = useLanguage()
    const modules = useModules()
    return <PageHeader title={modules.label('costs')} subtitle={t('costs_subtitle')} action={action} />
}

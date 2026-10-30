'use client'

import { useLanguage } from '@/context/LanguageContext'
import { TabLinks } from '@/components/ui'
import type { TranslationKey } from '@/lib/translations'

export type CostsTab = 'employee' | 'charges' | 'advances'

const TABS: Record<CostsTab, { href: string; label: TranslationKey }> = {
    employee: { href: '/dashboard/costs', label: 'costs_tab_employee' },
    charges: { href: '/dashboard/costs?tab=charges', label: 'costs_tab_charges' },
    advances: { href: '/dashboard/costs?tab=advances', label: 'costs_tab_advances' },
}

/**
 * The Costs page's tabs: Employee costs, Charged to clients (CLIENTS_PLAN.md
 * §6.4) and Cash advances (§7.5), those this person sees.
 */
export default function CostsTabs({ current, tabs }: { current: CostsTab; tabs: CostsTab[] }) {
    const { t } = useLanguage()
    return (
        <TabLinks
            label={t('costs_tabs_label')}
            items={tabs.map(tab => ({ href: TABS[tab].href, label: t(TABS[tab].label), current: tab === current }))}
        />
    )
}

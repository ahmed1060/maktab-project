'use client'

import { useLanguage } from '@/context/LanguageContext'
import { TabLinks } from '@/components/ui'

/** The Costs page's tabs (CLIENTS_PLAN.md §6.4): Employee costs and Charged to clients. */
export default function CostsTabs({ current }: { current: 'employee' | 'charges' }) {
    const { t } = useLanguage()
    return (
        <TabLinks
            label={t('costs_tabs_label')}
            items={[
                { href: '/dashboard/costs', label: t('costs_tab_employee'), current: current === 'employee' },
                { href: '/dashboard/costs?tab=charges', label: t('costs_tab_charges'), current: current === 'charges' },
            ]}
        />
    )
}

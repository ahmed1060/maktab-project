'use client'

import { useEffect } from 'react'
import { useLanguage } from '@/context/LanguageContext'
import { useHeader } from '@/context/HeaderContext'
import { Page } from '@/components/ui'
import { useModules } from '@/lib/useModules'
import CostsTabs, { type CostsTab } from '@/components/charges/CostsTabs'
import CashAdvancesList from './CashAdvancesList'

/** The Costs page on its Cash advances tab (CLIENTS_PLAN.md §7.5), with the others for whoever sees them too. */
export default function CashAdvancesTab({ tabs }: { tabs: CostsTab[] }) {
    const { t } = useLanguage()
    const { setTitle, setSubtitle } = useHeader()
    const modules = useModules()
    useEffect(() => {
        setTitle(modules.label('costs'))
        setSubtitle(t('costs_subtitle'))
        return () => { setTitle(null); setSubtitle(null) }
    }, [setTitle, setSubtitle, t, modules])
    return (
        <Page>
            {tabs.length > 1 && <CostsTabs current="advances" tabs={tabs} />}
            <CashAdvancesList />
        </Page>
    )
}

'use client'

import { Page } from '@/components/ui'
import CostsHeader from '@/components/charges/CostsHeader'
import CostsTabs, { type CostsTab } from '@/components/charges/CostsTabs'
import CashAdvancesList from './CashAdvancesList'

/** The Costs page on its Cash advances tab (CLIENTS_PLAN.md §7.5), with the others for whoever sees them too. */
export default function CashAdvancesTab({ tabs }: { tabs: CostsTab[] }) {
    return (
        <Page>
            <CostsHeader />
            {tabs.length > 1 && <CostsTabs current="advances" tabs={tabs} />}
            <CashAdvancesList />
        </Page>
    )
}

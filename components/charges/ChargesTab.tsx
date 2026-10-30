'use client'

import { Page } from '@/components/ui'
import CostsHeader from './CostsHeader'
import CostsTabs, { type CostsTab } from './CostsTabs'
import ChargesList from './ChargesList'

/** The Costs page on its Charged to clients tab (CLIENTS_PLAN.md §6.4), with the others for whoever sees them too. */
export default function ChargesTab({ tabs }: { tabs: CostsTab[] }) {
    return (
        <Page>
            <CostsHeader />
            {tabs.length > 1 && <CostsTabs current="charges" tabs={tabs} />}
            <ChargesList />
        </Page>
    )
}

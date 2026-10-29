'use client'

import { useEffect } from 'react'
import { useLanguage } from '@/context/LanguageContext'
import { useHeader } from '@/context/HeaderContext'
import { Page } from '@/components/ui'
import { useModules } from '@/lib/useModules'
import CostsTabs from './CostsTabs'
import ChargesList from './ChargesList'

/** The Costs page on its Charged to clients tab (CLIENTS_PLAN.md §6.4), with the tabs for whoever also pays costs. */
export default function ChargesTab({ withTabs }: { withTabs: boolean }) {
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
            {withTabs && <CostsTabs current="charges" />}
            <ChargesList />
        </Page>
    )
}

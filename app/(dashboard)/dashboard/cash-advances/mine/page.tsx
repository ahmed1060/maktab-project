'use client'

import { HourglassIcon } from '@phosphor-icons/react/ssr'
import { useLanguage } from '@/context/LanguageContext'
import { EmptyState, Page, PageHeader } from '@/components/ui'
import CashAdvanceHistory from '@/components/cash-advances/CashAdvanceHistory'
import { useViewer } from '@/lib/useCan'

/** My cash advance (CLIENTS_PLAN.md §7.5, UI_PLAN.md §2.1): everyone's own, with Confirm receipt (§7.3). */
export default function MyCashAdvancePage() {
    const { t } = useLanguage()
    const viewer = useViewer()
    // Whose it is comes with the page, from the layout, so this is a moment
    // at most: in the frame its history shows while it loads, so nothing
    // moves when it comes (PR 190).
    if (!viewer?.id) return (
        <Page>
            <PageHeader title={t('my_cash_advance')} />
            <div className="ui-panel" role="status"><EmptyState icon={HourglassIcon} title={t('advances_loading')} /></div>
        </Page>
    )
    return <CashAdvanceHistory userId={viewer.id} mine />
}

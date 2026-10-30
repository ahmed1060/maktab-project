'use client'

import LoadingSpinner from '@/components/LoadingSpinner'
import CashAdvanceHistory from '@/components/cash-advances/CashAdvanceHistory'
import { useViewer } from '@/lib/useCan'

/** My cash advance (CLIENTS_PLAN.md §7.5, UI_PLAN.md §2.1): everyone's own, with Confirm receipt (§7.3). */
export default function MyCashAdvancePage() {
    const viewer = useViewer()
    if (!viewer?.id) return <LoadingSpinner />
    return <CashAdvanceHistory userId={viewer.id} mine />
}

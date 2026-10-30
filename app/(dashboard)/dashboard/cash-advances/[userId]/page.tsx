'use client'

import { useParams } from 'next/navigation'
import CashAdvanceHistory from '@/components/cash-advances/CashAdvanceHistory'

/** One person's cash advance (CLIENTS_PLAN.md §7.5), from the Costs page's Cash advances tab. */
export default function PersonCashAdvancePage() {
    const { userId } = useParams<{ userId: string }>()
    return <CashAdvanceHistory userId={userId} />
}

import { guardModule } from "@/lib/features/guard"

// Cash advances pay task costs (CLIENTS_PLAN.md §7), so they're the Costs
// module's, as the Costs page is. Gated at the layout, as there.
export default async function CashAdvancesLayout({ children }: { children: React.ReactNode }) {
    const locked = await guardModule('COSTS')
    return locked ?? <>{children}</>
}

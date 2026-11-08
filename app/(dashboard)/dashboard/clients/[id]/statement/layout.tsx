import { guardModule } from "@/lib/features/guard"

// A client's statement lists its charges, which are the Costs module's (CLIENTS_PLAN.md §6.9),
// so it's gated as the Costs page is, under the Clients layout's own gate.
export default async function ClientStatementLayout({ children }: { children: React.ReactNode }) {
    const locked = await guardModule('COSTS')
    return locked ?? <>{children}</>
}

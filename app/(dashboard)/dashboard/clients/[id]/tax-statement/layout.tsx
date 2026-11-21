import { guardModule } from "@/lib/features/guard"

// A client's tax position statement is the client portal's, as its Tax position
// is (CLIENT_PORTAL_PLAN.md §8, PR 353), so it's gated as that is, under the
// Clients layout's own gate.
export default async function ClientTaxStatementLayout({ children }: { children: React.ReactNode }) {
    const locked = await guardModule('TAX_POSITION')
    return locked ?? <>{children}</>
}

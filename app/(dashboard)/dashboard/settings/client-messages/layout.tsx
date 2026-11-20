import { guardModule } from "@/lib/features/guard"

// Gated at the layout, as the other modules' pages are: a company's client
// message's editor is the client portal's (CLIENT_PORTAL_PLAN.md §7.1, PR 349),
// so a company whose package hasn't it is refused by its address too.
export default async function CompanyMessagesLayout({ children }: { children: React.ReactNode }) {
    const locked = await guardModule('TAX_POSITION')
    return locked ?? <>{children}</>
}

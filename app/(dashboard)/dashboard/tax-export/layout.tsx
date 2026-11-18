import { guardModule } from "@/lib/features/guard"

// Gated at the layout rather than inside the page, as the other modules'
// pages are: the page is a Client Component and can't read the session on
// the server. The tax portal's export button makes the file a client's Tax
// position takes, so it's the client portal's (CLIENT_PORTAL_PLAN.md §10).
export default async function TaxExportLayout({ children }: { children: React.ReactNode }) {
    const locked = await guardModule('TAX_POSITION')
    return locked ?? <>{children}</>
}

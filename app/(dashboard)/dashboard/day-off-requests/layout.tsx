import { guardModule } from "@/lib/features/guard"

// Gated at the layout rather than inside the page: the page is a Client
// Component and cannot read the session server-side, and a client-side check
// would render the real screen for an instant before replacing it.
export default async function DAYOFFLayout({ children }: { children: React.ReactNode }) {
    const locked = await guardModule('DAY_OFF')
    return locked ?? <>{children}</>
}

import { guardModule } from "@/lib/features/guard"

// Gated at the layout, like every other module's pages, so a company without
// either attendance add-on gets the locked screen before any page under here
// renders. In place before the first page, so that page cannot ship without it.
export default async function AttendanceLayout({ children }: { children: React.ReactNode }) {
    const locked = await guardModule('ATTENDANCE')
    return locked ?? <>{children}</>
}

import { guardModule } from "@/lib/features/guard"

// Gated at the layout, as the other modules' pages are: the terminals' guide
// is attendance's (ATTENDANCE_PLAN.md §17.7, PR 356), so a company whose
// package hasn't it is refused by its address too.
export default async function TerminalGuideLayout({ children }: { children: React.ReactNode }) {
    const locked = await guardModule('ATTENDANCE')
    return locked ?? <>{children}</>
}

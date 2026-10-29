import { guardModule } from "@/lib/features/guard"

// Gated at the layout rather than inside the page: the page is a Client
// Component and cannot read the session server-side, and a client-side check
// would render the real screen for an instant before replacing it. The saved
// lists are of task titles and their costs' names, so part of Tasks.
export default async function SavedListsLayout({ children }: { children: React.ReactNode }) {
    const locked = await guardModule('TASKS')
    return locked ?? <>{children}</>
}

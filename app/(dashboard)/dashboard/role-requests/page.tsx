import { redirect } from "next/navigation"

/**
 * Role requests are asked for on a person's profile and decided on the one
 * Requests page now (UI_PLAN.md §2.3, part 5b): an old link here lands on
 * them there, with the request it picked out. The page decides the tab:
 * those one asked for on Mine, the rest under To review. This page's other
 * two tabs, asking the Super Admin to change a role and access reviews, are
 * on Roles and access (decided on 2026-10-31).
 */
export default async function RoleRequestsPage(props: { searchParams: Promise<{ tab?: string; highlight?: string }> }) {
    const { tab, highlight } = await props.searchParams
    const picked: Record<string, string> = highlight ? { highlight } : {}
    if (tab === 'changes' || tab === 'reviews') redirect(`/dashboard/roles-and-access?${new URLSearchParams({ tab, ...picked })}`)
    redirect(`/dashboard/requests?${new URLSearchParams({ kind: 'role', ...picked })}`)
}

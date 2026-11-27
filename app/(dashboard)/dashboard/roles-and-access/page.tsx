import { getServerSession } from "next-auth"
import { redirect } from "next/navigation"
import { authOptions } from "@/lib/auth"
import { SESSION_ENDED_PATH } from "@/lib/session-ended"
import { accountRefusal } from "@/lib/account-refusal"
import { can } from "@/lib/permissions/can"
import AccessDenied from "@/components/AccessDenied"
import type { Viewer } from "@/lib/requests/feed"
import { rolesAndAccessTabs, rolesAndAccessTab } from "@/lib/roles-and-access"
import RolesAndAccessClient from "./RolesAndAccessClient"

/**
 * Roles and access (UI_PLAN.md §2.3, part 5b): what the Role requests page
 * held besides role requests, which are on the one Requests page now. Asking
 * the Super Admin to change a role (ROLES_PLAN.md §6.9), for whoever gives
 * roles there, and the company's access reviews (§6.14), for whoever answers
 * them (LATER_CHANGES_PLAN.md §7.15, PR 439): each tab for whoever holds its
 * permission, the page for whoever holds either. The Super Admin answers both
 * from their own pages.
 */
export default async function RolesAndAccessPage(props: { searchParams: Promise<{ tab?: string; highlight?: string }> }) {
    const session = await getServerSession(authOptions)
    if (!session) redirect(SESSION_ENDED_PATH)
    const viewer = session.user as unknown as Viewer
    const tabs = rolesAndAccessTabs(p => can(viewer, p))
    if (accountRefusal(viewer) || viewer.role === "SUPER_ADMIN" || tabs.length === 0) return <AccessDenied />
    const { tab, highlight } = await props.searchParams
    return <RolesAndAccessClient tabs={tabs} tab={rolesAndAccessTab(tab, tabs)} highlight={highlight ?? null} />
}

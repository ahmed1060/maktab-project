import { getServerSession } from "next-auth"
import { redirect } from "next/navigation"
import { authOptions } from "@/lib/auth"
import { accountRefusal } from "@/lib/account-refusal"
import { can } from "@/lib/permissions/can"
import AccessDenied from "@/components/AccessDenied"
import type { Viewer } from "@/lib/requests/feed"
import RolesAndAccessClient from "./RolesAndAccessClient"

/**
 * Roles and access (UI_PLAN.md §2.3, part 5b): what the Role requests page
 * held besides role requests, which are on the one Requests page now. Asking
 * the Super Admin to change a role (ROLES_PLAN.md §6.9), and the company's
 * access reviews (§6.14), for whoever gives roles there, as those tabs were.
 * The Super Admin answers both from their own pages.
 */
export default async function RolesAndAccessPage(props: { searchParams: Promise<{ tab?: string; highlight?: string }> }) {
    const session = await getServerSession(authOptions)
    if (!session) redirect("/login")
    const viewer = session.user as unknown as Viewer
    if (accountRefusal(viewer) || viewer.role === "SUPER_ADMIN" || !can(viewer, "employees.assign_role")) return <AccessDenied />
    const { tab, highlight } = await props.searchParams
    return <RolesAndAccessClient tab={tab === "reviews" ? "reviews" : "changes"} highlight={highlight ?? null} />
}

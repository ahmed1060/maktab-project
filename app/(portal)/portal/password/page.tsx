import { getServerSession } from "next-auth"
import { redirect } from "next/navigation"
import { authOptions } from "@/lib/auth"
import { isClientAccount } from "@/lib/client-session"
import { SESSION_ENDED_PATH } from "@/lib/session-ended"
import { PortalPassword } from "@/components/portal/PortalPassword"

export const dynamic = 'force-dynamic'

/**
 * Change password in the client's area (CLIENT_PORTAL_PLAN.md §5.3, §12 step
 * 7d-2; PR 335), from its account menu. Whose password it is, is the
 * session's, never the address's.
 */
export default async function PortalPasswordPage() {
    const session = await getServerSession(authOptions)
    // As the area's first page (../page.tsx): an ended session to sign in,
    // and the company's people and Super Admins on to their own app.
    if (!session) redirect(SESSION_ENDED_PATH)
    if (!isClientAccount(session.user)) redirect('/dashboard')

    return <PortalPassword />
}

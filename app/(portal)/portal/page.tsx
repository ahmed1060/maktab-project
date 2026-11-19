import { getServerSession } from "next-auth"
import { redirect } from "next/navigation"
import { authOptions } from "@/lib/auth"
import { isClientAccount } from "@/lib/client-session"
import { SESSION_ENDED_PATH } from "@/lib/session-ended"
import { PortalHome } from "@/components/portal/PortalHome"

export const dynamic = 'force-dynamic'

/**
 * The client's area's first page (CLIENT_PORTAL_PLAN.md §5.3, §12 step 7b;
 * PR 332). Its client is the session's, never the address's.
 */
export default async function PortalPage() {
    const session = await getServerSession(authOptions)
    // Only a session the server has ended gets here without one: proxy.ts
    // lets no one into the client's area without a token. Its cookie is
    // cleared on the way to sign in (lib/session-ended.ts).
    if (!session) redirect(SESSION_ENDED_PATH)
    // proxy.ts sends the company's people and Super Admins on already.
    if (!isClientAccount(session.user)) redirect('/dashboard')

    return <PortalHome client={session.user.clientName ?? ''} />
}

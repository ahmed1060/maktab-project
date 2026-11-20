import { getServerSession } from "next-auth"
import { redirect } from "next/navigation"
import { authOptions } from "@/lib/auth"
import { isClientAccount } from "@/lib/client-session"
import { SESSION_ENDED_PATH } from "@/lib/session-ended"
import { portalTaxPosition } from "@/lib/services/tax-claim.service"
import { portalAccountant } from "@/lib/services/client-accountant.service"
import { PortalHome } from "@/components/portal/PortalHome"

export const dynamic = 'force-dynamic'

/**
 * The client's area's first page, its tax position (CLIENT_PORTAL_PLAN.md
 * §5.3, §6, §12 steps 7b and 8c; PRs 332 and 338). Its client is the
 * session's, never the address's, and so are its figures: read only where
 * that client is the session's company's (portalTaxPosition, PR 336).
 *
 * Then who its people can write to (step 9c, PR 344): the accountant's name
 * and number alone, as what's given to the page reaches the browser.
 */
export default async function PortalPage() {
    const session = await getServerSession(authOptions)
    // Only a session the server has ended gets here without one: proxy.ts
    // lets no one into the client's area without a token. Its cookie is
    // cleared on the way to sign in (lib/session-ended.ts).
    if (!session) redirect(SESSION_ENDED_PATH)
    // proxy.ts sends the company's people and Super Admins on already.
    if (!isClientAccount(session.user)) redirect('/dashboard')

    const { companyId, clientId } = session.user
    const position = await read(companyId, clientId)
    // A client deleted since the session's last check (lib/auth.ts, every
    // minute) has ended it already: it goes the way an ended session does.
    if (!position || !clientId) redirect(SESSION_ENDED_PATH)
    const accountant = await portalAccountant(clientId)

    return <PortalHome client={session.user.clientName ?? ''} person={session.user.name ?? ''} position={position} accountant={accountant} />
}

async function read(companyId: string | null | undefined, clientId: string | null | undefined) {
    if (!companyId || !clientId) return null
    try {
        return await portalTaxPosition({ companyId, clientId })
    } catch (e) {
        if (e instanceof Error && e.message === "CLIENT_NOT_FOUND") return null
        throw e
    }
}

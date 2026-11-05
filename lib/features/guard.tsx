import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import AccessDenied from "@/components/AccessDenied"
import { FeatureAccessService } from "@/lib/services/feature-access.service"
import { requireFeature } from "./require"
import { type Module } from "./bundles"

/**
 * Wraps a module's page. Where the company's package doesn't include it, the
 * page says it can't be opened, and why (DESIGN.md §5.5), and the attempt is
 * recorded on the way. It isn't in the side bar (DESIGN.md §5.1), so this is
 * someone who typed or kept its address.
 *
 * It was a locked screen naming the bundle to buy, the side bar's faded entry
 * leading to it, as the way to find out what else the product does: decided
 * otherwise by the product owner on 2026-11-05.
 *
 * Server-side, in the page itself, rather than in middleware: middleware would
 * have to read the package on every navigation, and the session already carries
 * it here for free.
 */
export async function guardModule(module: Module): Promise<React.ReactNode | null> {
    const session = await getServerSession(authOptions)
    const decision = requireFeature(session, module, { onDeny: 'lock' })
    if (decision.allowed) return null

    // Fire-and-forget: a failure to record a sales signal must never turn into
    // a failed page for somebody who is already being told they cannot proceed.
    void FeatureAccessService.recordAttempt((session?.user as any)?.companyId, module)

    return <AccessDenied notInPackage />
}

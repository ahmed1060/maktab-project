import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import LockedModule from "@/components/LockedModule"
import { FeatureAccessService } from "@/lib/services/feature-access.service"
import { requireFeature } from "./require"
import { type Module } from "./bundles"

/**
 * Wraps a module's page. Returns the locked screen instead of the page when the
 * company's package does not include it, and records the attempt on the way.
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

    return <LockedModule module={module} />
}

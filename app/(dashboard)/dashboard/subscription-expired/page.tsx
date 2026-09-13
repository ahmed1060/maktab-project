import { getServerSession } from "next-auth"
import { redirect } from "next/navigation"
import { authOptions } from "@/lib/auth"
import SubscriptionExpired from "@/components/SubscriptionExpired"

/**
 * Where a locked company's Admin lands.
 *
 * Everyone else is stopped at login, so this page only ever has one audience:
 * the person who can renew. It exists because locking that person out too would
 * leave the account with nobody able to fix it.
 */
export default async function SubscriptionExpiredPage() {
    const session = await getServerSession(authOptions)
    const subscription = session?.user?.subscription

    // Not locked — nothing to see. Redirect rather than render a stale warning:
    // arriving here after renewing should feel like the problem is gone.
    if (!subscription || subscription.state !== 'LOCKED') {
        redirect('/dashboard')
    }

    return <SubscriptionExpired lockedOn={subscription.date} />
}

import { getServerSession } from "next-auth"
import { redirect } from "next/navigation"
import UserHeartbeat from "@/components/UserHeartbeat"
import { authOptions } from "@/lib/auth"
import DashboardShell from "@/components/DashboardShell"
import { SystemSettingsService } from "@/lib/services/system-settings.service"

import { Suspense } from "react"
import DashboardErrorBoundary from "@/components/DashboardErrorBoundary"

export const dynamic = 'force-dynamic'

export default async function DashboardLayout({
    children,
}: {
    children: React.ReactNode
}) {
    const session = await getServerSession(authOptions)
    if (!session) {
        redirect('/login')
    }

    // Pass user object to Shell (strip sensitive fields if cleaner, but session user is usually safe for client)
    const user = session.user

    // Read per request rather than carried on the session JWT. This layout is
    // already force-dynamic, so it costs one primary-key lookup on a single-row
    // table — and the toggle then takes effect on the very next navigation
    // instead of whenever the token next refreshes, which is what somebody
    // flipping a switch mid-demo expects. It also keeps this out of lib/auth.ts.
    const { showPoweredBy, poweredByName } = await SystemSettingsService.get()

    return (
        <DashboardShell user={user} showPoweredBy={showPoweredBy} poweredByName={poweredByName}>
            <UserHeartbeat />
            <DashboardErrorBoundary>
                <Suspense fallback={<div className="p-8 text-center opacity-50">Loading section...</div>}>
                    {children}
                </Suspense>
            </DashboardErrorBoundary>
        </DashboardShell>
    )
}

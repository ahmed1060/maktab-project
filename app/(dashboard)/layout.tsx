import { getServerSession } from "next-auth"
import { redirect } from "next/navigation"
import UserHeartbeat from "@/components/UserHeartbeat"
import { authOptions } from "@/lib/auth"
import DashboardShell from "@/components/DashboardShell"

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

    return (
        <DashboardShell user={user}>
            <UserHeartbeat />
            <DashboardErrorBoundary>
                <Suspense fallback={<div className="p-8 text-center opacity-50">Loading section...</div>}>
                    {children}
                </Suspense>
            </DashboardErrorBoundary>
        </DashboardShell>
    )
}

import { getServerSession } from "next-auth"
import { redirect } from "next/navigation"
import UserHeartbeat from "@/components/UserHeartbeat"
import { authOptions } from "@/lib/auth"
import DashboardShell from "@/components/DashboardShell"
import { ViewerProvider } from "@/lib/useCan"
import { SystemSettingsService } from "@/lib/services/system-settings.service"
import { CompanyService } from "@/lib/services/company.service"
import { SCOPED_COMPANY_COOKIE, scopedCompanyId } from "@/lib/company-scope"
import { CompanyBrandingProvider } from "@/context/CompanyBrandingContext"
import { cookies } from "next/headers"

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

    // §7.5 rule 1. A Super Admin scoped to one company sees that company's
    // module names, icons and logo; everyone else reads their own session, and
    // a Super Admin on All Companies reads the defaults — rule 2, do not
    // customise a screen that is showing everybody.
    //
    // Read from a cookie rather than from the selection in CompanyContext,
    // because a layout cannot see search params and localStorage does not exist
    // until the client has mounted. Resolved here, once, and handed to the whole
    // tree so nothing below has to ask again and get a different answer.
    //
    // scopedCompanyId does the role check. The cookie is written by the browser
    // and can say anything, so what stops it mattering is that it is ignored for
    // anyone who is not a Super Admin — and a Super Admin can already see every
    // company, so it grants nothing they did not have.
    // cookies() is async since Next 15.
    const cookieStore = await cookies()
    const scopeId = scopedCompanyId(user.role, cookieStore.get(SCOPED_COMPANY_COOKIE)?.value)
    const scopedBranding = scopeId ? await CompanyService.getBranding(scopeId) : null

    return (
        <CompanyBrandingProvider value={scopedBranding}>
        {/* Who is looking, grants included, for every screen's useCan() on
            its first paint — before the session hook has loaded. */}
        <ViewerProvider viewer={user as any}>
        <DashboardShell user={user} showPoweredBy={showPoweredBy} poweredByName={poweredByName}>
            <UserHeartbeat />
            <DashboardErrorBoundary>
                <Suspense fallback={<div className="p-8 text-center opacity-50">Loading section...</div>}>
                    {children}
                </Suspense>
            </DashboardErrorBoundary>
        </DashboardShell>
        </ViewerProvider>
        </CompanyBrandingProvider>
    )
}

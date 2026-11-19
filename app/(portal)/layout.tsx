import { getServerSession } from "next-auth"
import DashboardErrorBoundary from "@/components/DashboardErrorBoundary"
import { PortalTopBar } from "@/components/portal/PortalTopBar"
import { authOptions } from "@/lib/auth"
import { brandStyleSheet } from "@/lib/brand-colour"
import { portalFrame } from "@/lib/client-portal-frame"

export const dynamic = 'force-dynamic'

/**
 * The client's area (DESIGN.md §5.5; CLIENT_PORTAL_PLAN.md §5.3, §6): where
 * one of a client's people lands after signing in. None of the company's
 * app's frame: a top bar alone, with the company's mark and name, the
 * language switch and the account menu (PR 334), over pages up to 1180px
 * wide and centred, on the page colour, all in the company's brand colour.
 * proxy.ts keeps everyone else out, and a client account in (PR 331); a page
 * sends on anyone else who gets here, so they're drawn no top bar.
 */
export default async function PortalLayout({ children }: { children: React.ReactNode }) {
    const session = await getServerSession(authOptions)
    const viewer = session?.user
    const frame = await portalFrame(viewer)

    return (
        <>
            {/* After the root layout's default in the page, so it wins, as the
                dashboard layout draws a company's own colour (lib/page-brand-colour.ts).
                Moving between the sign-in page and the area draws this layout
                afresh, so signing out leaves the colour behind. */}
            {frame?.brand && <style id="company-brand-colour" dangerouslySetInnerHTML={{ __html: brandStyleSheet(frame.brand) }} />}
            <div className="ui-portal">
                {frame && viewer && (
                    <PortalTopBar company={frame.company} person={{ name: viewer.name ?? '', client: viewer.clientName ?? '' }} />
                )}
                <DashboardErrorBoundary standalone>
                    <main id="main-content" className="ui-portal-page">{children}</main>
                </DashboardErrorBoundary>
            </div>
        </>
    )
}

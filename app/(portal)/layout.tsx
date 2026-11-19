import DashboardErrorBoundary from "@/components/DashboardErrorBoundary"

/**
 * The client's area (DESIGN.md §5.5; CLIENT_PORTAL_PLAN.md §5.3, §6): where
 * one of a client's people lands after signing in. None of the company's
 * app's frame: its pages up to 1180px wide and centred, on the page colour.
 * Its top bar, with the company's mark, the language switch and the account
 * menu, is step 7d. proxy.ts keeps everyone else out, and a client account
 * in (PR 331).
 */
export default function PortalLayout({ children }: { children: React.ReactNode }) {
    return (
        <div className="ui-portal">
            <DashboardErrorBoundary standalone>
                <main id="main-content" className="ui-portal-page">{children}</main>
            </DashboardErrorBoundary>
        </div>
    )
}

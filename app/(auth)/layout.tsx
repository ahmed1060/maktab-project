import DashboardErrorBoundary from "@/components/DashboardErrorBoundary"

// The dashboard route group already wraps its own children in this same
// boundary (see (dashboard)/layout.tsx) — the login/auth pages had none at
// all, so a render crash here fell straight through to Next's raw default
// error screen instead of the app's own friendly one. The component isn't
// actually dashboard-specific in behavior, just in name. These pages have no
// side bar, so a page that broke has the whole screen (DESIGN.md §5.5).
export default function AuthLayout({
    children,
}: {
    children: React.ReactNode
}) {
    return (
        <DashboardErrorBoundary standalone>
            {children}
        </DashboardErrorBoundary>
    )
}

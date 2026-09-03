import DashboardErrorBoundary from "@/components/DashboardErrorBoundary"

// The dashboard route group already wraps its own children in this same
// boundary (see (dashboard)/layout.tsx) — the login/auth pages had none at
// all, so a render crash here fell straight through to Next's raw default
// error screen instead of the app's own friendly one. The component isn't
// actually dashboard-specific in behavior, just in name.
export default function AuthLayout({
    children,
}: {
    children: React.ReactNode
}) {
    return (
        <DashboardErrorBoundary>
            {children}
        </DashboardErrorBoundary>
    )
}

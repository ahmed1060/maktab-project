import DashboardErrorBoundary from "@/components/DashboardErrorBoundary"
import { SignatureSettingProvider } from "@/components/PoweredBy"
import { pageSystemSettings } from "@/lib/services/system-settings.service"

// The dashboard route group already wraps its own children in this same
// boundary (see (dashboard)/layout.tsx) — the login/auth pages had none at
// all, so a render crash here fell straight through to Next's raw default
// error screen instead of the app's own friendly one. The component isn't
// actually dashboard-specific in behavior, just in name. These pages have no
// side bar, so a page that broke has the whole screen (DESIGN.md §5.5).
//
// The "Powered by" signature is on these pages too, as System settings has it
// (DESIGN.md §5.1, decided 2026-11-08): read once per page, with the brand
// colour the root layout reads (lib/page-brand-colour.ts), and drawn by the
// sign-in screen (components/sign-in/SignInScreen.tsx).
export default async function AuthLayout({
    children,
}: {
    children: React.ReactNode
}) {
    const { showPoweredBy, poweredByName } = await pageSystemSettings()
    return (
        <SignatureSettingProvider show={showPoweredBy} name={poweredByName}>
            <DashboardErrorBoundary standalone>
                {children}
            </DashboardErrorBoundary>
        </SignatureSettingProvider>
    )
}

import { describe, it, expect, vi, beforeEach } from "vitest"
import { createElement as h } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { readFileSync } from "node:fs"
import { ar } from "./translations/ar"
import { en } from "./translations/en"

/**
 * The "Powered by" signature on the sign-in page (DESIGN.md §5.1; §5.5,
 * Sign-in), as the product owner asked on 2026-11-08: it was only in the
 * dashboard, so the first page anyone sees didn't have it. The same mark, in
 * the same places, and System settings' switch and name apply to it too.
 */

const state = { locale: "en" as "en" | "ar" }
vi.mock("@/context/LanguageContext", () => ({
    useLanguage: () => ({ locale: state.locale, t: (key: string) => ((state.locale === "ar" ? ar : en) as Record<string, string>)[key] ?? key }),
}))
vi.mock("@/context/ThemeContext", () => ({ useTheme: () => ({ theme: "light", setTheme: () => {} }) }))
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {}, refresh: () => {} }), usePathname: () => "/login", useSearchParams: () => new URLSearchParams() }))
beforeEach(() => { state.locale = "en" })

const source = (path: string) => readFileSync(path, "utf8")
const MARK = (name: string, by = en.powered_by) => `<div class="floating-attribution"><span class="floating-attribution-by">${by}</span><span class="floating-attribution-name" translate="no">${name}</span></div>`

const screen = async (setting?: { show: boolean; name?: string | null }) => {
    const { SignInScreen } = await import("@/components/sign-in/SignInScreen")
    const { SignatureSettingProvider } = await import("@/components/PoweredBy")
    const page = h(SignInScreen, { title: "Sign in to Nizmo", children: h("form") } as never)
    return renderToStaticMarkup(setting ? h(SignatureSettingProvider, { ...setting, children: page } as never) : page)
}

describe("the sign-in page's signature", () => {
    it("is the dashboard's mark, at the end of the page, under the links and switches", async () => {
        const html = await screen({ show: true, name: "SHSD" })
        expect(html).toContain(MARK("SHSD"))
        // The last thing in the page: after the row of links and switches, so
        // on a phone it's at the end of the page, as the dashboard's is.
        expect(html.indexOf(MARK("SHSD"))).toBeGreaterThan(html.indexOf('<footer class="ui-signin-foot">'))
        expect(html.endsWith(`${MARK("SHSD")}</div>`)).toBe(true)
    })

    it("shows the name set in System settings, and the default for one left empty", async () => {
        expect(await screen({ show: true, name: "Acme Labs" })).toContain(MARK("Acme Labs"))
        const { DEFAULT_POWERED_BY_NAME } = await import("@/lib/branding-defaults")
        expect(await screen({ show: true, name: "  " })).toContain(MARK(DEFAULT_POWERED_BY_NAME))
        expect(await screen({ show: true, name: null })).toContain(MARK(DEFAULT_POWERED_BY_NAME))
    })

    it("is in the page's language", async () => {
        state.locale = "ar"
        expect(await screen({ show: true, name: "SHSD" })).toContain(MARK("SHSD", ar.powered_by))
    })

    it("isn't there when System settings switches it off, nor where nothing says it's on", async () => {
        expect(await screen({ show: false, name: "SHSD" })).not.toContain("floating-attribution")
        expect(await screen()).not.toContain("floating-attribution")
    })

    it("follows System settings, read where the dashboard reads them, at no cost of its own", () => {
        const layout = source("app/(auth)/layout.tsx")
        expect(layout).toContain("const { showPoweredBy, poweredByName } = await pageSystemSettings()")
        expect(layout).toMatch(/<SignatureSettingProvider show=\{showPoweredBy\} name=\{poweredByName\}>/)
        // The root layout reads them for the brand colour on every page, once
        // per page (lib/page-brand-colour.ts).
        expect(source("lib/services/system-settings.service.ts")).toContain("export const pageSystemSettings = cache(() => SystemSettingsService.get())")
    })

    it("is drawn by the same component as the dashboard's, so it looks the same", () => {
        expect(source("components/sign-in/SignInScreen.tsx")).toContain("<SignInSignature />")
        expect(source("components/DashboardShell.tsx")).toContain("{showPoweredBy && <PoweredBy name={poweredByName} />}")
    })
})

import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { stripComments } from "./strip-comments"
import { updateCompanySchema } from "./validations/company.schema"
import { updateSystemSettingsSchema } from "./validations/system-settings.schema"
import { settingsTab } from "./company-settings-tabs"
import { maySetField } from "./company-settings-access"
import { ownColour, usableDefault } from "./page-brand-colour"
import { BRAND_PRESETS, DEFAULT_BRAND, brandStyleSheet } from "./brand-colour"
import { createElement as h } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { ColourChoice } from "@/components/ui/ColourChoice"
import { en } from "@/lib/translations/en"
import { ar } from "@/lib/translations/ar"

/**
 * The brand colour setting (UI_PLAN.md §4.6): the Super Admin's default in
 * System Settings, a company's own in Company Settings → Branding, and the
 * page opening in the colour its viewer should see.
 */

describe("the brand colour can be set", () => {
    it("takes a company's colour as #rrggbb in lower case, or null for the default", () => {
        const ok = updateCompanySchema.safeParse({ id: "c1", brandColour: "#2563EB" })
        expect(ok.success && ok.data.brandColour).toBe("#2563eb")
        const reset = updateCompanySchema.safeParse({ id: "c1", brandColour: null })
        expect(reset.success && reset.data.brandColour).toBeNull()
        for (const bad of ["blue", "#12345", "", "rgb(1,2,3)", 7]) {
            expect(updateCompanySchema.safeParse({ id: "c1", brandColour: bad }).success, String(bad)).toBe(false)
        }
    })

    it("takes the default the same way, and never empty: the default is a colour", () => {
        const ok = updateSystemSettingsSchema.safeParse({ brandColour: "#0D9488" })
        expect(ok.success && ok.data.brandColour).toBe("#0d9488")
        for (const bad of [null, "", "teal", "#0d948"]) {
            expect(updateSystemSettingsSchema.safeParse({ brandColour: bad }).success, String(bad)).toBe(false)
        }
    })

    it("is a Branding tab field, which the company's people set when they're shown that tab", () => {
        expect(settingsTab("branding")?.fields).toContain("brandColour")
        expect(settingsTab("branding")?.adminEligible).toBe(true)
        // The logo's rule: the Super Admin always, the company's people when shown the tab.
        expect(maySetField({ role: "ADMIN" } as any, "branding", "brandColour")).toBe(true)
        expect(maySetField({ role: "SUPER_ADMIN" } as any, "branding", "brandColour")).toBe(true)
    })

    it("is written and audited, for a company and for the default", () => {
        const service = stripComments(readFileSync("lib/services/company.service.ts", "utf8"))
        expect(service).toContain("...(brandColour !== undefined && { brandColour })")
        expect(service).toContain("changes.brandColour = { old: existing.brandColour, new: brandColour }")
        const system = stripComments(readFileSync("app/api/system-settings/route.ts", "utf8"))
        expect(system).toContain("changes.brandColour = { old: before.brandColour, new: updated.brandColour }")
        expect(en.audit_field_brandColour).toBe("Brand colour")
        expect((ar as Record<string, string>).audit_field_brandColour).toBeTruthy()
    })
})

describe("the colour a page opens in", () => {
    const system = "#0d9488"

    it("is the company's own for its people, or the default if it has none", () => {
        expect(ownColour({ role: "EMPLOYEE", companyId: "c1" }, "#2563eb")).toBe("#2563eb")
        expect(ownColour({ role: "ADMIN", companyId: "c1" }, null)).toBeNull()
        expect(usableDefault(system)).toBe(system)
    })

    it("is the default on the sign-in page and the Super Admin's pages", () => {
        expect(ownColour(null, "#2563eb")).toBeNull()
        expect(ownColour({ role: "SUPER_ADMIN", companyId: null }, "#2563eb")).toBeNull()
        expect(ownColour({ role: "SUPER_ADMIN", companyId: "c1" }, "#2563eb")).toBeNull()
    })

    it("is Nizmo's indigo if nothing usable is stored", () => {
        expect(usableDefault(null)).toBe(DEFAULT_BRAND)
        expect(usableDefault("nor this")).toBe(DEFAULT_BRAND)
        expect(ownColour({ role: "EMPLOYEE", companyId: "c1" }, "not a colour")).toBeNull()
    })

    // Next.js doesn't draw the root layout again when the app moves to
    // another page without a reload. Signing out from the account menu moves
    // to the sign-in page that way, so a viewer's colour drawn there stayed
    // on the sign-in page after they'd gone.
    it("puts the default in every page from the root layout, the same whoever is signed in", () => {
        const layout = stripComments(readFileSync("app/layout.tsx", "utf8"))
        expect(layout).toContain("const brand = await defaultBrandColour()")
        expect(layout).toContain('<style id="brand-colour" dangerouslySetInnerHTML={{ __html: brandStyleSheet(brand) }} />')
        expect(layout).not.toContain("getServerSession")
        expect(layout).not.toContain("companyBrandColour")
    })

    it("puts a company's own over it from the dashboard layout, drawn afresh on signing in or out", () => {
        const layout = stripComments(readFileSync("app/(dashboard)/layout.tsx", "utf8"))
        expect(layout).toContain("const ownBrand = ownColour(user, exposure?.brandColour)")
        const style = layout.indexOf('{ownBrand && <style id="company-brand-colour" dangerouslySetInnerHTML={{ __html: brandStyleSheet(ownBrand) }} />}')
        expect(style).toBeGreaterThan(-1)
        // Before the shell, so the shell opens in it.
        expect(style).toBeLessThan(layout.indexOf("<DashboardShell"))
        // The sign-in pages draw none, so the default shows once the dashboard's is gone.
        expect(readFileSync("app/(auth)/layout.tsx", "utf8")).not.toContain("brandStyleSheet")
    })
})

describe("the colour choice (DESIGN.md §5.3)", () => {
    const render = (props: Partial<Parameters<typeof ColourChoice>[0]> = {}) => renderToStaticMarkup(h(ColourChoice, {
        legend: "Colour", value: "#2563eb", onChange: () => {},
        swatches: [{ value: "#6366f1", label: "Indigo" }, { value: "#2563eb", label: "Blue" }],
        codeLabel: "Colour code", invalidCode: "That isn't a colour code.",
        ...props,
    }))

    it("is round swatches, each a radio button named by its colour, under a visible group label", () => {
        const html = render()
        expect(html).toContain('<legend class="ui-label">Colour</legend>')
        expect(html.match(/type="radio"/g)).toHaveLength(2)
        expect(html).toContain('<span class="ui-visually-hidden">Indigo</span>')
        expect(html).toContain('style="--swatch:#2563eb"')
        // The chosen one is checked, and the code field shows it.
        expect(html).toMatch(/<input type="radio"[^>]*checked=""[^>]*\/><span class="ui-swatch" style="--swatch:#2563eb"/)
        expect(html).toContain('value="#2563eb"')
    })

    it("puts \"Use the default\" first where there's one, chosen when the value is null", () => {
        const html = render({ value: null, defaultOption: { label: "Use the default", colour: "#6366f1" } })
        expect(html.match(/type="radio"/g)).toHaveLength(3)
        expect(html.indexOf("Use the default")).toBeLessThan(html.indexOf("Indigo"))
        expect(html).toMatch(/<label class="ui-swatch-option ui-swatch-default"><input type="radio"[^>]*checked=""/)
    })

    it("reads the code left to right, even in Arabic", () => {
        expect(render()).toMatch(/<input[^>]*dir="ltr"[^>]*value="#2563eb"/)
    })
})

describe("the colour settings on screen", () => {
    const card = readFileSync("components/BrandColourCard.tsx", "utf8")

    it("is on the Branding tab, saved through the company settings API as a Branding field", () => {
        const tabs = readFileSync("components/CompanySettingsTabs.tsx", "utf8")
        expect(tabs).toMatch(/tab === 'branding' && \([\s\S]*<CompanyLogoCard[\s\S]*<BrandColourCard[\s\S]*defaultColour=\{company.defaultBrandColour\}/)
        expect(tabs).toContain("body: JSON.stringify({ companyId, tab: 'branding', brandColour })")
    })

    it("is in System Settings beside the \"Powered by\" branding, for the default", () => {
        const page = readFileSync("app/(dashboard)/dashboard/system-settings/page.tsx", "utf8")
        expect(page).toMatch(/handleSaveBranding[\s\S]*<BrandColourCard[\s\S]*body: JSON.stringify\(\{ brandColour \}\)/)
    })

    it("tells the settings page what \"Use the default\" goes back to", () => {
        expect(readFileSync("app/api/company-settings/route.ts", "utf8")).toContain("shown.defaultBrandColour = (await SystemSettingsService.get()).brandColour")
        expect(readFileSync("app/api/companies/route.ts", "utf8")).toContain("defaultBrandColour: (await SystemSettingsService.get()).brandColour")
    })

    it("previews the colour in light and dark, warns of one close to the error red, and repaints the page once saved", () => {
        expect(card).toContain("brandTokens(shown)")
        expect(card).toContain("(['light', 'dark'] as const).map(theme =>")
        expect(card).toContain("nearErrorRed(picked)")
        expect(card).toContain("router.refresh()")
    })

    it("previews on the themes' own panels: the same neutrals as app/globals.css", () => {
        const globals = readFileSync("app/globals.css", "utf8")
        const token = (block: string, name: string) => block.match(new RegExp(`^\\s*${name}: (#[0-9a-f]{6});`, "m"))?.[1]
        const lightRoot = globals.slice(globals.indexOf("--page: #f6f9fc"), globals.indexOf("--page: #0a1220"))
        const darkRoot = globals.slice(globals.indexOf("--page: #0a1220"))
        for (const name of ["panel", "ink", "rule"]) {
            expect(token(globals, `--light-${name}`), name).toBe(token(lightRoot, `--${name}`))
            expect(token(globals, `--dark-${name}`), name).toBe(token(darkRoot, `--${name}`))
        }
        const ui = readFileSync("components/ui/ui.css", "utf8")
        expect(ui).toMatch(/\.ui-colour-preview-theme\[data-preview="light"\] \{\s*--panel: var\(--light-panel\);\s*--ink: var\(--light-ink\);\s*--rule: var\(--light-rule\);/)
        expect(ui).toMatch(/\.ui-colour-preview-theme\[data-preview="dark"\] \{\s*--panel: var\(--dark-panel\);\s*--ink: var\(--dark-ink\);\s*--rule: var\(--dark-rule\);/)
    })

    it("names every ready-made colour in both languages", () => {
        for (const p of BRAND_PRESETS) {
            expect((en as Record<string, string>)[`brand_preset_${p.key}`], p.key).toBeTruthy()
            expect((ar as Record<string, string>)[`brand_preset_${p.key}`], p.key).toBeTruthy()
        }
    })
})

describe("the colour settings' hints (Codex on #80)", () => {
    // Drawn in the colour: DESIGN.md §2.1's tokens, or the building blocks,
    // which use them. The old pages' --brand-primary is a fixed indigo.
    const takesBrand = (file: string) => {
        const src = stripComments(readFileSync(file, "utf8"))
        return /var\(--brand(-hover|-press|-text|-tint|-tint-strong)?\)/.test(src) || /from ["']@\/components\/ui["']/.test(src)
    }
    const places = [
        { file: "app/(auth)/login/page.tsx", en: "the sign-in page", ar: "صفحة تسجيل الدخول", hints: ["brand_colour_system_hint"] },
        { file: "components/DashboardShell.tsx", en: "the side bar", ar: "الشريط الجانبي", hints: ["brand_colour_company_hint", "brand_colour_system_hint"] },
    ]
    const languages = [
        { dict: en as Record<string, string>, lang: "en" as const, keeps: /take it: (.*) keep Nizmo's indigo/ },
        { dict: ar as Record<string, string>, lang: "ar" as const, keeps: /فقط: (.*) باللون النيلي/ },
    ]

    for (const place of places) {
        it(`name ${place.en} as taking the colour only once it does, and as keeping the indigo while it doesn't`, () => {
            const takes = takesBrand(place.file)
            for (const { dict, lang, keeps } of languages) {
                for (const key of place.hints) {
                    const hint = dict[key]
                    const [first] = hint.split(". ")
                    if (!takes) expect(first, `${lang} ${key}`).not.toContain(place[lang])
                    expect(hint.match(keeps)?.[1].includes(place[lang]) ?? false, `${lang} ${key}`).toBe(!takes)
                }
            }
        })
    }
})

describe("the colour costs a page no reads of its own", () => {
    // Measured on the scratch database before this: a company user's page
    // read the system settings twice (the root layout's default, the
    // dashboard layout's "Powered by") and its company row twice (its
    // settings, then its colour).
    const strip = (f: string) => stripComments(readFileSync(f, "utf8"))

    it("reads the system settings once, however many layouts ask", () => {
        expect(strip("lib/services/system-settings.service.ts")).toContain("export const pageSystemSettings = cache(() => SystemSettingsService.get())")
        expect(strip("lib/page-brand-colour.ts")).toContain("usableDefault((await pageSystemSettings()).brandColour)")
        const dashboard = strip("app/(dashboard)/layout.tsx")
        expect(dashboard).toContain("const { showPoweredBy, poweredByName } = await pageSystemSettings()")
        for (const f of ["app/layout.tsx", "app/(dashboard)/layout.tsx", "lib/page-brand-colour.ts"]) {
            expect(strip(f), f).not.toContain("SystemSettingsService.get()")
        }
    })

    it("takes the company's colour from the company row the dashboard layout reads anyway", () => {
        const exposure = strip("lib/services/company.service.ts")
        const select = exposure.slice(exposure.indexOf("static async settingsExposure"), exposure.indexOf("static async getBranding"))
        expect(select).toContain("brandColour: true")
        for (const f of ["app/(dashboard)/layout.tsx", "lib/page-brand-colour.ts"]) {
            expect(strip(f), f).not.toMatch(/prisma\.company|companyBrandColour/)
        }
    })

    it("works each colour's stylesheet out once", () => {
        // Worked out afresh, 2,000 sheets take about 300ms here.
        brandStyleSheet("#0e7490")
        const started = performance.now()
        for (let i = 0; i < 2000; i++) brandStyleSheet("#0e7490")
        expect(performance.now() - started).toBeLessThan(50)
        // The same colour typed either way is the same sheet; junk is the default's.
        expect(brandStyleSheet("#0E7490")).toBe(brandStyleSheet("#0e7490"))
        expect(brandStyleSheet("not a colour")).toBe(brandStyleSheet(DEFAULT_BRAND))
    })
})

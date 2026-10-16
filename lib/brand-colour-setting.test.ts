import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { stripComments } from "./strip-comments"
import { updateCompanySchema } from "./validations/company.schema"
import { updateSystemSettingsSchema } from "./validations/system-settings.schema"
import { settingsTab } from "./company-settings-tabs"
import { maySetField } from "./company-settings-access"
import { colourFor } from "./page-brand-colour"
import { BRAND_PRESETS, DEFAULT_BRAND } from "./brand-colour"
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
        expect(colourFor({ role: "EMPLOYEE", companyId: "c1" }, "#2563eb", system)).toBe("#2563eb")
        expect(colourFor({ role: "ADMIN", companyId: "c1" }, null, system)).toBe(system)
    })

    it("is the default on the sign-in page and the Super Admin's pages", () => {
        expect(colourFor(null, "#2563eb", system)).toBe(system)
        expect(colourFor({ role: "SUPER_ADMIN", companyId: null }, "#2563eb", system)).toBe(system)
    })

    it("is Nizmo's indigo if nothing usable is stored", () => {
        expect(colourFor(null, null, null)).toBe(DEFAULT_BRAND)
        expect(colourFor({ role: "EMPLOYEE", companyId: "c1" }, "not a colour", "nor this")).toBe(DEFAULT_BRAND)
    })

    it("is put in the page by the root layout, read for each request", () => {
        const layout = stripComments(readFileSync("app/layout.tsx", "utf8"))
        expect(layout).toContain("const brand = await pageBrandColour(session?.user)")
        expect(layout).toContain("brandStyleSheet(brand)")
        expect(layout).not.toContain("brandStyleSheet(null)")
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

import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { stripComments } from "./strip-comments"
import { updateCompanySchema } from "./validations/company.schema"
import { updateSystemSettingsSchema } from "./validations/system-settings.schema"
import { settingsTab } from "./company-settings-tabs"
import { maySetField } from "./company-settings-access"
import { colourFor } from "./page-brand-colour"
import { DEFAULT_BRAND } from "./brand-colour"
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

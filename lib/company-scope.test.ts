import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import {
    SCOPED_COMPANY_COOKIE,
    mayScopeBranding,
    scopedCompanyId,
    type CompanyBranding,
} from "./company-scope"
import { modulesFrom } from "./modules"
import { en } from "@/lib/translations/en"

const t = ((key: string) => (en as Record<string, string>)[key]) as (key: any) => string
const COMPANY = "709dc251-e6e7-49a9-b2ef-773320412426"

describe("the four rules for whose names you see", () => {
    it("rule 1 — a Super Admin scoped to one company reads that company", () => {
        expect(scopedCompanyId("SUPER_ADMIN", COMPANY)).toBe(COMPANY)
    })

    it("rule 2 — a Super Admin on All Companies reads the defaults", () => {
        // Not a customised screen for somebody who is looking at everybody.
        // "ALL" is what CompanyContext stores for no selection; absent and
        // empty are the same thing said differently, and a cookie of spaces is
        // what a hand-edited one looks like.
        for (const cookie of ["ALL", null, undefined, "", "   "]) {
            expect(scopedCompanyId("SUPER_ADMIN", cookie), JSON.stringify(cookie)).toBeNull()
        }
    })

    it("rule 3 — everyone else reads their own session, whatever the cookie says", () => {
        // The security property, and the reason the check lives in this
        // function rather than at each call site: the cookie is written by the
        // browser and can name any company at all. It is ignored for anyone who
        // is not a Super Admin, so it grants nothing — and a Super Admin can
        // already see every company, so it grants them nothing new either.
        for (const role of ["ADMIN", "TEAM_LEADER", "EMPLOYEE", "", null, undefined, "super_admin", "SUPERADMIN"]) {
            expect(scopedCompanyId(role, COMPANY), String(role)).toBeNull()
            expect(mayScopeBranding(role), String(role)).toBe(false)
        }
    })

    it("rule 4 — anything unresolved still lands on the built-in name", () => {
        // A scope that resolves to no company, or a company with no overrides,
        // is not an error state: it is the default label.
        expect(modulesFrom(null, t).label("vendors")).toBe(en.vendors)
        expect(modulesFrom({ moduleLabels: null, moduleIcons: null }, t).label("vendors")).toBe(en.vendors)
    })
})

describe("what a scoped render actually shows", () => {
    it("prefers the scoped company over the viewer's own session", () => {
        // The Super Admin's own session carries no company names at all, which
        // is exactly why rule 1 needed a second source in the first place.
        const scoped: CompanyBranding = {
            moduleLabels: { vendors: "Clinics" },
            moduleIcons: { vendors: "🏥" },
            logoUrl: null,
        }
        const modules = modulesFrom(scoped, t)
        expect(modules.label("vendors")).toBe("Clinics")
        expect(modules.icon("vendors")).toBe("🏥")
    })

    it("is the same shape the session is, so one resolver serves both", () => {
        // If these diverged, rule 1 and rule 3 would need separate resolvers and
        // would eventually disagree about something.
        const viaSession = modulesFrom({ moduleLabels: { tasks: "Jobs" }, moduleIcons: {} }, t)
        const scoped: CompanyBranding = { moduleLabels: { tasks: "Jobs" }, moduleIcons: {}, logoUrl: null }
        expect(modulesFrom(scoped, t).entry("tasks")).toEqual(viaSession.entry("tasks"))
    })
})

describe("the two server call sites resolve the scope identically", () => {
    // The sidebar is rendered by the layout and the headings by the page, from
    // two separate server renders. If either read the cookie directly, or
    // skipped the role check, they could describe different companies on one
    // screen — which is the failure this whole rule exists to avoid creating.
    const SOURCES = ["app/(dashboard)/layout.tsx", "app/(dashboard)/dashboard/page.tsx"]

    it("both go through scopedCompanyId rather than reading the cookie raw", () => {
        for (const path of SOURCES) {
            const source = readFileSync(path, "utf8")
            expect(source, `${path} does not resolve the scope`).toContain("scopedCompanyId(")
            expect(source, `${path} does not load branding`).toContain("CompanyService.getBranding")
        }
    })

    it("keeps one writer and two checked readers of the cookie", () => {
        // CompanyContext writes it; the layout and the dashboard page read it,
        // both through the resolver above. A fourth mention would be a third
        // opinion about which company a screen is describing.
        for (const path of [
            "context/CompanyContext.tsx",
            "app/(dashboard)/layout.tsx",
            "app/(dashboard)/dashboard/page.tsx",
            "lib/company-scope.ts",
        ]) {
            expect(readFileSync(path, "utf8"), path).toContain("SCOPED_COMPANY_COOKIE")
        }
        expect(SCOPED_COMPANY_COOKIE).toBe("scopedCompanyId")
    })
})

import { describe, it, expect } from "vitest"
import { readdirSync, readFileSync } from "node:fs"
import { claimBadges, daysBetween, daysLate, taxClaimsUrl, TAX_PAGE, TAX_PREVIEW } from "./tax-claims"
import { moduleForApiPath, moduleForPagePath } from "./features/routes"
import { PERMISSIONS, isPermission, isReserved } from "./permissions/catalogue"
import { PERMISSION_GROUPS, groupLabelKey, permissionLabelKey, riskLabelKey } from "./permissions/matrix"
import { normalizeGrants } from "./permissions/grant-rules"
import { BUILT_IN_GRANTS } from "./permissions/built-in"
import { knownRefusal } from "./api-errors"
import { en } from "./translations/en"
import { ar } from "./translations/ar"

/**
 * A client's tax claims (CLIENT_PORTAL_PLAN.md §3, §9, §12 step 2b; PR 311):
 * what the server and the screens share, the module and the permission the
 * claims come with, and what the migration and the route hold to. The
 * service and the database's own rules are in lib/tax-claims.db.test.ts, and
 * the section in lib/tax-position-section.test.ts.
 */

describe("late, in days (§3.4)", () => {
    it("counts whole days from one calendar day to another", () => {
        expect(daysBetween("2026-04-30", "2026-11-17")).toBe(201)
        expect(daysBetween("2026-09-30", "2026-11-17")).toBe(48)
        expect(daysBetween("2026-11-17", "2026-11-17")).toBe(0)
        expect(daysBetween("2026-11-18", "2026-11-17")).toBe(-1)
        // Across a leap day, and a year's end.
        expect(daysBetween("2028-02-28", "2028-03-01")).toBe(2)
        expect(daysBetween("2026-12-31", "2027-01-01")).toBe(1)
    })

    it("is late once its last day to pay has passed, not on it", () => {
        expect(daysLate("2026-11-16", "2026-11-17")).toBe(1)
        expect(daysLate("2026-11-17", "2026-11-17")).toBe(0)
        expect(daysLate("2026-12-31", "2026-11-17")).toBe(0)
    })

    it("gives a claim both badges where it's late and partly paid", () => {
        expect(claimBadges({ daysLate: 48, paidAmount: 200.25 })).toEqual(["late", "partly_paid"])
        expect(claimBadges({ daysLate: 201, paidAmount: 0 })).toEqual(["late"])
        expect(claimBadges({ daysLate: 0, paidAmount: 10 })).toEqual(["partly_paid"])
        expect(claimBadges({ daysLate: 0, paidAmount: 0 })).toEqual([])
    })
})

describe("the address a client's claims are read from (§3.5)", () => {
    it("asks for five to start with, then 20 to a page", () => {
        expect([TAX_PREVIEW, TAX_PAGE]).toEqual([5, 20])
        expect(taxClaimsUrl("noor", false, 1)).toBe("/api/tax-claims?clientId=noor&limit=5&page=1")
        expect(taxClaimsUrl("noor", true, 3)).toBe("/api/tax-claims?clientId=noor&limit=20&page=3")
        // The five are always the first five, whatever page all of them were left on.
        expect(taxClaimsUrl("noor", false, 3)).toBe("/api/tax-claims?clientId=noor&limit=5&page=1")
        expect(taxClaimsUrl("a b&c", false, 1)).toBe("/api/tax-claims?clientId=a+b%26c&limit=5&page=1")
    })
})

describe("the module, by its route", () => {
    it("gates the claims' route by the client portal", () => {
        expect(moduleForApiPath("/api/tax-claims")).toBe("TAX_POSITION")
        expect(moduleForApiPath("/api/tax-claims/anything")).toBe("TAX_POSITION")
        // The section is on the client's page, which is Clients'.
        expect(moduleForPagePath("/dashboard/clients/noor")).toBe("CLIENTS")
    })

    it("asks for tax.view, a page at a time, and reads nothing but the address", () => {
        const route = readFileSync("app/api/tax-claims/route.ts", "utf8")
        expect(route).toContain('{ permission: "tax.view" }')
        expect(route).toContain("parsePaging(searchParams, TAX_PREVIEW, TAX_PAGE)")
        expect(route).toContain('searchParams.get("clientId")')
        expect(route).toMatch(/export const GET = withStandardHandler\(/)
        expect(route).not.toMatch(/export const (POST|PUT|PATCH|DELETE)/)
    })

    it("refuses with a reason for no client, and for no permission", () => {
        expect(knownRefusal(new Error("TAX_CLIENT_REQUIRED"))?.status).toBe(400)
        expect(knownRefusal(new Error("TAX_VIEW_REQUIRED"))?.status).toBe(403)
        expect(knownRefusal(new Error("CLIENT_NOT_FOUND"))?.status).toBe(404)
    })
})

describe("tax.view (§9)", () => {
    it("is the claims' permission: company-wide, in the tax position's module, with seeing clients", () => {
        expect(PERMISSIONS["tax.view"]).toEqual({ code: 68, module: "TAX_POSITION", scopes: ["COMPANY"], implies: ["clients.view"] })
        expect(isReserved("tax.view")).toBe(false)
        expect(riskLabelKey("tax.view")).toBeNull()
        // Uploading has its own, with its route (step 3b, lib/tax-upload.test.ts).
        expect(isPermission("tax.manage")).toBe(true)
        expect(Object.values(PERMISSIONS).filter(p => p.code === 68)).toHaveLength(1)
    })

    it("brings seeing clients with it, as the tax position is on the client's page", () => {
        const verdict = normalizeGrants([{ permission: "tax.view", scope: "COMPANY" }])
        expect(verdict.ok).toBe(true)
        if (!verdict.ok) return
        expect(verdict.grants).toEqual({ "tax.view": "COMPANY", "clients.view": "COMPANY" })
    })

    it("has its own group in the permission matrix, named in both languages", () => {
        const group = PERMISSION_GROUPS.find(g => g.key === "client_portal")
        expect(group?.permissions).toEqual(["tax.view", "tax.manage"])
        expect(PERMISSION_GROUPS.map(g => g.key).indexOf("client_portal")).toBe(PERMISSION_GROUPS.map(g => g.key).indexOf("costs") + 1)
        for (const words of [en, ar] as Record<string, string>[]) {
            expect(words[groupLabelKey("client_portal")]).toBeTruthy()
            expect(words[permissionLabelKey("tax.view")]).toBeTruthy()
        }
        expect((en as Record<string, string>)[permissionLabelKey("tax.view")]).toBe("See clients' tax position")
    })

    it("is the built-in Admin's, and nobody else's until the Super Admin gives it", () => {
        expect(BUILT_IN_GRANTS.ADMIN["tax.view"]).toBe("COMPANY")
        expect(BUILT_IN_GRANTS.TEAM_LEADER["tax.view"]).toBeUndefined()
        expect(BUILT_IN_GRANTS.EMPLOYEE["tax.view"]).toBeUndefined()
    })
})

describe("See clients' tax position, for the companies already there (§12 step 2c, PR 312)", () => {
    const sql = () => {
        const name = readdirSync("prisma/migrations").find(m => m.endsWith("_tax_view_granted"))
        expect(name).toBe("20270103000000_tax_view_granted")
        return readFileSync(`prisma/migrations/${name}/migration.sql`, "utf8").split("\n").filter(line => !line.startsWith("--")).join("\n")
    }

    it("a migration gives it to the built-in Admin role alone, company-wide", () => {
        const rows = [...sql().matchAll(/\('(\w+)', '([\w.]+)', '(\w+)'\)/g)].map(([, role, permission, scope]) => [role, permission, scope])
        expect(rows).toEqual([["ADMIN", "tax.view", "COMPANY"]])
    })

    it("leaves a role holding it already as it is, and has only the holders of a role given it reload", () => {
        const text = sql().replace(/\s+/g, " ")
        expect(text).toContain(`ON CONFLICT ("roleId", "permission") DO NOTHING RETURNING "roleId"`)
        expect(text).toContain(`UPDATE "Role" SET "version" = "version" + 1, "updatedAt" = now() WHERE "id" IN (SELECT "roleId" FROM given)`)
        expect(text).not.toMatch(/DELETE|DROP|ALTER/)
    })

    it("comes after the claims' tables, and opens nothing by itself: the package still has to have the client portal", () => {
        const names = readdirSync("prisma/migrations").filter(m => m !== "migration_lock.toml").sort()
        expect(names.indexOf("20270103000000_tax_view_granted")).toBeGreaterThan(names.indexOf("20270102000000_tax_claims"))
        expect(sql()).not.toMatch(/"Package"|"Company"/)
    })
})

describe("the claims' tables (§3.1)", () => {
    const migration = readFileSync("prisma/migrations/20270102000000_tax_claims/migration.sql", "utf8")
    const schema = readFileSync("prisma/schema.prisma", "utf8")

    it("only adds: two tables, their indexes and their rules", () => {
        expect([...migration.matchAll(/CREATE TABLE "(\w+)"/g)].map(m => m[1])).toEqual(["TaxClaim", "ClientTaxPosition"])
        // Nothing is altered but the two it creates.
        expect([...new Set([...migration.matchAll(/ALTER TABLE "(\w+)"/g)].map(m => m[1]))].sort()).toEqual(["ClientTaxPosition", "TaxClaim"])
        expect([...new Set([...migration.matchAll(/INDEX "\w+" ON "(\w+)"/g)].map(m => m[1]))].sort()).toEqual(["ClientTaxPosition", "TaxClaim"])
        expect(migration).not.toMatch(/\bDROP\b|\bTRUNCATE\b|\bRENAME\b|DELETE FROM|\bUPDATE "|\bINSERT\b/)
    })

    it("turns Row Level Security on for both, in the migration that creates them", () => {
        expect(migration).toContain('ALTER TABLE "TaxClaim" ENABLE ROW LEVEL SECURITY;')
        expect(migration).toContain('ALTER TABLE "ClientTaxPosition" ENABLE ROW LEVEL SECURITY;')
    })

    it("keeps amounts to the piastre, days as days, and a claim's number as text", () => {
        expect(migration).toMatch(/"claimNumber" TEXT NOT NULL/)
        for (const column of ["originalAmount", "paidAmount", "remainingAmount"]) expect(migration).toMatch(new RegExp(`"${column}" DECIMAL\\(14,2\\) NOT NULL`))
        expect(migration).toMatch(/"dueDate" DATE NOT NULL/)
        expect(migration).toMatch(/"periodStart" DATE,/)
        expect(migration).toMatch(/"asOf" DATE NOT NULL/)
    })

    it("holds a claim to its number once for its client, its amounts adding up, and something left to pay", () => {
        expect(migration).toContain('CREATE UNIQUE INDEX "TaxClaim_clientId_claimNumber_key" ON "TaxClaim"("clientId", "claimNumber");')
        expect(migration).toMatch(/CONSTRAINT "TaxClaim_amounts" CHECK \("originalAmount" >= 0 AND "paidAmount" >= 0 AND "remainingAmount" > 0 AND "originalAmount" = "paidAmount" \+ "remainingAmount"\)/)
        expect(migration).toMatch(/CONSTRAINT "TaxClaim_named" CHECK/)
        expect(migration).toMatch(/CONSTRAINT "TaxClaim_period" CHECK/)
    })

    it("lets them go with their client, and keeps the uploader's name when the account goes", () => {
        expect(migration).toMatch(/"TaxClaim_clientId_fkey" FOREIGN KEY \("clientId"\) REFERENCES "Client"\("id"\) ON DELETE CASCADE/)
        expect(migration).toMatch(/"ClientTaxPosition_clientId_fkey" FOREIGN KEY \("clientId"\) REFERENCES "Client"\("id"\) ON DELETE CASCADE/)
        expect(migration).toMatch(/"ClientTaxPosition_uploadedById_fkey" FOREIGN KEY \("uploadedById"\) REFERENCES "User"\("id"\) ON DELETE SET NULL/)
        expect(migration).toMatch(/"uploadedByName" TEXT,/)
    })

    it("is in the schema as the migration made it", () => {
        expect(schema).toMatch(/model TaxClaim \{[\s\S]*?@@unique\(\[clientId, claimNumber\]\)[\s\S]*?\n\}/)
        expect(schema).toMatch(/model ClientTaxPosition \{[\s\S]*?clientId\s+String\s+@id[\s\S]*?\n\}/)
        expect(schema).toMatch(/originalAmount\s+Decimal\s+@db\.Decimal\(14, 2\)/)
        expect(schema).toMatch(/dueDate\s+DateTime\s+@db\.Date/)
    })
})

describe("the section's words, in both languages", () => {
    const KEYS = [
        "tax_position", "tax_position_loading", "tax_position_failed", "tax_position_none", "tax_position_none_detail",
        "tax_figures_from_by", "tax_figures_from", "tax_owed", "tax_open_claims", "tax_late_claims", "tax_paid", "tax_claims_caption",
        "tax_col_number", "tax_col_item", "tax_col_period", "tax_col_original", "tax_col_remaining", "tax_col_due", "tax_col_status",
        "tax_period", "tax_days_late", "tax_due_on", "tax_due_on_late", "tax_badge_late", "tax_badge_partly_paid",
        "tax_show_all", "tax_show_fewer", "tax_no_open_claims", "tax_no_open_claims_detail",
    ]

    it("has each of them, with what it fills in", () => {
        for (const words of [en, ar] as Record<string, string>[]) {
            for (const key of KEYS) expect(words[key], key).toBeTruthy()
            expect(words.tax_figures_from_by).toMatch(/\{date\}.*\{name\}.*\{day\}/)
            expect(words.tax_figures_from).toMatch(/\{date\}.*\{day\}/)
            expect(words.tax_figures_from).not.toContain("{name}")
            expect(words.tax_period).toMatch(/\{from\}.*\{to\}/)
            expect(words.tax_days_late).toContain("{days}")
            expect(words.tax_due_on_late).toMatch(/\{date\}.*\{days\}/)
            expect(words.tax_show_all).toContain("{count}")
            expect(words.tax_no_open_claims_detail).toContain("{date}")
        }
    })

    it("uses each of them in the section, and no others of its own", () => {
        const source = readFileSync("components/tax/TaxPosition.tsx", "utf8")
        const used = [...new Set([...source.matchAll(/'(tax_\w+)'/g)].map(m => m[1]))].sort()
        expect(used).toEqual([...KEYS].sort())
    })
})

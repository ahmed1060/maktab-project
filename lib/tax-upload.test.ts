import { describe, it, expect } from "vitest"
import { readdirSync, readFileSync } from "node:fs"
import { moduleForApiPath } from "./features/routes"
import { PERMISSIONS, isPermission, isReserved } from "./permissions/catalogue"
import { PERMISSION_GROUPS, permissionLabelKey, riskLabelKey } from "./permissions/matrix"
import { normalizeGrants } from "./permissions/grant-rules"
import { BUILT_IN_GRANTS } from "./permissions/built-in"
import { knownRefusal } from "./api-errors"
import { AUDIT_ACTIONS } from "./audit-codes"
import { en } from "./translations/en"
import { ar } from "./translations/ar"

/**
 * Saving the tax portal's file (CLIENT_PORTAL_PLAN.md §4.1, §9, §12 step 3b;
 * PR 315): the permission it comes with, its route, what it's refused with,
 * and what its migration adds. What's sent is read by lib/tax-file.ts
 * (lib/tax-file.test.ts), and the save itself is in
 * lib/tax-upload.db.test.ts.
 */

describe("tax.manage (§9)", () => {
    it("is the upload's permission: company-wide, in the tax position's module, with seeing it", () => {
        expect((PERMISSIONS as Record<string, unknown>)["tax.manage"]).toEqual({ code: 69, module: "TAX_POSITION", scopes: ["COMPANY"], implies: ["tax.view"] })
        expect(isPermission("tax.manage")).toBe(true)
        expect(isReserved("tax.manage" as never)).toBe(false)
        // Not high-risk: it moves no money, and the next file puts right what one got wrong.
        expect(riskLabelKey("tax.manage" as never)).toBeNull()
        expect(Object.values(PERMISSIONS).filter(p => p.code === 69)).toHaveLength(1)
    })

    it("brings seeing the tax position with it, and so seeing clients", () => {
        const verdict = normalizeGrants([{ permission: "tax.manage", scope: "COMPANY" }])
        expect(verdict.ok).toBe(true)
        if (!verdict.ok) return
        expect(verdict.grants).toEqual({ "tax.manage": "COMPANY", "tax.view": "COMPANY", "clients.view": "COMPANY" })
    })

    it("is under Client portal in the permission matrix, after seeing, named in both languages", () => {
        expect(PERMISSION_GROUPS.find(g => g.key === "client_portal")?.permissions).toEqual(["tax.view", "tax.manage", "client_accounts.manage"])
        for (const words of [en, ar] as Record<string, string>[]) expect(words[permissionLabelKey("tax.manage" as never)]).toBeTruthy()
        expect((en as Record<string, string>)[permissionLabelKey("tax.manage" as never)]).toBe("Update clients' tax position from the tax portal's file")
    })

    it("is the built-in Admin's, and nobody else's until the Super Admin gives it", () => {
        expect((BUILT_IN_GRANTS.ADMIN as Record<string, string>)["tax.manage"]).toBe("COMPANY")
        expect((BUILT_IN_GRANTS.TEAM_LEADER as Record<string, string>)["tax.manage"]).toBeUndefined()
        expect((BUILT_IN_GRANTS.EMPLOYEE as Record<string, string>)["tax.manage"]).toBeUndefined()
    })

    it("is in the roles plan's table, with its route", () => {
        const row = readFileSync("ROLES_PLAN.md", "utf8").split("\n").find(line => line.startsWith("|") && line.includes("`tax.manage`"))
        expect(row).toContain("`tax.view`")
        expect(row).toContain("/tax-claims/upload")
    })
})

describe("the upload's route (§4.1)", () => {
    const route = () => readFileSync("app/api/tax-claims/upload/route.ts", "utf8")

    it("is under the claims' own address, so the client portal's gate holds it", () => {
        expect(moduleForApiPath("/api/tax-claims/upload")).toBe("TAX_POSITION")
    })

    it("asks for tax.manage to read what a file is checked against, and to save", () => {
        expect(route()).toMatch(/export const GET = withStandardHandler\(/)
        expect(route()).toMatch(/export const POST = withStandardHandler\(/)
        expect(route().match(/\{ permission: "tax\.manage" \}/g)).toHaveLength(2)
        expect(route()).not.toMatch(/export const (PUT|PATCH|DELETE)/)
        expect(route()).toContain('searchParams.get("clientId")')
    })

    it("takes the claims the browser read, never the file", () => {
        expect(route()).toContain("saveTaxFile(session.user as any, body)")
        expect(route()).not.toMatch(/formData|readForm|exceljs|tax-file-read/)
    })

    it("refuses with a reason", () => {
        const status = (code: string) => knownRefusal(new Error(code))?.status
        expect(status("TAX_MANAGE_REQUIRED")).toBe(403)
        expect(status("TAX_UPLOAD_INVALID")).toBe(400)
        expect(status("TAX_TOO_MANY_CLAIMS")).toBe(400)
        expect(status("TAX_DAY_AFTER_TODAY")).toBe(400)
        expect(status("TAX_CLAIMS_CHANGED")).toBe(409)
        expect(status("TAX_FILE_OTHER_COMPANY")).toBe(409)
        expect(status("CLIENT_ARCHIVED")).toBe(400)
        expect(status("CLIENT_NOT_FOUND")).toBe(404)
    })
})

describe("the save (§4.1)", () => {
    const save = () => {
        const service = readFileSync("lib/services/tax-claim.service.ts", "utf8")
        return service.slice(service.indexOf("export async function saveTaxFile"))
    }

    it("holds the client's row before it reads what it replaces, and checks it's still in use", () => {
        const lock = save().indexOf("FOR UPDATE")
        expect(lock).toBeGreaterThan(-1)
        expect(save().indexOf("tx.clientTaxPosition.findUnique")).toBeGreaterThan(lock)
        expect(save().indexOf("tx.taxClaim.findMany")).toBeGreaterThan(lock)
        expect(save().indexOf('throw new Error("CLIENT_ARCHIVED")')).toBeGreaterThan(lock)
    })

    it("runs its queries one after another: a transaction has one connection", () => {
        expect(save()).toContain("prisma.$transaction(")
        expect(save()).not.toContain("Promise.all")
    })
})

describe("what the migration adds (§3.1)", () => {
    const NAME = "20270104000000_tax_upload"
    const sql = () => readFileSync(`prisma/migrations/${NAME}/migration.sql`, "utf8").split("\n").filter(line => !line.startsWith("--")).join("\n")

    it("only adds: the company the last file named, and how many files there have been", () => {
        expect(sql().split(";").map(statement => statement.replace(/\s+/g, " ").trim()).filter(Boolean)).toEqual([
            `ALTER TABLE "ClientTaxPosition" ADD COLUMN "fileCompany" TEXT`,
            `ALTER TABLE "ClientTaxPosition" ADD COLUMN "uploads" INTEGER NOT NULL DEFAULT 1`,
        ])
    })

    it("comes after the claims' tables and their permission's grant", () => {
        const names = readdirSync("prisma/migrations").filter(m => m !== "migration_lock.toml").sort()
        expect(names.indexOf(NAME)).toBeGreaterThan(names.indexOf("20270103000000_tax_view_granted"))
    })

    it("is in the schema as the migration has it", () => {
        const schema = readFileSync("prisma/schema.prisma", "utf8")
        const from = schema.indexOf("model ClientTaxPosition {")
        const model = schema.slice(from, schema.indexOf("\n}", from))
        expect(model).toMatch(/\n  fileCompany\s+String\?\n/)
        expect(model).toMatch(/\n  uploads\s+Int\s+@default\(1\)\n/)
    })
})

describe("Update clients' tax position, for the companies already there (§12 step 3d, PR 317)", () => {
    const NAME = "20270105000000_tax_manage_granted"
    const sql = () => {
        expect(readdirSync("prisma/migrations").find(m => m.endsWith("_tax_manage_granted"))).toBe(NAME)
        return readFileSync(`prisma/migrations/${NAME}/migration.sql`, "utf8").split("\n").filter(line => !line.startsWith("--")).join("\n")
    }

    it("a migration gives it to the built-in Admin role alone, company-wide", () => {
        const rows = [...sql().matchAll(/\('(\w+)', '([\w.]+)', '(\w+)'\)/g)].map(([, role, permission, scope]) => [role, permission, scope])
        expect(rows).toEqual([["ADMIN", "tax.manage", "COMPANY"]])
        expect(BUILT_IN_GRANTS.ADMIN["tax.manage"]).toBe("COMPANY")
    })

    it("leaves a role holding it already as it is, and has only the holders of a role given it reload", () => {
        const text = sql().replace(/\s+/g, " ")
        expect(text).toContain(`ON CONFLICT ("roleId", "permission") DO NOTHING RETURNING "roleId"`)
        expect(text).toContain(`UPDATE "Role" SET "version" = "version" + 1, "updatedAt" = now() WHERE "id" IN (SELECT "roleId" FROM given)`)
        expect(text).not.toMatch(/DELETE|DROP|ALTER/)
    })

    it("comes after the release that knows it, and after seeing the tax position, which it brings, was given", () => {
        const names = readdirSync("prisma/migrations").filter(m => m !== "migration_lock.toml").sort()
        expect(names.indexOf(NAME)).toBeGreaterThan(names.indexOf("20270104000000_tax_upload"))
        expect(names.indexOf(NAME)).toBeGreaterThan(names.indexOf("20270103000000_tax_view_granted"))
        expect(PERMISSIONS["tax.manage"].implies).toEqual(["tax.view"])
    })

    it("opens nothing by itself: the package still has to have the client portal", () => {
        expect(sql()).not.toMatch(/"Package"|"Company"/)
        expect(moduleForApiPath("/api/tax-claims/upload")).toBe("TAX_POSITION")
    })
})

describe("the audit log's entry (§4.1)", () => {
    it("has its action and each of its details named in both languages", () => {
        expect(AUDIT_ACTIONS as readonly string[]).toContain("UPDATE_TAX_POSITION")
        for (const words of [en, ar] as Record<string, string>[]) {
            for (const key of ["audit_action_UPDATE_TAX_POSITION", "audit_field_name", "audit_field_fileName", "audit_field_asOf", "audit_field_added", "audit_field_changed", "audit_field_removed", "audit_field_claims"]) {
                expect(words[key], key).toBeTruthy()
            }
        }
    })
})

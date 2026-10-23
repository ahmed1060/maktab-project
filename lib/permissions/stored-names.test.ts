import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { fromStored, grantsFromRows, permissionOf, storedNames, templateGrants } from "./stored-names"
import { holdersOf } from "./holders"
import { PERMISSIONS } from "./catalogue"
import { parseModuleIcons, parseModuleOverrides } from "@/lib/modules"

/**
 * Vendors became Clients in 0b, which kept writing the old names; 0c
 * rewrote the rows and writes the new names (CLIENTS_PLAN.md §0.3). 0b's
 * code, live while 0c waits for review, still writes `vendors.*` and a
 * company's `vendors` name for the module, so 0c reads both until 0d.
 * lib/records.db.test.ts checks the same through the services, against
 * Postgres.
 */
describe("a Clients permission's name in a row", () => {
    it("is the new one, or the old read as the new", () => {
        expect(permissionOf("vendors.view")).toBe("clients.view")
        expect(permissionOf("vendors.manage")).toBe("clients.manage")
        expect(permissionOf("clients.view")).toBe("clients.view")
        expect(permissionOf("tasks.view")).toBe("tasks.view")
        expect(storedNames("clients.manage")).toEqual(["clients.manage", "vendors.manage"])
        expect(storedNames("tasks.view")).toEqual(["tasks.view"])
    })

    it("keeps the codes the session token carries", () => {
        expect(PERMISSIONS["clients.view"].code).toBe(29)
        expect(PERMISSIONS["clients.manage"].code).toBe(30)
    })

    it("is read as the new name from grant rows and templates", () => {
        expect(fromStored([{ permission: "vendors.view", scope: "COMPANY" }, { permission: "tasks.view", scope: "TEAM" }]))
            .toEqual([{ permission: "clients.view", scope: "COMPANY" }, { permission: "tasks.view", scope: "TEAM" }])
        expect(grantsFromRows([{ permission: "vendors.manage", scope: "COMPANY" }, { permission: "clients.view", scope: "COMPANY" }, { permission: "gone.view", scope: "TEAM" }]))
            .toEqual({ "clients.manage": "COMPANY", "clients.view": "COMPANY" })
        expect(templateGrants([{ permission: "vendors.view", scope: "COMPANY" }, "junk", null])).toEqual([{ permission: "clients.view", scope: "COMPANY" }])
        expect(templateGrants({ not: "a list" })).toEqual([])
    })

    it("finds whoever holds it under either name", () => {
        expect(holdersOf("clients.view", "COMPANY")).toEqual({ assignedRole: { grants: { some: { permission: { in: ["clients.view", "vendors.view"] }, scope: "COMPANY" } } } })
        expect(holdersOf("dayoff.approve")).toEqual({ assignedRole: { grants: { some: { permission: { in: ["dayoff.approve"] } } } } })
    })

    it("is written new, and read through the mapping wherever grants are read", () => {
        const ROLES = readFileSync("lib/services/role.service.ts", "utf8")
        const TEMPLATES = readFileSync("lib/services/role-template.service.ts", "utf8")
        // The old names are never written again.
        for (const source of [ROLES, TEMPLATES]) expect(source).not.toMatch(/toStored|storedName\(/)
        // Every read loop over rows goes through grantsFromRows, which maps names.
        for (const [path, source] of [["role.service", ROLES], ["role-assignment.service", readFileSync("lib/services/role-assignment.service.ts", "utf8")]]) {
            expect(source, path).not.toMatch(/isPermission\(g\.permission\)/)
        }
        expect(TEMPLATES).toContain("grants: templateGrants(t.grants)")
        expect(readFileSync("lib/services/access-report.service.ts", "utf8")).toContain("permission: { in: storedNames(permission) }")
    })
})

describe("a company's name and icon for Clients", () => {
    it("are read under the module's old key or its new one, and written under the new", () => {
        expect(parseModuleOverrides({ vendors: "Customers", tasks: "Jobs" })).toEqual({ clients: "Customers", tasks: "Jobs" })
        expect(parseModuleOverrides({ clients: "Customers" })).toEqual({ clients: "Customers" })
        expect(parseModuleIcons({ vendors: "🏥" })).toEqual({ clients: "🏥" })
        const COMPANIES = readFileSync("lib/services/company.service.ts", "utf8")
        expect(COMPANIES).toContain("moduleLabels: nextLabels ?? Prisma.DbNull")
        expect(COMPANIES).toContain("moduleIcons: nextIcons ?? Prisma.DbNull")
    })
})

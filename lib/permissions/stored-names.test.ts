import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { fromStored, grantsFromRows, permissionOf, storedName, storedNames, templateGrants, toStored } from "./stored-names"
import { holdersOf } from "./holders"
import { PERMISSIONS } from "./catalogue"
import { parseModuleIcons, parseModuleOverrides, storedOverrides } from "@/lib/modules"

/**
 * Vendors became Clients in 0b, but the database keeps the old names until
 * 0c (CLIENTS_PLAN.md §0.3): main's release, live while 0b waits for review,
 * knows only `vendors.*` and a company's `vendors` name for the module. So
 * 0b reads both and writes the old. lib/records.db.test.ts checks the same
 * through the services, against Postgres.
 */
describe("a Clients permission's stored name", () => {
    it("is the old one, written; either is read as the new", () => {
        expect(storedName("clients.view")).toBe("vendors.view")
        expect(storedName("clients.manage")).toBe("vendors.manage")
        expect(storedName("records.view")).toBe("records.view")
        expect(permissionOf("vendors.view")).toBe("clients.view")
        expect(permissionOf("clients.view")).toBe("clients.view")
        expect(permissionOf("tasks.view")).toBe("tasks.view")
        expect(storedNames("clients.manage")).toEqual(["clients.manage", "vendors.manage"])
        expect(storedNames("tasks.view")).toEqual(["tasks.view"])
    })

    it("keeps the codes the session token carries", () => {
        expect(PERMISSIONS["clients.view"].code).toBe(29)
        expect(PERMISSIONS["clients.manage"].code).toBe(30)
    })

    it("is what grant rows are written under, and read from", () => {
        const rows = [{ permission: "clients.view", scope: "COMPANY" }, { permission: "tasks.view", scope: "TEAM" }]
        expect(toStored(rows)).toEqual([{ permission: "vendors.view", scope: "COMPANY" }, { permission: "tasks.view", scope: "TEAM" }])
        expect(fromStored(toStored(rows))).toEqual(rows)
        // A name nobody knows passes through, to be skipped where grants are read.
        expect(toStored([{ permission: "gone.view", scope: "TEAM" }])).toEqual([{ permission: "gone.view", scope: "TEAM" }])
        expect(grantsFromRows([{ permission: "vendors.manage", scope: "COMPANY" }, { permission: "clients.view", scope: "COMPANY" }, { permission: "gone.view", scope: "TEAM" }]))
            .toEqual({ "clients.manage": "COMPANY", "clients.view": "COMPANY" })
        expect(templateGrants([{ permission: "vendors.view", scope: "COMPANY" }, "junk", null])).toEqual([{ permission: "clients.view", scope: "COMPANY" }])
        expect(templateGrants({ not: "a list" })).toEqual([])
    })

    it("finds whoever holds it under either name", () => {
        expect(holdersOf("clients.view", "COMPANY")).toEqual({ assignedRole: { grants: { some: { permission: { in: ["clients.view", "vendors.view"] }, scope: "COMPANY" } } } })
        expect(holdersOf("dayoff.approve")).toEqual({ assignedRole: { grants: { some: { permission: { in: ["dayoff.approve"] } } } } })
    })

    it("is used wherever grants are written or read", () => {
        const ROLES = readFileSync("lib/services/role.service.ts", "utf8")
        const TEMPLATES = readFileSync("lib/services/role-template.service.ts", "utf8")
        // Every write of a role's rows, and of a template's list.
        expect(ROLES.match(/grants: \{\s*create: /g)).toHaveLength(2)
        expect(ROLES.match(/grants: \{\s*create: toStored\(/g)).toHaveLength(2)
        expect(ROLES).toContain("tx.roleGrant.createMany({ data: toStored(grants)")
        expect(TEMPLATES).toContain("grants: toStored(grants) }")
        expect(TEMPLATES).toContain("data: { ...after, grants: toStored(after.grants) }")
        // Every read loop over rows goes through grantsFromRows, which maps names.
        for (const [path, source] of [["role.service", ROLES], ["role-assignment.service", readFileSync("lib/services/role-assignment.service.ts", "utf8")]]) {
            expect(source, path).not.toMatch(/isPermission\(g\.permission\)/)
        }
        expect(readFileSync("lib/services/access-report.service.ts", "utf8")).toContain("permission: { in: storedNames(permission) }")
    })
})

describe("a company's name and icon for Clients", () => {
    it("are stored under the module's old key, and read under either", () => {
        expect(storedOverrides({ clients: "Customers", tasks: "Jobs" })).toEqual({ vendors: "Customers", tasks: "Jobs" })
        expect(storedOverrides(null)).toBeNull()
        expect(parseModuleOverrides({ vendors: "Customers", tasks: "Jobs" })).toEqual({ clients: "Customers", tasks: "Jobs" })
        expect(parseModuleOverrides({ clients: "Customers" })).toEqual({ clients: "Customers" })
        expect(parseModuleIcons({ vendors: "🏥" })).toEqual({ clients: "🏥" })
        expect(readFileSync("lib/services/company.service.ts", "utf8")).toMatch(/moduleLabels: storedOverrides\(nextLabels\)[\s\S]*moduleIcons: storedOverrides\(nextIcons\)/)
    })
})

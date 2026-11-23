import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { ALL_PERMISSIONS, definitionOf, isSplit, requiresOf, splitParts, type Permission } from "@/lib/permissions/catalogue"
import { grantsFromRows } from "@/lib/permissions/grant-rules"

/**
 * The grant for companies already there (LATER_CHANGES_PLAN.md §2, PR 385):
 * one migration replaces every split permission, in each role and template,
 * by its parts at its scope. What it does to a real database is
 * lib/roles.db.test.ts's; this keeps its list the catalogue's, and checks the
 * parts bring nothing the old permission didn't.
 */

const MIGRATION = "prisma/migrations/20270118000000_split_permissions_granted/migration.sql"
const sql = readFileSync(MIGRATION, "utf8")
const SPLIT = ALL_PERMISSIONS.filter(isSplit)
const pairs = SPLIT.flatMap(old => splitParts(old).map(part => `('${old}', '${part}')`)).sort()

/** Everything a permission brings with it, itself included, as far as it goes. */
function brought(permission: Permission): Set<Permission> {
    const seen = new Set<Permission>()
    const walk = (p: Permission) => {
        if (seen.has(p)) return
        seen.add(p)
        for (const next of (definitionOf(p).implies ?? []) as readonly Permission[]) walk(next)
    }
    walk(permission)
    return seen
}

describe("the migration", () => {
    it("knows every permission split, and each of its parts, as the catalogue does", () => {
        expect(SPLIT.length).toBe(9)
        // Once for the roles, once for the templates.
        const lists = [...sql.matchAll(/parts\("old", "part"\) AS \(VALUES\n([\s\S]*?)\n\)/g)].map(m => m[1].split(",\n").map(l => l.trim()).sort())
        expect(lists).toHaveLength(2)
        for (const listed of lists) expect(listed).toEqual(pairs)
    })

    it("keeps the wider scope where a role holds a part already, and has the roles changed reload", () => {
        expect(sql).toContain('ON CONFLICT ("roleId", "permission") DO UPDATE SET "scope" = GREATEST("RoleGrant"."scope", EXCLUDED."scope")')
        expect(sql).toContain('DELETE FROM "RoleGrant" g USING parts p WHERE g."permission" = p."old"')
        expect(sql).toContain('UPDATE "Role" SET "version" = "version" + 1, "updatedAt" = now()')
    })
})

describe("a role's rows, as the app reads them", () => {
    it("never narrow a part held wider than the permission split into it, in either order, as the migration keeps the wider", () => {
        const rows = [{ permission: "obligations.delete", scope: "COMPANY" }, { permission: "obligations.manage", scope: "TEAM" }]
        for (const order of [rows, [...rows].reverse()]) {
            expect(grantsFromRows(order)).toMatchObject({ "obligations.delete": "COMPANY", "obligations.create": "TEAM", "obligations.edit": "TEAM", "obligations.approve": "TEAM" })
        }
        // A part held narrower is read at the split one's scope.
        expect(grantsFromRows([{ permission: "obligations.approve", scope: "TEAM" }, { permission: "obligations.manage", scope: "COMPANY" }])["obligations.approve"]).toBe("COMPANY")
    })
})

describe("the parts", () => {
    it("bring nothing the old permission didn't", () => {
        for (const old of SPLIT) {
            const allowed = new Set<Permission>([...splitParts(old), ...brought(old)])
            for (const part of splitParts(old)) {
                for (const p of brought(part)) expect(allowed.has(p), `${part} brings ${p}, which ${old} didn't`).toBe(true)
            }
        }
    })

    it("need nothing first that the old permission didn't", () => {
        for (const old of SPLIT) {
            const allowed = new Set<Permission>([...splitParts(old), ...brought(old), ...requiresOf(old)])
            for (const part of splitParts(old)) {
                for (const p of requiresOf(part)) expect(allowed.has(p), `${part} needs ${p}, which ${old} didn't`).toBe(true)
            }
        }
    })

    it("are each at the scopes the old permission was", () => {
        for (const old of SPLIT) {
            for (const part of splitParts(old)) expect(definitionOf(part).scopes, `${old} → ${part}`).toEqual(definitionOf(old).scopes)
        }
    })
})

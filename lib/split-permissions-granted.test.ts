import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { RETIRED, isPermission } from "@/lib/permissions/catalogue"

/**
 * The grant for companies already there (LATER_CHANGES_PLAN.md §2, PR 385):
 * one migration replaced every split permission, in each role and template,
 * by its parts at its scope. What it does to a real database is
 * lib/roles.db.test.ts's; this keeps its two lists the same, every part one
 * the catalogue has, and every name it replaced one retired since (PR 386).
 */

const MIGRATION = "prisma/migrations/20270118000000_split_permissions_granted/migration.sql"
const sql = readFileSync(MIGRATION, "utf8")
// Once for the roles, once for the templates.
const lists = [...sql.matchAll(/parts\("old", "part"\) AS \(VALUES\n([\s\S]*?)\n\)/g)].map(m => m[1].split(",\n").map(l => l.trim()).sort())
const pairs = (lists[0] ?? []).map(l => l.match(/^\('([a-z_.]+)', '([a-z_.]+)'\)$/)!.slice(1) as [string, string])

describe("the migration", () => {
    it("lists the same pairs for the roles and the templates", () => {
        expect(lists).toHaveLength(2)
        expect(lists[1]).toEqual(lists[0])
        expect(pairs).toHaveLength(21)
    })

    it("writes only permissions the catalogue has, in place of exactly those retired since (PR 386)", () => {
        for (const [, part] of pairs) expect(isPermission(part), part).toBe(true)
        expect([...new Set(pairs.map(([old]) => old))].sort()).toEqual(Object.keys(RETIRED).sort())
    })

    it("keeps the wider scope where a role holds a part already, and has the roles changed reload", () => {
        expect(sql).toContain('ON CONFLICT ("roleId", "permission") DO UPDATE SET "scope" = GREATEST("RoleGrant"."scope", EXCLUDED."scope")')
        expect(sql).toContain('DELETE FROM "RoleGrant" g USING parts p WHERE g."permission" = p."old"')
        expect(sql).toContain('UPDATE "Role" SET "version" = "version" + 1, "updatedAt" = now()')
    })
})

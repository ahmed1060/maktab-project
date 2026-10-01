import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { BUILT_IN_GRANTS } from "@/lib/permissions/built-in"
import { isPermission } from "@/lib/permissions/catalogue"

/**
 * The migration that made roles data seeds every company's built-in roles
 * from a list written into its SQL; a later one that gives the built-in roles
 * a new permission adds to that list the same way. Together they must be
 * lib/permissions/built-in.ts exactly — it is what nobody's access changing
 * rests on — so they are read back out of the files and compared, both ways.
 */
const SQL = readFileSync("prisma/migrations/20260927000000_roles/migration.sql", "utf8")
const LATER = [
    // The built-in Admin role's settings.view and settings.edit (ATTENDANCE_PLAN.md §5.2).
    "prisma/migrations/20261006000000_admin_settings/migration.sql",
    // The built-in Admin role's attendance.view_team and attendance.correct (ATTENDANCE_PLAN.md §14).
    "prisma/migrations/20261010000000_attendance_punches/migration.sql",
    // The built-in Admin role's attendance.approve_overtime and attendance.approve_permissions (§6.4, §6.6).
    "prisma/migrations/20261012000000_attendance_requests/migration.sql",
].map(path => readFileSync(path, "utf8"))

function seeded(): Record<string, Record<string, string>> {
    const out: Record<string, Record<string, string>> = {}
    for (const sql of [SQL, ...LATER]) {
        const block = sql.slice(sql.indexOf('INSERT INTO "RoleGrant"'), sql.indexOf('AS g("builtIn"'))
        for (const [, role, permission, scope] of block.matchAll(/\('(\w+)', '([\w.]+)', '(\w+)'\)/g)) {
            ;(out[role] ??= {})[permission] = scope
        }
    }
    return out
}

describe("the roles migration seeds the built-in grants", () => {
    it("exactly as lib/permissions/built-in.ts has them", () => {
        const fromSql = seeded()
        for (const role of ["ADMIN", "TEAM_LEADER", "EMPLOYEE"] as const) {
            expect(fromSql[role] ?? {}, role).toEqual(BUILT_IN_GRANTS[role])
        }
    })

    it("names only permissions that exist", () => {
        const unknown = Object.values(seeded()).flatMap(g => Object.keys(g)).filter(p => !isPermission(p))
        expect(unknown).toEqual([])
    })

    it("creates the three built-in roles and nothing based on the Super Admin", () => {
        expect(SQL).toContain("('Admin', 'ADMIN')")
        expect(SQL).toContain("('Team Leader', 'TEAM_LEADER')")
        expect(SQL).toContain("('Employee', 'EMPLOYEE')")
        expect(SQL).toContain(`CHECK ("baseRole" <> 'SUPER_ADMIN')`)
    })
})

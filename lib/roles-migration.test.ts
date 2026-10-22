import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { BUILT_IN_GRANTS } from "@/lib/permissions/built-in"
import { isPermission } from "@/lib/permissions/catalogue"
import { permissionOf } from "@/lib/permissions/stored-names"

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
    // The built-in Admin role's attendance.approve_devices (§9.3).
    "prisma/migrations/20261021000000_attendance_check_in_phones/migration.sql",
    // The built-in Admin role's attendance.approve_face (§9.5).
    "prisma/migrations/20261026000000_face_switches/migration.sql",
].map(path => readFileSync(path, "utf8"))

// A later one that renames permissions: clients.* became records.*, for the
// old Clients section moving onto each client (CLIENTS_PLAN.md §0.2). The
// names it renames are read out of its SQL too. And vendors.* became
// clients.*, in code in 0b and in the rows in 0c, which a later migration
// rewrites: read here as the new (lib/permissions/stored-names.ts).
const RENAMING = readFileSync("prisma/migrations/20261104000000_records_on_clients/migration.sql", "utf8")
function renamed(): Record<string, string> {
    const list = RENAMING.match(/WHEN name IN \(([^)]*)\)\s*THEN 'records\.' \|\| substr\(name, length\('clients\.'\) \+ 1\)/)
    if (!list) throw new Error("the rename's list of names wasn't found")
    return Object.fromEntries([...list[1].matchAll(/'clients\.(\w+)'/g)].map(([old, verb]) => [old.slice(1, -1), `records.${verb}`]))
}

function seeded(): Record<string, Record<string, string>> {
    const out: Record<string, Record<string, string>> = {}
    const rename = renamed()
    for (const sql of [SQL, ...LATER]) {
        const block = sql.slice(sql.indexOf('INSERT INTO "RoleGrant"'), sql.indexOf('AS g("builtIn"'))
        for (const [, role, permission, scope] of block.matchAll(/\('(\w+)', '([\w.]+)', '(\w+)'\)/g)) {
            ;(out[role] ??= {})[rename[permission] ?? permissionOf(permission)] = scope
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

    it("renames each of the old Clients section's four permissions", () => {
        expect(renamed()).toEqual({
            "clients.view": "records.view", "clients.contribute": "records.contribute",
            "clients.edit": "records.edit", "clients.delete": "records.delete",
        })
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

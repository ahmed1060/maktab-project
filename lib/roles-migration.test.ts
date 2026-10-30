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
    // The built-in Admin role's attendance.approve_devices (§9.3).
    "prisma/migrations/20261021000000_attendance_check_in_phones/migration.sql",
    // The built-in Admin role's attendance.approve_face (§9.5).
    "prisma/migrations/20261026000000_face_switches/migration.sql",
    // The built-in Admin and Team Leader roles' locations.* (CLIENTS_PLAN.md §2.9).
    "prisma/migrations/20261110000000_locations_granted/migration.sql",
    // The built-in roles' lists.* (CLIENTS_PLAN.md §5.7, §5.10).
    "prisma/migrations/20261116000000_lists_granted/migration.sql",
    // The built-in Admin and Team Leader roles' charges.* (CLIENTS_PLAN.md §6.6, §6.8).
    "prisma/migrations/20261119000000_charges_granted/migration.sql",
].map(path => readFileSync(path, "utf8"))

// A later one that renames permissions: clients.* became records.*, for the
// old Clients section moving onto each client (CLIENTS_PLAN.md §0.2). The
// names it renames are read out of its SQL too. And another: vendors.*
// became clients.*, in code in 0b and in the rows in 0c (CLIENTS_PLAN.md
// §0.3), whose names are read the same way.
const RENAMING = readFileSync("prisma/migrations/20261104000000_records_on_clients/migration.sql", "utf8")
const CLIENT_NAMES = readFileSync("prisma/migrations/20261107000000_client_names_stored/migration.sql", "utf8")
function renamed(): Record<string, string> {
    const list = RENAMING.match(/WHEN name IN \(([^)]*)\)\s*THEN 'records\.' \|\| substr\(name, length\('clients\.'\) \+ 1\)/)
    if (!list) throw new Error("the rename's list of names wasn't found")
    const clients = CLIENT_NAMES.match(/UPDATE "RoleGrant" SET "permission" = 'clients\.' \|\| substr\("permission", length\('vendors\.'\) \+ 1\)\s*WHERE "permission" IN \(([^)]*)\)/)
    if (!clients) throw new Error("0c's list of names wasn't found")
    return {
        ...Object.fromEntries([...list[1].matchAll(/'clients\.(\w+)'/g)].map(([old, verb]) => [old.slice(1, -1), `records.${verb}`])),
        ...Object.fromEntries([...clients[1].matchAll(/'vendors\.(\w+)'/g)].map(([old, verb]) => [old.slice(1, -1), `clients.${verb}`])),
    }
}

function seeded(): Record<string, Record<string, string>> {
    const out: Record<string, Record<string, string>> = {}
    const rename = renamed()
    for (const sql of [SQL, ...LATER]) {
        const block = sql.slice(sql.indexOf('INSERT INTO "RoleGrant"'), sql.indexOf('AS g("builtIn"'))
        for (const [, role, permission, scope] of block.matchAll(/\('(\w+)', '([\w.]+)', '(\w+)'\)/g)) {
            ;(out[role] ??= {})[rename[permission] ?? permission] = scope
        }
    }
    return out
}

/**
 * Built-in grants a new company's roles get now, which the companies there
 * already are get from a later PR's migration (CLIENTS_PLAN.md §7.8): it runs
 * once this release, whose role editor knows them, is live, so no editor that
 * doesn't know them can drop them meanwhile.
 */
const GRANTED_LATER = ["cash_advances.view", "cash_advances.give"]

describe("the roles migration seeds the built-in grants", () => {
    it("exactly as lib/permissions/built-in.ts has them", () => {
        const fromSql = seeded()
        for (const role of ["ADMIN", "TEAM_LEADER", "EMPLOYEE"] as const) {
            const now = Object.fromEntries(Object.entries(BUILT_IN_GRANTS[role]).filter(([permission]) => !GRANTED_LATER.includes(permission)))
            expect(fromSql[role] ?? {}, role).toEqual(now)
        }
    })

    it("renames each of the old Clients section's four permissions, then the vendors' two", () => {
        expect(renamed()).toEqual({
            "clients.view": "records.view", "clients.contribute": "records.contribute",
            "clients.edit": "records.edit", "clients.delete": "records.delete",
            "vendors.view": "clients.view", "vendors.manage": "clients.manage",
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

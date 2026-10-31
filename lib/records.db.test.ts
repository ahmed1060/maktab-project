import { describe, it, expect, beforeAll, afterAll, vi } from "vitest"
import { readFileSync, readdirSync } from "node:fs"
import { Client } from "pg"
import { withGrants } from "@/lib/permissions/test-actors"

/**
 * A client's records against a real Postgres (CLIENTS_PLAN.md §0.2): the
 * migration that moved them onto clients, and RecordService reading and
 * writing what the database accepts. The database is built from every
 * migration in order, with the old Clients section's data and permissions in
 * it before the records one runs.
 *
 * Needs a Postgres it may create databases on: set ROLES_TEST_DATABASE_URL to
 * its maintenance database. Skipped without it (CI has no database).
 */

const ADMIN_URL = process.env.ROLES_TEST_DATABASE_URL
const MIGRATIONS = readdirSync("prisma/migrations").filter(m => m !== "migration_lock.toml").sort((a, b) => (a === "0_init" ? -1 : b === "0_init" ? 1 : a.localeCompare(b)))
const RECORDS = "20261104000000_records_on_clients"
const CLIENT_NAMES = "20261107000000_client_names_stored"
const DATABASE_NAMES = "20261108000000_client_names_in_database"
const sql = (name: string) => readFileSync(`prisma/migrations/${name}/migration.sql`, "utf8")

const BUCKET = "https://abc.supabase.co/storage/v1/object/public/app-assets"
const removed: string[] = []
// Storage answers a refused removal with an error, rather than throwing.
let refuseRemoval = false
// How long storage takes to remove files, for a test that needs it to take a moment.
let removalTakes = 0
// How many calls to come storage refuses, after which it removes again.
let refuseCalls = 0
// Files never uploaded, though their addresses look like this company's.
const notStored = new Set<string>()
vi.mock("@/lib/storage", () => ({
    supabase: { storage: { from: () => ({ exists: async (path: string) => ({ data: !notStored.has(path) && !removed.includes(path), error: null }), remove: async (paths: string[]) => {
        if (removalTakes) await new Promise(r => setTimeout(r, removalTakes))
        // Storage takes only so many files in one call, and refuses more.
        if (paths.length > 100) return { data: null, error: { message: "Too many keys" } }
        if (refuseCalls > 0) return (refuseCalls--, { data: null, error: { message: "Service unavailable" } })
        return refuseRemoval ? { data: null, error: { message: "Forbidden" } } : (removed.push(...paths), { data: [], error: null })
    } }) } },
    uploadToCloud: async () => { throw new Error("no uploads here") },
}))

const PEOPLE = `
INSERT INTO "Company"(id, name, "updatedAt") VALUES ('c1', 'One', now()), ('c2', 'Two', now());
INSERT INTO "User"(id, email, password, "firstName", "lastName", role, "lastDayOffResetYear", username, "companyId", "teamLeaderId") VALUES
 ('a1', 'a1@x', 'p', 'Amal', 'One', 'ADMIN', 2026, 'a1', 'c1', NULL),
 ('e1', 'e1@x', 'p', 'Ehab', 'One', 'EMPLOYEE', 2026, 'e1', 'c1', NULL),
 ('a2', 'a2@x', 'p', 'Adel', 'Two', 'ADMIN', 2026, 'a2', 'c2', NULL);
`
// What the old Clients section held, and a template and names, before the records migration.
const OLD_SECTION = `
INSERT INTO "Client"(id, name, "companyId", "updatedAt") VALUES ('old', 'Old business', 'c1', now());
INSERT INTO "ClientSection"(id, title, "clientId", "updatedAt") VALUES ('old-s', 'Old section', 'old', now());
INSERT INTO "ClientNote"(id, content, "sectionId", "updatedAt", "expiryDate") VALUES ('old-n', 'Old note', 'old-s', now(), '2026-10-16');
INSERT INTO "RoleTemplate"(id, name, "baseRole", grants, "updatedAt") VALUES ('t', 'Desk', 'EMPLOYEE', '[{"permission":"tasks.view","scope":"TEAM"},{"permission":"clients.delete","scope":"COMPANY"}]', now());
UPDATE "Company" SET "moduleLabels" = '{"clients":"Files","tasks":"Jobs"}', "moduleIcons" = '{"clients":"📁"}' WHERE id = 'c1';
`

// What 0b's code, which wrote the old names, left before 0c's migration: a
// role holding a permission under both names, a template, and a company's
// own name and icon for Clients.
const AS_0B_WROTE = `
INSERT INTO "Role"(id, "companyId", name, "baseRole", "updatedAt") VALUES ('r-0b', 'c1', 'Saved by 0b', 'EMPLOYEE', now());
INSERT INTO "RoleGrant"("roleId", permission, scope) VALUES ('r-0b', 'vendors.view', 'COMPANY'), ('r-0b', 'vendors.manage', 'COMPANY'), ('r-0b', 'clients.manage', 'COMPANY'), ('r-0b', 'tasks.view', 'TEAM');
INSERT INTO "RoleTemplate"(id, name, "baseRole", grants, "updatedAt") VALUES ('t-0b', 'Supplier desk', 'EMPLOYEE', '[{"permission":"vendors.manage","scope":"COMPANY"},{"permission":"tasks.view","scope":"TEAM"},{"permission":"vendors.view","scope":"COMPANY"}]', now());
UPDATE "Company" SET "moduleLabels" = '{"vendors":"Suppliers","tasks":"Jobs"}', "moduleIcons" = '{"vendors":"🚛"}' WHERE id = 'c2';
`

// What 0b's code wrote while 0c waited for review, under the old names, and
// what 0d renames: a vendor with a section and a task, a grant, and a
// company's name for Clients, saved whole.
const AS_0B_WROTE_LATER = `
INSERT INTO "Vendor"(id, "companyId", name, "ownerName", "mobileNumber", "locationName", "updatedAt") VALUES ('v0', 'c2', 'Older', 'Sami', '0109', 'Qena', now());
INSERT INTO "ClientSection"(id, title, "vendorId", "updatedAt") VALUES ('s0', 'Kept', 'v0', now());
INSERT INTO "Task"(id, title, description, status, deadline, "updatedAt", "companyId", "vendorId") VALUES ('t0', 'Visit', 'Visit them', 'PENDING', now(), now(), 'c2', 'v0');
INSERT INTO "RoleGrant"("roleId", permission, scope) VALUES ('r-0b', 'vendors.view', 'COMPANY');
UPDATE "Company" SET "moduleLabels" = '{"vendors":"Partners"}' WHERE id = 'c2';
`

const admin = { user: withGrants({ id: "a1", role: "ADMIN", companyId: "c1" }) } as any
const employee = { user: withGrants({ id: "e1", role: "EMPLOYEE", companyId: "c1" }) } as any
const otherAdmin = { user: withGrants({ id: "a2", role: "ADMIN", companyId: "c2" }) } as any
const superAdmin = { user: { id: "sa1", role: "SUPER_ADMIN", companyId: null } } as any
const file = (company: string, name: string) => ({ url: `${BUCKET}/${company}/records/${name}`, name, size: 100 })

describe.skipIf(!ADMIN_URL)("records on clients, in Postgres", () => {
    const dbName = `records_test_${Date.now()}`
    let db: Client
    let Records: typeof import("@/lib/services/record.service").RecordService
    let Clients: typeof import("@/lib/services/client.service").ClientService
    let CLIENTS_SHOWN: number

    beforeAll(async () => {
        const a = new Client({ connectionString: ADMIN_URL })
        await a.connect()
        await a.query(`CREATE DATABASE ${dbName}`)
        await a.end()
        const url = new URL(ADMIN_URL!)
        url.pathname = `/${dbName}`
        db = new Client({ connectionString: url.toString() })
        await db.connect()
        for (const m of MIGRATIONS) {
            if (m === RECORDS) await db.query(OLD_SECTION)
            if (m === CLIENT_NAMES) await db.query(AS_0B_WROTE)
            if (m === DATABASE_NAMES) await db.query(AS_0B_WROTE_LATER)
            await db.query(sql(m))
            if (m === "20260920000000_team_leader") await db.query(PEOPLE)
        }
        await db.query(`INSERT INTO "SuperAdmin"(id, email, password, "firstName", "lastName", username, "isProtected", "updatedAt") VALUES ('sa1', 'sa@x', 'p', 'Sam', 'Admin', 'sa1', true, now())`)
        await db.query(`INSERT INTO "Client"(id, "companyId", name, "ownerName", "mobileNumber", "locationName", "updatedAt") VALUES
            ('v1', 'c1', 'Acme', 'Mona', '0100', 'Cairo', now()),
            ('v2', 'c1', 'Beta', 'Omar', '0101', 'Giza', now()),
            ('v3', 'c2', 'Gamma', 'Sara', '0102', 'Alex', now())`)
        process.env.POSTGRES_PRISMA_URL = url.toString()
        process.env.NEXT_PUBLIC_SUPABASE_URL = "https://abc.supabase.co"
        // Today is 16 October 2026 where the company is; only the clock is faked.
        vi.useFakeTimers({ toFake: ["Date"] })
        vi.setSystemTime(new Date("2026-10-16T09:00:00Z"))
        const service = await import("@/lib/services/record.service")
        Records = service.RecordService
        CLIENTS_SHOWN = service.CLIENTS_SHOWN
        Clients = (await import("@/lib/services/client.service")).ClientService
    }, 180_000)

    afterAll(async () => {
        vi.useRealTimers()
        delete process.env.NEXT_PUBLIC_SUPABASE_URL
        await (await import("@/lib/prisma")).prisma.$disconnect()
        await db?.end()
        const a = new Client({ connectionString: ADMIN_URL })
        await a.connect()
        await a.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`)
        await a.end()
    })

    describe("the migration", () => {
        it("renames the old section's permissions, in roles and templates, and has their holders reload", async () => {
            const { rows } = await db.query(`SELECT r."builtIn", g.permission, r.version FROM "RoleGrant" g JOIN "Role" r ON r.id = g."roleId" WHERE r."companyId" = 'c1' AND (g.permission IN ('clients.contribute', 'clients.edit', 'clients.delete') OR g.permission LIKE 'records.%') ORDER BY 1, 2`)
            expect(rows.map(r => `${r.builtIn} ${r.permission}`).sort()).toEqual([
                "ADMIN records.contribute", "ADMIN records.delete", "ADMIN records.edit", "ADMIN records.view",
                "EMPLOYEE records.contribute", "EMPLOYEE records.view",
                "TEAM_LEADER records.contribute", "TEAM_LEADER records.edit", "TEAM_LEADER records.view",
            ])
            const { rows: [employeeRole] } = await db.query(`SELECT version FROM "Role" WHERE "companyId" = 'c1' AND "builtIn" = 'EMPLOYEE'`)
            // Once for the renaming, once more for 5b's lists.add (CLIENTS_PLAN.md §5.10), and
            // once for 2b's dayoff.request (UI_PLAN.md §2.3).
            expect(employeeRole.version).toBe(4)
            const { rows: [template] } = await db.query(`SELECT grants FROM "RoleTemplate" WHERE id = 't'`)
            expect(template.grants).toEqual([{ permission: "tasks.view", scope: "TEAM" }, { permission: "records.delete", scope: "COMPANY" }])
        })

        it("moves a company's own name and icon for the section to Records", async () => {
            const { rows: [company] } = await db.query(`SELECT "moduleLabels", "moduleIcons" FROM "Company" WHERE id = 'c1'`)
            expect(company).toEqual({ moduleLabels: { records: "Files", tasks: "Jobs" }, moduleIcons: { records: "📁" } })
        })

        it("rewrites the stored names of Clients' permissions, keeping one of a role's held under both (0c)", async () => {
            const grants = async (where: string) => (await db.query(`SELECT r.id, g.permission, g.scope FROM "RoleGrant" g JOIN "Role" r ON r.id = g."roleId" WHERE ${where} ORDER BY 1, 2`)).rows.map(r => `${r.permission} ${r.scope}`)
            expect(await grants(`g.permission LIKE 'vendors.%'`)).toEqual([])
            // With Add list names, which 5b gives every role (CLIENTS_PLAN.md §5.10), and Ask
            // for leave, which 2b gives every role of a company's own (UI_PLAN.md §2.3).
            expect(await grants(`r.id = 'r-0b'`)).toEqual(["clients.manage COMPANY", "clients.view COMPANY", "dayoff.request OWN", "lists.add COMPANY", "tasks.view TEAM"])
            // The built-in roles the roles migration seeded with vendors.*.
            expect(await grants(`r."companyId" = 'c1' AND r."builtIn" = 'ADMIN' AND g.permission LIKE 'clients.%'`)).toEqual(["clients.manage COMPANY", "clients.view COMPANY"])
            const { rows: [template] } = await db.query(`SELECT grants FROM "RoleTemplate" WHERE id = 't-0b'`)
            expect(template.grants).toEqual([{ permission: "clients.manage", scope: "COMPANY" }, { permission: "tasks.view", scope: "TEAM" }, { permission: "clients.view", scope: "COMPANY" }])
        })

        it("moves a company's own name and icon for Clients to the module's new key, as 0c found them and 0b saved them since (0c, 0d)", async () => {
            const { rows: [company] } = await db.query(`SELECT "moduleLabels", "moduleIcons" FROM "Company" WHERE id = 'c2'`)
            expect(company).toEqual({ moduleLabels: { clients: "Partners" }, moduleIcons: { clients: "🚛" } })
        })

        it("renames vendors to clients in the database, with what 0b wrote while 0c waited for review (0d)", async () => {
            expect((await db.query(`SELECT to_regclass('"Vendor"') AS t`)).rows[0].t).toBeNull()
            expect((await db.query(`SELECT id, name FROM "Client" WHERE id = 'v0'`)).rows).toEqual([{ id: "v0", name: "Older" }])
            expect((await db.query(`SELECT "clientId" FROM "ClientSection" WHERE id = 's0'`)).rows).toEqual([{ clientId: "v0" }])
            expect((await db.query(`SELECT "clientId" FROM "Task" WHERE id = 't0'`)).rows).toEqual([{ clientId: "v0" }])
            const columns = (await db.query(`SELECT table_name, column_name FROM information_schema.columns WHERE column_name IN ('vendorId', 'clientId') AND table_name IN ('Task', 'ClientSection') ORDER BY 1, 2`)).rows
            expect(columns).toEqual([{ table_name: "ClientSection", column_name: "clientId" }, { table_name: "Task", column_name: "clientId" }])
            // The grant 0b wrote under the old name, which the role already held under the new.
            expect((await db.query(`SELECT permission FROM "RoleGrant" WHERE "roleId" = 'r-0b' AND permission LIKE '%.view' ORDER BY 1`)).rows.map(r => r.permission)).toEqual(["clients.view", "tasks.view"])
            expect((await db.query(`SELECT count(*)::int AS n FROM "RoleGrant" WHERE permission LIKE 'vendors.%'`)).rows[0].n).toBe(0)
            // Deleting a client still takes its sections, and leaves its tasks.
            await db.query(`DELETE FROM "Client" WHERE id = 'v0'`)
            expect((await db.query(`SELECT count(*)::int AS n FROM "ClientSection" WHERE id = 's0'`)).rows[0].n).toBe(0)
            expect((await db.query(`SELECT "clientId" FROM "Task" WHERE id = 't0'`)).rows).toEqual([{ clientId: null }])
            await db.query(`DELETE FROM "Task" WHERE id = 't0'`)
        })

        it("no longer renames a name on the way in, now that clients.* names the businesses (0b)", async () => {
            const { rows: triggers } = await db.query(`SELECT tgname FROM pg_trigger WHERE NOT tgisinternal AND tgname LIKE '%records%'`)
            expect(triggers).toEqual([])
            const { rows: functions } = await db.query(`SELECT proname FROM pg_proc WHERE proname LIKE '%records\\_%' AND pronamespace = 'public'::regnamespace`)
            expect(functions).toEqual([])
            const { rows: [grant] } = await db.query(`INSERT INTO "RoleGrant"("roleId", permission, scope) SELECT id, 'clients.view', 'COMPANY' FROM "Role" WHERE "companyId" = 'c2' AND "builtIn" = 'EMPLOYEE' RETURNING permission`)
            expect(grant.permission).toBe("clients.view")
            await db.query(`DELETE FROM "RoleGrant" WHERE permission = 'clients.view'`)
            const { rows: [company] } = await db.query(`UPDATE "Company" SET "moduleLabels" = '{"clients":"Accounts"}' WHERE id = 'c2' RETURNING "moduleLabels"`)
            expect(company.moduleLabels).toEqual({ clients: "Accounts" })
            await db.query(`UPDATE "Company" SET "moduleLabels" = NULL WHERE id = 'c2'`)
        })

        it("deletes the old section's own sections and their records (0b), and every section has a client (0d)", async () => {
            expect((await db.query(`SELECT id FROM "ClientSection" WHERE id = 'old-s'`)).rows).toEqual([])
            expect((await db.query(`SELECT id FROM "ClientNote" WHERE id = 'old-n'`)).rows).toEqual([])
            await expect(db.query(`INSERT INTO "ClientSection"(id, title, "updatedAt") VALUES ('none', 'Nobody''s', now())`)).rejects.toThrow(/"clientId".*not-null|null value in column "clientId"/)
        })
    })

    describe("Clients grants, under their new names", () => {
        let Roles: typeof import("@/lib/services/role.service").RoleService
        let Templates: typeof import("@/lib/services/role-template.service").RoleTemplateService
        beforeAll(async () => {
            Roles = (await import("@/lib/services/role.service")).RoleService
            Templates = (await import("@/lib/services/role-template.service")).RoleTemplateService
        })
        const stored = async (roleId: string) =>
            (await db.query(`SELECT permission, scope FROM "RoleGrant" WHERE "roleId" = $1 ORDER BY permission`, [roleId])).rows.map(r => `${r.permission} ${r.scope}`)

        it("are written under their new names", async () => {
            const role = await Roles.create({ companyId: "c1", name: "Desk", baseRole: "EMPLOYEE", grants: [{ permission: "clients.manage", scope: "COMPANY" }, { permission: "tasks.view", scope: "TEAM" }] }, superAdmin)
            expect(await stored(role.id)).toEqual(["clients.manage COMPANY", "clients.view COMPANY", "tasks.view TEAM"])
            await Roles.update({ id: role.id, grants: [{ permission: "clients.view", scope: "COMPANY" }] }, superAdmin)
            expect(await stored(role.id)).toEqual(["clients.view COMPANY"])
        })

        it("are what a session holds, and who can do what, says", async () => {
            const role = await Roles.create({ companyId: "c1", name: "Viewer", baseRole: "EMPLOYEE", grants: [{ permission: "clients.view", scope: "COMPANY" }] }, superAdmin)
            await db.query(`UPDATE "User" SET "roleId" = $1 WHERE id = 'e1'`, [role.id])
            try {
                const { decodeGrants } = await import("@/lib/permissions/grants")
                expect(decodeGrants((await Roles.forToken("e1")).grants)).toMatchObject({ "clients.view": "COMPANY" })
                const { AccessReportService } = await import("@/lib/services/access-report.service")
                expect((await AccessReportService.whoCan("c1", "clients.view")).holders).toContainEqual(expect.objectContaining({ user: expect.objectContaining({ id: "e1" }), scope: "COMPANY" }))
                expect((await AccessReportService.whatCan("e1")).grants).toContainEqual({ permission: "clients.view", module: "CLIENTS", scope: "COMPANY" })
            } finally {
                await db.query(`UPDATE "User" SET "roleId" = (SELECT id FROM "Role" WHERE "companyId" = 'c1' AND "builtIn" = 'EMPLOYEE') WHERE id = 'e1'`)
            }
        })

        it("are written under their new names in a template", async () => {
            const template = await Templates.create({ name: "Clients desk", baseRole: "EMPLOYEE", grants: [{ permission: "clients.view", scope: "COMPANY" }, { permission: "tasks.view", scope: "TEAM" }] }, superAdmin)
            const grants = async () => (await db.query(`SELECT grants FROM "RoleTemplate" WHERE id = $1`, [template.id])).rows[0].grants
            expect(await grants()).toEqual([{ permission: "tasks.view", scope: "TEAM" }, { permission: "clients.view", scope: "COMPANY" }])
            await Templates.update({ id: template.id, grants: [{ permission: "clients.manage", scope: "COMPANY" }] }, superAdmin)
            expect((await Templates.getById(template.id)).grants).toEqual([{ permission: "clients.view", scope: "COMPANY" }, { permission: "clients.manage", scope: "COMPANY" }])
            // A role made from it holds what it says.
            const role = await Roles.create({ companyId: "c1", name: "From the desk", fromTemplateId: template.id }, superAdmin)
            expect(await stored(role.id)).toEqual(["clients.manage COMPANY", "clients.view COMPANY"])
        })

        it("keep a company's name and icon for Clients under the module's new key", async () => {
            const { CompanyService } = await import("@/lib/services/company.service")
            await CompanyService.update({ id: "c2", moduleLabels: { clients: "Customers", tasks: "Jobs" }, moduleIcons: { clients: "🏥" } } as any, superAdmin)
            const { rows: [company] } = await db.query(`SELECT "moduleLabels", "moduleIcons" FROM "Company" WHERE id = 'c2'`)
            expect(company).toEqual({ moduleLabels: { clients: "Customers", tasks: "Jobs" }, moduleIcons: { clients: "🏥" } })
            await db.query(`UPDATE "Company" SET "moduleLabels" = NULL, "moduleIcons" = NULL WHERE id = 'c2'`)
        })
    })

    describe("RecordService", () => {
        let licence: string, contract: string, note: string, gamma: string

        it("starts a client's first section by name, and a second record of that name goes into it", async () => {
            const later = () => vi.setSystemTime(new Date(Date.now() + 1000))
            licence = (await Records.create(admin, { content: "Commercial register", files: [file("c1", "reg.pdf")], expiryDate: "2026-10-20", reminderDays: 7, clientId: "v1", sectionTitle: "Licences" })).id
            later()
            contract = (await Records.create(employee, { content: "Supply contract", files: [], expiryDate: "2026-10-01", reminderDays: null, clientId: "v1", sectionTitle: "Licences" })).id
            const { sections } = await Records.sectionsOf(admin, "v1")
            expect(sections).toEqual([{ id: expect.any(String), title: "Licences", records: 2 }])
            later()
            note = (await Records.create(admin, { content: "Call before visiting", files: [], expiryDate: null, reminderDays: null, clientId: "v2", sectionTitle: "Notes" })).id
            later()
            gamma = (await Records.create(otherAdmin, { content: "Gamma licence", files: [], expiryDate: "2026-10-18", reminderDays: null, clientId: "v3", sectionTitle: "Licences" })).id
            await expect(Records.createSection(admin, { clientId: "v1", title: "Licences" })).rejects.toThrow("RECORD_SECTION_TAKEN")
        })

        it("lists the company's records across its clients, newest first, never another company's or the old section's", async () => {
            const { data, total } = await Records.list(admin, { page: 1, limit: 20 })
            expect(total).toBe(3)
            expect(data.map(r => r.content)).toEqual(["Call before visiting", "Supply contract", "Commercial register"])
            expect(data.find(r => r.id === licence)).toMatchObject({ client: { id: "v1", name: "Acme" }, section: { title: "Licences" }, expiryDate: "2026-10-20", expiry: "soon", files: [file("c1", "reg.pdf")] })
            // A Super Admin looking at every company sees which company each is in.
            const all = await Records.list(superAdmin, { page: 1, limit: 20 })
            expect(all.total).toBe(4)
            expect(all.data.find(r => r.id === gamma)!.client).toEqual({ id: "v3", name: "Gamma", company: "Two" })
        })

        it("finds a record by its text, its section's name or its client's name", async () => {
            const find = async (search: string) => (await Records.list(admin, { search, page: 1, limit: 20 })).data.map(r => r.id).sort()
            expect(await find("supply")).toEqual([contract])
            expect(await find("LICENCES")).toEqual([licence, contract].sort())
            expect(await find("beta")).toEqual([note])
            // A % or _ in what's typed is that letter, not any.
            expect(await find("%")).toEqual([])
            expect(await find("_")).toEqual([])
            expect(await find("supp_y")).toEqual([])
        })

        it("filters exactly what the badges say, soonest first", async () => {
            const soon = await Records.list(admin, { expiry: "soon", page: 1, limit: 20 })
            expect(soon.data.map(r => [r.id, r.expiry])).toEqual([[licence, "soon"]])
            const expired = await Records.list(admin, { expiry: "expired", page: 1, limit: 20 })
            expect(expired.data.map(r => [r.id, r.expiry])).toEqual([[contract, "expired"]])
            expect((await Records.list(admin, { clientId: "v2", page: 1, limit: 20 })).data.map(r => r.id)).toEqual([note])
        })

        it("hides another company's record, and refuses one's own company's without the permission", async () => {
            await expect(Records.get(otherAdmin, licence)).rejects.toThrow("RECORD_NOT_FOUND")
            await expect(Records.delete(employee, licence)).rejects.toThrow("RECORD_FORBIDDEN")
            await expect(Records.update(admin, { id: licence, content: "x", files: [], filesBefore: [file("c1", "reg.pdf").url], expiryDate: null, reminderDays: null, sectionId: (await Records.sectionsOf(otherAdmin, "v3")).sections[0].id })).rejects.toThrow("RECORD_SECTION_NOT_FOUND")
            await expect(Records.create(admin, { content: "x", files: [file("c2", "theirs.pdf")], expiryDate: null, reminderDays: null, clientId: "v1", sectionTitle: "Licences" })).rejects.toThrow("RECORD_FILE_INVALID")
        })

        it("refuses a file storage doesn't have, though its address is this company's", async () => {
            notStored.add("c1/records/made-up.pdf")
            const add = (files: ReturnType<typeof file>[]) => Records.create(admin, { content: "Permit", files, expiryDate: null, reminderDays: null, clientId: "v1", sectionTitle: "Licences" })
            await expect(add([file("c1", "made-up.pdf")])).rejects.toMatchObject({ message: "RECORD_FILE_INVALID" })
            const { id } = await add([file("c1", "kept-here.pdf")])
            const edit = (files: ReturnType<typeof file>[], content = "Permit") => Records.update(admin, { id, content, files, filesBefore: [file("c1", "kept-here.pdf").url], expiryDate: null, reminderDays: null })
            await expect(edit([file("c1", "kept-here.pdf"), file("c1", "made-up.pdf")])).rejects.toMatchObject({ message: "RECORD_FILE_INVALID" })
            // Only what's new is asked about: one the record has can't keep it from being edited.
            notStored.add("c1/records/kept-here.pdf")
            await edit([file("c1", "kept-here.pdf")], "Permit, renewed")
            expect((await Records.get(admin, id)).content).toBe("Permit, renewed")
            // Gone again, without storage, for the tests after that count the section's records.
            await db.query(`DELETE FROM "ClientNote" WHERE id = $1`, [id])
            notStored.clear()
        })

        it("takes a Super Admin's own upload only from a Super Admin, and keeps one a record has", async () => {
            const theirs = file("platform", "guide.pdf")
            const add = (who: any, files: ReturnType<typeof file>[]) => Records.create(who, { content: "Guide", files, expiryDate: null, reminderDays: null, clientId: "v2", sectionTitle: "Guides" })
            await expect(add(admin, [theirs])).rejects.toMatchObject({ message: "RECORD_FILE_INVALID" })
            const { id } = await add(superAdmin, [theirs])
            // An Admin edits it, keeping the file it has, but can't add another of the platform's.
            await Records.update(admin, { id, content: "Guide, edited", files: [theirs], filesBefore: [theirs.url], expiryDate: null, reminderDays: null })
            expect((await Records.get(admin, id)).files.map(f => f.url)).toEqual([theirs.url])
            await expect(Records.update(admin, { id, content: "Guide", files: [theirs, file("platform", "other.pdf")], filesBefore: [theirs.url], expiryDate: null, reminderDays: null })).rejects.toMatchObject({ message: "RECORD_FILE_INVALID" })
            // Gone again, without storage, for the tests after that count this client's records.
            await db.query(`DELETE FROM "ClientNote" WHERE id = $1`, [id])
        })

        it("refuses moving a record to a section deleted as it's moved, rather than failing", async () => {
            const { id } = await Records.create(admin, { content: "Moving", files: [], expiryDate: null, reminderDays: null, clientId: "v2", sectionTitle: "Moving from" })
            const to = await Records.createSection(admin, { clientId: "v2", title: "Moving to" })
            const { prisma } = await import("@/lib/prisma")
            const findUnique = prisma.recordSection.findUnique.bind(prisma.recordSection)
            // Deleted just after it's checked to be the same client's, before the record is moved into it.
            const spy = vi.spyOn(prisma.recordSection, "findUnique").mockImplementationOnce((async (args: any) => {
                const found = await findUnique(args)
                await db.query(`DELETE FROM "ClientSection" WHERE id = $1`, [to.id])
                return found
            }) as any)
            try {
                await expect(Records.update(admin, { id, content: "Moving", files: [], filesBefore: [], expiryDate: null, reminderDays: null, sectionId: to.id })).rejects.toMatchObject({ message: "RECORD_SECTION_NOT_FOUND" })
            } finally {
                spy.mockRestore()
            }
            expect((await Records.get(admin, id)).section.title).toBe("Moving from")
            // Gone again, for the tests after that count this client's records.
            await db.query(`DELETE FROM "ClientNote" WHERE id = $1`, [id])
        })

        it("refuses renaming a section deleted as it's renamed, rather than failing", async () => {
            const section = await Records.createSection(admin, { clientId: "v2", title: "Renaming" })
            const { prisma } = await import("@/lib/prisma")
            const findUnique = prisma.recordSection.findUnique.bind(prisma.recordSection)
            // Deleted just after it's found, before the rename is written.
            const spy = vi.spyOn(prisma.recordSection, "findUnique").mockImplementationOnce((async (args: any) => {
                const found = await findUnique(args)
                await db.query(`DELETE FROM "ClientSection" WHERE id = $1`, [section.id])
                return found
            }) as any)
            try {
                await expect(Records.renameSection(admin, { id: section.id, title: "Renamed" })).rejects.toMatchObject({ message: "RECORD_SECTION_NOT_FOUND" })
            } finally {
                spy.mockRestore()
            }
        })

        it("audits a rename from the title the section has as it's renamed", async () => {
            const section = await Records.createSection(admin, { clientId: "v2", title: "Audited A" })
            const { prisma } = await import("@/lib/prisma")
            const findUnique = prisma.recordSection.findUnique.bind(prisma.recordSection)
            // Renamed by someone else just after this rename found it.
            const spy = vi.spyOn(prisma.recordSection, "findUnique").mockImplementationOnce((async (args: any) => {
                const found = await findUnique(args)
                await db.query(`UPDATE "ClientSection" SET title = 'Audited B' WHERE id = $1`, [section.id])
                return found
            }) as any)
            try {
                await Records.renameSection(admin, { id: section.id, title: "Audited C" })
            } finally {
                spy.mockRestore()
            }
            const { rows: [audit] } = await db.query(`SELECT details FROM "AuditLog" WHERE action = 'UPDATE_SECTION' AND "entityId" = $1`, [section.id])
            expect(audit.details).toEqual({ before: { title: "Audited B" }, after: { title: "Audited C" } })
        })

        it("says when the list's day ends, the soonest of every company's for a Super Admin", async () => {
            // 09:00 UTC on 16 October: noon in Cairo, whose day ends at 21:00 UTC.
            expect((await Records.list(admin, { page: 1, limit: 1 })).dayEndsAt).toBe("2026-10-16T21:00:00.000Z")
            await db.query(`UPDATE "Company" SET timezone = 'Pacific/Honolulu' WHERE id = 'c2'`)
            try {
                // 23:00 on the 15th in Honolulu, whose day ends at 10:00 UTC.
                expect((await Records.list(superAdmin, { page: 1, limit: 1 })).dayEndsAt).toBe("2026-10-16T10:00:00.000Z")
                expect((await Records.list(superAdmin, { companyId: "c1", page: 1, limit: 1 })).dayEndsAt).toBe("2026-10-16T21:00:00.000Z")
            } finally {
                await db.query(`UPDATE "Company" SET timezone = 'Africa/Cairo' WHERE id = 'c2'`)
            }
        })

        it("says a record deleted as it's opened is not found", async () => {
            const { id } = await Records.create(admin, { content: "Going", files: [], expiryDate: null, reminderDays: null, clientId: "v1", sectionTitle: "Licences" })
            const { prisma } = await import("@/lib/prisma")
            const findUnique = prisma.clientRecord.findUnique.bind(prisma.clientRecord)
            // Deleted just after its company is looked up, before the record itself is read.
            const spy = vi.spyOn(prisma.clientRecord, "findUnique").mockImplementationOnce((async (args: any) => {
                const found = await findUnique(args)
                await db.query(`DELETE FROM "ClientNote" WHERE id = $1`, [id])
                return found
            }) as any)
            try {
                // Exactly: Prisma's own error quotes the code around it, this name included.
                await expect(Records.get(admin, id)).rejects.toMatchObject({ message: "RECORD_NOT_FOUND" })
            } finally {
                spy.mockRestore()
            }
        })

        it("reminds whoever added a record, the chosen days before and on the day, once per deadline", async () => {
            // The licence expires on the 20th, four days away, with a 7-day reminder.
            await db.query(`UPDATE "ClientNote" SET "expiryDate" = '2026-10-16' WHERE id = $1`, [gamma])
            expect(await Records.checkExpiries()).toMatchObject({ expiringToday: 1, reminded: 1 })
            const { rows } = await db.query(`SELECT "userId", type, "messageKey", "messageParams", "relatedId" FROM "Notification" ORDER BY type`)
            expect(rows).toEqual([
                { userId: "a2", type: "NOTE_EXPIRING", messageKey: "notice_note_expiring_today", messageParams: { snippet: "Gamma licence", client: "Gamma" }, relatedId: `/dashboard/records/${gamma}` },
                { userId: "a1", type: "NOTE_REMINDER", messageKey: "notice_note_expiring", messageParams: { snippet: "Commercial register", client: "Acme", days: 4 }, relatedId: `/dashboard/records/${licence}` },
            ].sort((a, b) => a.type.localeCompare(b.type)))
            // The old section's note expiring today is nobody's record now.
            expect(await Records.checkExpiries()).toMatchObject({ expiringToday: 0, reminded: 0 })
        })

        it("owes the reminders again when the date changes, and removes a file taken off", async () => {
            const section = (await Records.sectionsOf(admin, "v1")).sections[0].id
            await Records.update(admin, { id: licence, content: "Commercial register, renewed", files: [], filesBefore: [file("c1", "reg.pdf").url], expiryDate: "2027-10-20", reminderDays: 7, sectionId: section })
            const { rows: [row] } = await db.query(`SELECT "notifiedDaysBefore", "notifiedOnExpiry", "lastEditedById" FROM "ClientNote" WHERE id = $1`, [licence])
            expect(row).toEqual({ notifiedDaysBefore: false, notifiedOnExpiry: false, lastEditedById: "a1" })
            expect(removed).toEqual(["c1/records/reg.pdf"])
            // An edit that leaves the dates alone leaves what was sent alone.
            await db.query(`UPDATE "ClientNote" SET "notifiedDaysBefore" = true WHERE id = $1`, [licence])
            await Records.update(admin, { id: licence, content: "Commercial register, renewed.", files: [], filesBefore: [], expiryDate: "2027-10-20", reminderDays: 7 })
            expect((await db.query(`SELECT "notifiedDaysBefore" FROM "ClientNote" WHERE id = $1`, [licence])).rows[0].notifiedDaysBefore).toBe(true)
        })

        it("archives a client that has records, keeping them, rather than deleting it (CLIENTS_PLAN.md §4.3)", async () => {
            expect(await Clients.delete("v2", admin)).toMatchObject({ archived: true })
            const { rows: [kept] } = await db.query(`SELECT "archivedAt" IS NOT NULL AS archived, (SELECT count(*)::int FROM "ClientNote" n JOIN "ClientSection" s ON s.id = n."sectionId" WHERE s."clientId" = 'v2') AS records FROM "Client" WHERE id = 'v2'`)
            expect(kept).toEqual({ archived: true, records: 1 })
            // Restored, and with its records gone, it's deleted.
            await Clients.restore("v2", admin)
            await Records.delete(admin, note)
            expect(await Clients.delete("v2", admin)).toMatchObject({ archived: false })
            expect((await db.query(`SELECT count(*)::int AS n FROM "ClientSection" WHERE "clientId" = 'v2'`)).rows[0].n).toBe(0)
        })

        it("deletes a section with every record in it, and their files", async () => {
            removed.length = 0
            await Records.update(admin, { id: contract, content: "Supply contract", files: [file("c1", "contract.pdf")], filesBefore: [], expiryDate: null, reminderDays: null })
            const section = (await Records.sectionsOf(admin, "v1")).sections[0].id
            await expect(Records.deleteSection(employee, section)).rejects.toThrow("RECORD_FORBIDDEN")
            await Records.deleteSection(admin, section)
            expect((await db.query(`SELECT count(*)::int AS n FROM "ClientNote" WHERE id = ANY($1)`, [[licence, contract]])).rows[0].n).toBe(0)
            expect(removed).toEqual(["c1/records/contract.pdf"])
            const { rows: [audit] } = await db.query(`SELECT "userId", details FROM "AuditLog" WHERE action = 'DELETE_SECTION'`)
            expect(audit).toEqual({ userId: "a1", details: { title: "Licences", clientId: "v1", records: 2 } })
        })

        it("carries only records' files, and removes one only once no record has it", async () => {
            const avatar = { url: `${BUCKET}/c1/avatars/1-face.png`, name: "face.png", size: 100 }
            await expect(Records.create(admin, { content: "x", files: [avatar], expiryDate: null, reminderDays: null, clientId: "v1", sectionTitle: "Contracts" })).rejects.toThrow("RECORD_FILE_INVALID")
            removed.length = 0
            const shared = file("c1", "shared.pdf")
            const first = (await Records.create(admin, { content: "Lease", files: [shared], expiryDate: null, reminderDays: null, clientId: "v1", sectionTitle: "Contracts" })).id
            const second = (await Records.create(admin, { content: "Lease, copy", files: [shared, file("c1", "own.pdf")], expiryDate: null, reminderDays: null, clientId: "v1", sectionTitle: "Contracts" })).id
            await Records.delete(admin, first)
            await Records.update(admin, { id: second, content: "Lease, copy", files: [shared], filesBefore: [shared.url, file("c1", "own.pdf").url], expiryDate: null, reminderDays: null })
            expect(removed).toEqual(["c1/records/own.pdf"])
            await Records.delete(admin, second)
            expect(removed).toEqual(["c1/records/own.pdf", "c1/records/shared.pdf"])
        })

        it("discards files uploaded for a record never saved, but none a record has or that aren't the person's", async () => {
            removed.length = 0
            const kept = file("c1", "on-a-record.pdf")
            await Records.create(admin, { content: "Deed", files: [kept], expiryDate: null, reminderDays: null, clientId: "v1", sectionTitle: "Contracts" })
            const urls = [
                file("c1", "abandoned.pdf").url,
                kept.url,
                file("c2", "theirs.pdf").url,
                file("platform", "super-admins.pdf").url,
                `${BUCKET}/c1/avatars/1-face.png`,
                "https://evil.example/c1/records/x.pdf",
            ]
            expect(await Records.discardUploads(employee, urls)).toEqual({ files: 2 })
            expect(removed).toEqual(["c1/records/abandoned.pdf"])
            // A Super Admin's own uploads are in the platform's folder.
            removed.length = 0
            await Records.discardUploads(superAdmin, urls)
            expect(removed).toEqual(["platform/records/super-admins.pdf"])
        })

        it("starts one section when two people name the same new one at once", async () => {
            // Each first write of a section named Permits takes a moment, so the second starts while the first is still writing.
            await db.query(`CREATE FUNCTION test_slow() RETURNS trigger AS $$ BEGIN PERFORM pg_sleep(0.5); RETURN NEW; END $$ LANGUAGE plpgsql`)
            await db.query(`CREATE TRIGGER test_slow BEFORE INSERT ON "ClientSection" FOR EACH ROW WHEN (NEW.title = 'Permits') EXECUTE FUNCTION test_slow()`)
            try {
                const add = (content: string) => Records.create(admin, { content, files: [], expiryDate: null, reminderDays: null, clientId: "v1", sectionTitle: "Permits" })
                const first = add("Signage permit")
                await new Promise(r => setTimeout(r, 150))
                const made = await Promise.all([first, add("Parking permit")])
                const { rows } = await db.query(`SELECT DISTINCT "sectionId" FROM "ClientNote" WHERE id = ANY($1)`, [made.map(r => r.id)])
                expect(rows).toHaveLength(1)
                expect((await Records.sectionsOf(admin, "v1")).sections.find(s => s.title === "Permits")).toMatchObject({ records: 2 })
            } finally {
                await db.query(`DROP TRIGGER test_slow ON "ClientSection"; DROP FUNCTION test_slow()`)
            }
        })

        it("adds a client's first record to a section of that name started, or renamed to it, at the same moment", async () => {
            // The record's new section takes a moment to write, so the other starts or renames one meanwhile.
            await db.query(`CREATE FUNCTION test_slow() RETURNS trigger AS $$ BEGIN PERFORM pg_sleep(0.5); RETURN NEW; END $$ LANGUAGE plpgsql`)
            await db.query(`CREATE TRIGGER test_slow BEFORE INSERT ON "ClientSection" FOR EACH ROW WHEN (NEW.title IN ('Stamps', 'Seals') AND NEW."createdById" = 'a1') EXECUTE FUNCTION test_slow()`)
            try {
                const add = (sectionTitle: string) => Records.create(admin, { content: `${sectionTitle} record`, files: [], expiryDate: null, reminderDays: null, clientId: "v1", sectionTitle })
                const adding = add("Stamps")
                await new Promise(r => setTimeout(r, 150))
                const [added, started] = await Promise.allSettled([adding, Records.createSection(employee, { clientId: "v1", title: "Stamps" })])
                expect(added.status).toBe("fulfilled")
                expect(started).toMatchObject({ status: "rejected", reason: new Error("RECORD_SECTION_TAKEN") })

                const other = (await Records.createSection(employee, { clientId: "v1", title: "Old seals" })).id
                const addingSeal = add("Seals")
                await new Promise(r => setTimeout(r, 150))
                const [sealed, renamed] = await Promise.allSettled([addingSeal, Records.renameSection(admin, { id: other, title: "Seals" })])
                expect(sealed.status).toBe("fulfilled")
                expect(renamed).toMatchObject({ status: "rejected", reason: new Error("RECORD_SECTION_TAKEN") })
            } finally {
                await db.query(`DROP TRIGGER test_slow ON "ClientSection"; DROP FUNCTION test_slow()`)
            }
        })

        it("archives, rather than deletes, a client a record is being added to meanwhile", async () => {
            await db.query(`INSERT INTO "Client"(id, "companyId", name, "ownerName", "mobileNumber", "locationName", "updatedAt") VALUES ('v4', 'c1', 'Delta', 'Nour', '0103', 'Suez', now())`)
            const section = (await Records.createSection(admin, { clientId: "v4", title: "Licences" })).id
            // The record is written and its transaction takes a moment to finish, as someone deletes the client.
            await db.query(`CREATE FUNCTION test_slow() RETURNS trigger AS $$ BEGIN PERFORM pg_sleep(0.5); RETURN NEW; END $$ LANGUAGE plpgsql`)
            await db.query(`CREATE TRIGGER test_slow AFTER INSERT ON "ClientNote" FOR EACH ROW WHEN (NEW.content = 'Trade licence') EXECUTE FUNCTION test_slow()`)
            try {
                const adding = Records.create(admin, { content: "Trade licence", files: [], expiryDate: null, reminderDays: null, sectionId: section })
                await new Promise(r => setTimeout(r, 150))
                const deleting = Clients.delete("v4", admin)
                const [added, deleted] = await Promise.allSettled([adding, deleting])
                expect(added.status).toBe("fulfilled")
                expect(deleted).toMatchObject({ status: "fulfilled", value: { archived: true } })
                expect((await db.query(`SELECT count(*)::int AS n FROM "ClientNote" WHERE "sectionId" = $1`, [section])).rows[0].n).toBe(1)
            } finally {
                await db.query(`DROP TRIGGER test_slow ON "ClientNote"; DROP FUNCTION test_slow()`)
            }
        })

        it("measures expiry by the day where the client's company is", async () => {
            // At 09:00 UTC on the 16th it's 12:00 on the 16th in Cairo and still 23:00 on the 15th in Honolulu.
            await db.query(`UPDATE "Company" SET timezone = 'Pacific/Honolulu' WHERE id = 'c2'`)
            try {
                const there = (await Records.create(otherAdmin, { content: "Harbour permit", files: [], expiryDate: "2026-10-15", reminderDays: null, clientId: "v3", sectionTitle: "Licences" })).id
                const here = (await Records.create(admin, { content: "Shop permit", files: [], expiryDate: "2026-10-15", reminderDays: null, clientId: "v1", sectionTitle: "Contracts" })).id
                const ids = async (session: any, expiry: "soon" | "expired") => (await Records.list(session, { expiry, page: 1, limit: 50 })).data.map(r => r.id)
                expect(await ids(otherAdmin, "soon")).toContain(there)
                expect(await ids(otherAdmin, "expired")).not.toContain(there)
                expect((await Records.get(otherAdmin, there)).expiry).toBe("soon")
                expect((await Records.get(admin, here)).expiry).toBe("expired")
                // A Super Admin looking at every company sees each record by its own company's day.
                expect(await ids(superAdmin, "soon")).toContain(there)
                expect(await ids(superAdmin, "soon")).not.toContain(here)
                expect(await ids(superAdmin, "expired")).toContain(here)
                expect(await ids(superAdmin, "expired")).not.toContain(there)
                const all = (await Records.list(superAdmin, { page: 1, limit: 50 })).data
                expect([all.find(r => r.id === there)!.expiry, all.find(r => r.id === here)!.expiry]).toEqual(["soon", "expired"])
                // Its expiry day is today where it is, so its reminder goes today.
                await Records.checkExpiries()
                const { rows } = await db.query(`SELECT "userId", type FROM "Notification" WHERE "relatedId" = $1`, [`/dashboard/records/${there}`])
                expect(rows).toEqual([{ userId: "a2", type: "NOTE_EXPIRING" }])
                expect((await db.query(`SELECT count(*)::int AS n FROM "Notification" WHERE "relatedId" = $1`, [`/dashboard/records/${here}`])).rows[0].n).toBe(0)
            } finally {
                await db.query(`UPDATE "Company" SET timezone = 'Africa/Cairo' WHERE id = 'c2'`)
            }
        })

        it("sends no notice for a deadline changed while the reminders were going out", async () => {
            const due = (await Records.create(admin, { content: "Fire certificate", files: [], expiryDate: "2026-10-16", reminderDays: null, clientId: "v1", sectionTitle: "Contracts" })).id
            const soon = (await Records.create(admin, { content: "Insurance", files: [], expiryDate: "2026-10-20", reminderDays: 7, clientId: "v1", sectionTitle: "Contracts" })).id
            // Someone renews both as the job finds them: the edit is written, not yet committed.
            const edit = new Client({ connectionString: process.env.POSTGRES_PRISMA_URL })
            await edit.connect()
            try {
                await edit.query("BEGIN")
                await edit.query(`UPDATE "ClientNote" SET "expiryDate" = '2027-10-16', "notifiedOnExpiry" = false WHERE id = $1`, [due])
                await edit.query(`UPDATE "ClientNote" SET "reminderDays" = 2, "notifiedDaysBefore" = false WHERE id = $1`, [soon])
                const checking = Records.checkExpiries()
                await new Promise(r => setTimeout(r, 300))
                await edit.query("COMMIT")
                await checking
            } finally {
                await edit.end()
            }
            const { rows } = await db.query(`SELECT id, "notifiedOnExpiry", "notifiedDaysBefore" FROM "ClientNote" WHERE id = ANY($1) ORDER BY content`, [[due, soon]])
            expect(rows).toEqual([
                { id: due, notifiedOnExpiry: false, notifiedDaysBefore: false },
                { id: soon, notifiedOnExpiry: false, notifiedDaysBefore: false },
            ])
            expect((await db.query(`SELECT count(*)::int AS n FROM "Notification" WHERE "relatedId" = ANY($1)`, [[due, soon].map(id => `/dashboard/records/${id}`)])).rows[0].n).toBe(0)
        })

        it("deletes a section with a record added as it goes, and that record's files", async () => {
            const section = (await Records.createSection(admin, { clientId: "v1", title: "Old papers" })).id
            await db.query(`CREATE FUNCTION test_slow() RETURNS trigger AS $$ BEGIN PERFORM pg_sleep(0.5); RETURN NEW; END $$ LANGUAGE plpgsql`)
            await db.query(`CREATE TRIGGER test_slow AFTER INSERT ON "ClientNote" FOR EACH ROW WHEN (NEW.content = 'Late arrival') EXECUTE FUNCTION test_slow()`)
            try {
                removed.length = 0
                const adding = Records.create(admin, { content: "Late arrival", files: [file("c1", "late.pdf")], expiryDate: null, reminderDays: null, sectionId: section })
                await new Promise(r => setTimeout(r, 150))
                const [added, deleted] = await Promise.allSettled([adding, Records.deleteSection(admin, section)])
                expect([added.status, deleted.status]).toEqual(["fulfilled", "fulfilled"])
                expect(removed).toEqual(["c1/records/late.pdf"])
                const { rows: [audit] } = await db.query(`SELECT details FROM "AuditLog" WHERE action = 'DELETE_SECTION' AND "entityId" = $1`, [section])
                expect(audit.details.records).toBe(1)
            } finally {
                await db.query(`DROP TRIGGER test_slow ON "ClientNote"; DROP FUNCTION test_slow()`)
            }
        })

        it("won't add a record to a section being deleted", async () => {
            const section = (await Records.createSection(admin, { clientId: "v1", title: "Doomed" })).id
            await db.query(`CREATE FUNCTION test_slow() RETURNS trigger AS $$ BEGIN PERFORM pg_sleep(0.5); RETURN OLD; END $$ LANGUAGE plpgsql`)
            await db.query(`CREATE TRIGGER test_slow BEFORE DELETE ON "ClientSection" FOR EACH ROW WHEN (OLD.title = 'Doomed') EXECUTE FUNCTION test_slow()`)
            try {
                const deleting = Records.deleteSection(admin, section)
                await new Promise(r => setTimeout(r, 150))
                const [deleted, added] = await Promise.allSettled([deleting, Records.create(admin, { content: "Too late", files: [], expiryDate: null, reminderDays: null, sectionId: section })])
                expect(deleted.status).toBe("fulfilled")
                expect(added).toMatchObject({ status: "rejected", reason: { message: "RECORD_SECTION_NOT_FOUND" } })
            } finally {
                await db.query(`DROP TRIGGER test_slow ON "ClientSection"; DROP FUNCTION test_slow()`)
            }
        })

        it("deletes a section and its company at once without a deadlock: the section goes with the company", async () => {
            await db.query(`INSERT INTO "Company"(id, name, "updatedAt") VALUES ('c4', 'Four', now())`)
            await db.query(`INSERT INTO "Client"(id, "companyId", name, "ownerName", "mobileNumber", "locationName", "updatedAt") VALUES ('v7', 'c4', 'Theta', 'Nour', '0106', 'Luxor', now())`)
            await Records.create(superAdmin, { content: "Theta lease", files: [], expiryDate: null, reminderDays: null, clientId: "v7", sectionTitle: "Leases" })
            const section = (await db.query(`SELECT id FROM "ClientSection" WHERE "clientId" = 'v7'`)).rows[0].id
            // The company's deletion holds its clients and records, then waits
            // here before its rows go, the section among them.
            await db.query(`CREATE FUNCTION test_slow() RETURNS trigger AS $$ BEGIN PERFORM pg_sleep(0.8); RETURN OLD; END $$ LANGUAGE plpgsql`)
            await db.query(`CREATE TRIGGER test_slow BEFORE DELETE ON "Company" FOR EACH ROW WHEN (OLD.id = 'c4') EXECUTE FUNCTION test_slow()`)
            try {
                const { CompanyService } = await import("@/lib/services/company.service")
                const deletingCompany = CompanyService.delete("c4", { user: { ...superAdmin.user, mfaEnabled: true, stepUpAt: Date.now() } })
                await new Promise(r => setTimeout(r, 300))
                const [company, sectionDeleted] = await Promise.allSettled([deletingCompany, Records.deleteSection(superAdmin, section)])
                expect(company.status).toBe("fulfilled")
                expect(sectionDeleted).toMatchObject({ status: "rejected", reason: { message: "RECORD_SECTION_NOT_FOUND" } })
                expect((await db.query(`SELECT count(*)::int AS n FROM "ClientSection" WHERE id = $1`, [section])).rows[0].n).toBe(0)
            } finally {
                await db.query(`DROP TRIGGER test_slow ON "Company"; DROP FUNCTION test_slow()`)
            }
        })

        it("audits a section's title as it was when deleted, though renamed just before", async () => {
            const section = (await Records.createSection(admin, { clientId: "v1", title: "Old name" })).id
            await db.query(`CREATE FUNCTION test_slow() RETURNS trigger AS $$ BEGIN PERFORM pg_sleep(0.5); RETURN NEW; END $$ LANGUAGE plpgsql`)
            await db.query(`CREATE TRIGGER test_slow BEFORE UPDATE ON "ClientSection" FOR EACH ROW WHEN (NEW.title = 'New name') EXECUTE FUNCTION test_slow()`)
            try {
                const renaming = Records.renameSection(admin, { id: section, title: "New name" })
                await new Promise(r => setTimeout(r, 150))
                await Promise.all([renaming, Records.deleteSection(admin, section)])
                const [log] = (await db.query(`SELECT details FROM "AuditLog" WHERE action = 'DELETE_SECTION' AND "entityId" = $1`, [section])).rows
                expect(log.details.title).toBe("New name")
            } finally {
                await db.query(`DROP TRIGGER test_slow ON "ClientSection"; DROP FUNCTION test_slow()`)
            }
        })

        it("refuses an edit from a form opened before someone else changed the record's files", async () => {
            const id = (await Records.create(admin, { content: "Lease", files: [], expiryDate: null, reminderDays: null, clientId: "v1", sectionTitle: "Contracts" })).id
            await db.query(`CREATE FUNCTION test_slow() RETURNS trigger AS $$ BEGIN PERFORM pg_sleep(0.5); RETURN NEW; END $$ LANGUAGE plpgsql`)
            await db.query(`CREATE TRIGGER test_slow BEFORE UPDATE ON "ClientNote" FOR EACH ROW WHEN (NEW.content = 'First edit') EXECUTE FUNCTION test_slow()`)
            try {
                removed.length = 0
                // Two people edit it at once from the same form: the first adds a.pdf; the second, not seeing it, saves b.pdf.
                const first = Records.update(admin, { id, content: "First edit", files: [file("c1", "a.pdf")], filesBefore: [], expiryDate: null, reminderDays: null })
                await new Promise(r => setTimeout(r, 150))
                const [, second] = await Promise.allSettled([first, Records.update(employee, { id, content: "Second edit", files: [file("c1", "b.pdf")], filesBefore: [], expiryDate: null, reminderDays: null })])
                expect(second).toMatchObject({ status: "rejected", reason: { message: "RECORD_CHANGED" } })
                expect((await Records.get(admin, id)).files.map(f => f.name)).toEqual(["a.pdf"])
                expect(removed).toEqual([])
            } finally {
                await db.query(`DROP TRIGGER test_slow ON "ClientNote"; DROP FUNCTION test_slow()`)
            }
        })

        it("never brings back a file another edit removed, from a form that still had it", async () => {
            const kept = file("c1", "deed.pdf")
            const id = (await Records.create(admin, { content: "Deed", files: [kept], expiryDate: null, reminderDays: null, clientId: "v1", sectionTitle: "Contracts" })).id
            await db.query(`CREATE FUNCTION test_slow() RETURNS trigger AS $$ BEGIN PERFORM pg_sleep(0.5); RETURN NEW; END $$ LANGUAGE plpgsql`)
            await db.query(`CREATE TRIGGER test_slow BEFORE UPDATE ON "ClientNote" FOR EACH ROW WHEN (NEW.content = 'Deed, file taken off') EXECUTE FUNCTION test_slow()`)
            try {
                removed.length = 0
                // One person takes deed.pdf off; another, from a form opened before that, only fixes the text and keeps it.
                const taking = Records.update(admin, { id, content: "Deed, file taken off", files: [], filesBefore: [kept.url], expiryDate: null, reminderDays: null })
                await new Promise(r => setTimeout(r, 150))
                const [, keeping] = await Promise.allSettled([taking, Records.update(employee, { id, content: "Deed, text fixed", files: [kept], filesBefore: [kept.url], expiryDate: null, reminderDays: null })])
                expect(keeping).toMatchObject({ status: "rejected", reason: { message: "RECORD_CHANGED" } })
                // Removed from storage, and from the record, which never refers to it again.
                expect(removed).toEqual(["c1/records/deed.pdf"])
                expect((await Records.get(admin, id)).files).toEqual([])
            } finally {
                await db.query(`DROP TRIGGER test_slow ON "ClientNote"; DROP FUNCTION test_slow()`)
            }
        })

        it("removes the files of the record as it was deleted, an edit just before included", async () => {
            const id = (await Records.create(admin, { content: "Permit", files: [], expiryDate: null, reminderDays: null, clientId: "v1", sectionTitle: "Contracts" })).id
            await db.query(`CREATE FUNCTION test_slow() RETURNS trigger AS $$ BEGIN PERFORM pg_sleep(0.5); RETURN NEW; END $$ LANGUAGE plpgsql`)
            await db.query(`CREATE TRIGGER test_slow BEFORE UPDATE ON "ClientNote" FOR EACH ROW WHEN (NEW.content = 'Permit, scanned') EXECUTE FUNCTION test_slow()`)
            try {
                removed.length = 0
                const editing = Records.update(admin, { id, content: "Permit, scanned", files: [file("c1", "scan.pdf")], filesBefore: [], expiryDate: null, reminderDays: null })
                await new Promise(r => setTimeout(r, 150))
                await Promise.all([editing, Records.delete(admin, id)])
                expect(removed).toEqual(["c1/records/scan.pdf"])
                const { rows: [audit] } = await db.query(`SELECT details FROM "AuditLog" WHERE action = 'DELETE_NOTE' AND "entityId" = $1`, [id])
                expect(audit.details).toMatchObject({ files: 1, contentPreview: "Permit, scanned" })
            } finally {
                await db.query(`DROP TRIGGER test_slow ON "ClientNote"; DROP FUNCTION test_slow()`)
            }
        })

        it("says so when storage refuses to remove a record's files", async () => {
            const id = (await Records.create(admin, { content: "Stamp", files: [file("c1", "stamp.pdf")], expiryDate: null, reminderDays: null, clientId: "v1", sectionTitle: "Contracts" })).id
            const logged = vi.spyOn(console, "error").mockImplementation(() => {})
            refuseRemoval = true
            try {
                await Records.delete(admin, id)
                expect(logged).toHaveBeenCalledWith("Failed to delete record files from storage:", { message: "Forbidden" })
            } finally {
                refuseRemoval = false
                logged.mockRestore()
            }
        })

        it("removes a deleted company's records' files", async () => {
            await db.query(`INSERT INTO "Company"(id, name, "updatedAt") VALUES ('c3', 'Three', now())`)
            await db.query(`INSERT INTO "Client"(id, "companyId", name, "ownerName", "mobileNumber", "locationName", "updatedAt") VALUES ('v6', 'c3', 'Zeta', 'Rana', '0105', 'Aswan', now())`)
            await Records.create(superAdmin, { content: "Zeta licence", files: [file("c3", "zeta.pdf")], expiryDate: null, reminderDays: null, clientId: "v6", sectionTitle: "Licences" })
            removed.length = 0
            const { CompanyService } = await import("@/lib/services/company.service")
            await CompanyService.delete("c3", { user: { ...superAdmin.user, mfaEnabled: true, stepUpAt: Date.now() } })
            expect((await db.query(`SELECT count(*)::int AS n FROM "Company" WHERE id = 'c3'`)).rows[0].n).toBe(0)
            expect(removed).toEqual(["c3/records/zeta.pdf"])
        })

        it("names a record's company to a Super Admin, who sees every company's, and to nobody else", async () => {
            const id = (await Records.create(admin, { content: "Named company", files: [], expiryDate: null, reminderDays: null, clientId: "v1", sectionTitle: "Contracts" })).id
            expect((await Records.get(superAdmin, id)).client).toEqual({ id: "v1", name: expect.any(String), company: "One" })
            expect((await Records.get(admin, id)).client).not.toHaveProperty("company")
        })

        it("reminds a Super Admin who added a record, as anyone who did", async () => {
            const id = (await Records.create(superAdmin, { content: "Support's permit", files: [], expiryDate: "2026-10-20", reminderDays: 7, clientId: "v1", sectionTitle: "Permits by support" })).id
            await Records.checkExpiries()
            const { rows } = await db.query(`SELECT "userId", "superAdminId", type FROM "Notification" WHERE "relatedId" = $1`, [`/dashboard/records/${id}`])
            expect(rows).toEqual([{ userId: null, superAdminId: superAdmin.user.id, type: "NOTE_REMINDER" }])
        })

        it("tells a Super Admin's record from one by a user since deleted", async () => {
            await db.query(`INSERT INTO "User"(id, email, password, "firstName", "lastName", role, "lastDayOffResetYear", username, "companyId", "roleId") SELECT 'e9', 'e9@x', 'p', 'Lina', 'Gone', 'EMPLOYEE', 2026, 'e9', 'c1', id FROM "Role" WHERE "companyId" = 'c1' AND "builtIn" = 'EMPLOYEE'`)
            const leaver = { user: withGrants({ id: "e9", role: "EMPLOYEE", companyId: "c1" }) } as any
            const theirs = (await Records.create(leaver, { content: "Left behind", files: [], expiryDate: null, reminderDays: null, clientId: "v1", sectionTitle: "Contracts" })).id
            const support = (await Records.create(superAdmin, { content: "Added by support", files: [], expiryDate: null, reminderDays: null, clientId: "v1", sectionTitle: "Contracts" })).id
            await Records.update(superAdmin, { id: theirs, content: "Left behind, checked", files: [], filesBefore: [], expiryDate: null, reminderDays: null })
            await db.query(`DELETE FROM "User" WHERE id = 'e9'`)
            expect(await Records.get(admin, theirs)).toMatchObject({ createdBy: null, createdBySuperAdmin: false, lastEditedBy: null, lastEditedBySuperAdmin: true })
            expect(await Records.get(admin, support)).toMatchObject({ createdBy: null, createdBySuperAdmin: true })
            // An Admin's edit after it is the Admin's.
            await Records.update(admin, { id: support, content: "Added by support, seen", files: [], filesBefore: [], expiryDate: null, reminderDays: null })
            expect(await Records.get(admin, support)).toMatchObject({ lastEditedBy: { firstName: "Amal" }, lastEditedBySuperAdmin: false })
        })

        it("offers the company's clients to add a record to, by name, to whoever may add one", async () => {
            const names = (list: { clients: { name: string }[] }) => list.clients.map(c => c.name)
            // Delta is archived, as it had a record when it was deleted above (CLIENTS_PLAN.md §4.3).
            expect(names(await Records.clients(employee))).toEqual(["Acme"])
            expect(names(await Records.clients(otherAdmin))).toEqual(["Gamma"])
            // A Super Admin's chosen company, or every company's, each named with its company.
            expect(names(await Records.clients(superAdmin, "c2"))).toEqual(["Gamma"])
            expect((await Records.clients(superAdmin)).clients.map(c => `${c.name} ${c.company}`)).toEqual(["Acme One", "Gamma Two"])
            // Someone on a role without records.contribute.
            const without = { user: { id: "e1", role: "EMPLOYEE", companyId: "c1", grants: "" } } as any
            await expect(Records.clients(without)).rejects.toThrow("RECORD_FORBIDDEN")
        })

        it("deletes a section with the files an edit just gave one of its records", async () => {
            const id = (await Records.create(admin, { content: "Map", files: [], expiryDate: null, reminderDays: null, clientId: "v1", sectionTitle: "Plans" })).id
            const section = (await Records.get(admin, id)).section.id
            await db.query(`CREATE FUNCTION test_slow() RETURNS trigger AS $$ BEGIN PERFORM pg_sleep(0.5); RETURN NEW; END $$ LANGUAGE plpgsql`)
            await db.query(`CREATE TRIGGER test_slow BEFORE UPDATE ON "ClientNote" FOR EACH ROW WHEN (NEW.content = 'Map, scanned') EXECUTE FUNCTION test_slow()`)
            try {
                removed.length = 0
                const editing = Records.update(admin, { id, content: "Map, scanned", files: [file("c1", "map.pdf")], filesBefore: [], expiryDate: null, reminderDays: null })
                await new Promise(r => setTimeout(r, 150))
                await Promise.all([editing, Records.deleteSection(admin, section)])
                expect(removed).toEqual(["c1/records/map.pdf"])
            } finally {
                await db.query(`DROP TRIGGER test_slow ON "ClientNote"; DROP FUNCTION test_slow()`)
            }
        })

        it("removes the files an edit just gave a record of a company being deleted", async () => {
            await db.query(`INSERT INTO "Company"(id, name, "updatedAt") VALUES ('c4', 'Four', now())`)
            await db.query(`INSERT INTO "Client"(id, "companyId", name, "ownerName", "mobileNumber", "locationName", "updatedAt") VALUES ('v7', 'c4', 'Eta', 'Huda', '0106', 'Tanta', now())`)
            const id = (await Records.create(superAdmin, { content: "Eta permit", files: [], expiryDate: null, reminderDays: null, clientId: "v7", sectionTitle: "Licences" })).id
            await db.query(`CREATE FUNCTION test_slow() RETURNS trigger AS $$ BEGIN PERFORM pg_sleep(0.5); RETURN NEW; END $$ LANGUAGE plpgsql`)
            await db.query(`CREATE TRIGGER test_slow BEFORE UPDATE ON "ClientNote" FOR EACH ROW WHEN (NEW.content = 'Eta permit, scanned') EXECUTE FUNCTION test_slow()`)
            try {
                removed.length = 0
                const editing = Records.update(superAdmin, { id, content: "Eta permit, scanned", files: [file("c4", "eta.pdf")], filesBefore: [], expiryDate: null, reminderDays: null })
                await new Promise(r => setTimeout(r, 150))
                const { CompanyService } = await import("@/lib/services/company.service")
                await Promise.all([editing, CompanyService.delete("c4", { user: { ...superAdmin.user, mfaEnabled: true, stepUpAt: Date.now() } })])
                expect(removed).toEqual(["c4/records/eta.pdf"])
            } finally {
                await db.query(`DROP TRIGGER test_slow ON "ClientNote"; DROP FUNCTION test_slow()`)
            }
        })

        it("lets no client be added to a company while its deletion lists its records' files", async () => {
            await db.query(`INSERT INTO "Company"(id, name, "updatedAt") VALUES ('c5', 'Five', now())`)
            const { prisma } = await import("@/lib/prisma")
            let added: unknown = "not tried"
            await prisma.$transaction(async tx => {
                await Records.filesOfCompany(tx, "c5")
                // Meanwhile someone adds a client to it, giving up after a moment.
                await db.query(`SET lock_timeout = '300ms'`)
                added = await db.query(`INSERT INTO "Client"(id, "companyId", name, "ownerName", "mobileNumber", "locationName", "updatedAt") VALUES ('v8', 'c5', 'Theta', 'Rami', '0107', 'Minya', now())`).then(() => "added", (e: Error) => e.message)
                await db.query(`RESET lock_timeout`)
            })
            expect(added).toMatch(/lock timeout/)
            await db.query(`DELETE FROM "Company" WHERE id = 'c5'`)
        })

        it("gives no record a file being removed from storage", async () => {
            const x = file("c1", "handover.pdf")
            const a = (await Records.create(admin, { content: "Handover", files: [x], expiryDate: null, reminderDays: null, clientId: "v1", sectionTitle: "Contracts" })).id
            removalTakes = 500
            try {
                removed.length = 0
                // Its file is taken off, and as storage removes it, a request gives the same file to another record.
                const takingOff = Records.update(admin, { id: a, content: "Handover", files: [], filesBefore: [x.url], expiryDate: null, reminderDays: null })
                await new Promise(r => setTimeout(r, 150))
                const [, giving] = await Promise.allSettled([takingOff, Records.create(admin, { content: "Handover, copy", files: [x], expiryDate: null, reminderDays: null, clientId: "v1", sectionTitle: "Contracts" })])
                expect(removed).toEqual(["c1/records/handover.pdf"])
                expect(giving).toMatchObject({ status: "rejected", reason: { message: "RECORD_FILE_INVALID" } })
                // Nor later.
                await expect(Records.create(admin, { content: "Handover, again", files: [x], expiryDate: null, reminderDays: null, clientId: "v1", sectionTitle: "Contracts" })).rejects.toThrow("RECORD_FILE_INVALID")
            } finally {
                removalTakes = 0
            }
        })

        it("keeps a file a record is being given as another takes it off", async () => {
            const x = file("c1", "permit-scan.pdf")
            const a = (await Records.create(admin, { content: "Permit scan", files: [x], expiryDate: null, reminderDays: null, clientId: "v1", sectionTitle: "Contracts" })).id
            await db.query(`CREATE FUNCTION test_slow() RETURNS trigger AS $$ BEGIN PERFORM pg_sleep(0.5); RETURN NEW; END $$ LANGUAGE plpgsql`)
            await db.query(`CREATE TRIGGER test_slow AFTER INSERT ON "ClientNote" FOR EACH ROW WHEN (NEW.content = 'Permit scan, copy') EXECUTE FUNCTION test_slow()`)
            try {
                removed.length = 0
                // Another record is being given the file, and before it's saved, the first takes it off.
                const giving = Records.create(admin, { content: "Permit scan, copy", files: [x], expiryDate: null, reminderDays: null, clientId: "v1", sectionTitle: "Contracts" })
                await new Promise(r => setTimeout(r, 150))
                await Promise.all([giving, Records.update(admin, { id: a, content: "Permit scan", files: [], filesBefore: [x.url], expiryDate: null, reminderDays: null })])
                // The copy has it, so it stays.
                expect(removed).toEqual([])
            } finally {
                await db.query(`DROP TRIGGER test_slow ON "ClientNote"; DROP FUNCTION test_slow()`)
            }
        })

        it("won't add a record to a client deleted meanwhile", async () => {
            await db.query(`INSERT INTO "Client"(id, "companyId", name, "ownerName", "mobileNumber", "locationName", "updatedAt") VALUES ('v5', 'c1', 'Epsilon', 'Hana', '0104', 'Luxor', now())`)
            const section = (await Records.createSection(admin, { clientId: "v5", title: "Licences" })).id
            await db.query(`DELETE FROM "Client" WHERE id = 'v5'`)
            await expect(Records.create(admin, { content: "Late", files: [], expiryDate: null, reminderDays: null, sectionId: section })).rejects.toThrow("RECORD_SECTION_NOT_FOUND")
            await expect(Records.create(admin, { content: "Late", files: [], expiryDate: null, reminderDays: null, clientId: "v5", sectionTitle: "New" })).rejects.toThrow("CLIENT_NOT_FOUND")
        })

        it("finds any of a company's clients to add a record to by its name, however many it has", async () => {
            await db.query(`INSERT INTO "Company"(id, name, "updatedAt") VALUES ('c4', 'Four', now())`)
            await db.query(`INSERT INTO "Client"(id, "companyId", name, "ownerName", "mobileNumber", "locationName", "updatedAt") SELECT 'm' || n, 'c4', 'Market ' || lpad(n::text, 4, '0'), 'Owner', '0100', 'Cairo', now() FROM generate_series(1, 1100) n`)
            try {
                const first = await Records.clients(superAdmin, "c4")
                expect(first.clients).toHaveLength(CLIENTS_SHOWN)
                expect(first.more).toBe(true)
                // The last of them, far past the first ones listed, by any part of its name.
                expect(await Records.clients(superAdmin, "c4", " market 1100 ")).toEqual({ clients: [{ id: "m1100", name: "Market 1100" }], more: false })
                expect(await Records.clients(employee, null, "CM")).toEqual({ clients: [{ id: "v1", name: "Acme" }], more: false })
                // Never another company's, nor a name's letters taken as a pattern.
                expect((await Records.clients(employee, null, "Gamma")).clients).toEqual([])
                expect((await Records.clients(superAdmin, "c4", "%")).clients).toEqual([])
                expect((await Records.clients(superAdmin, "c4", "Market_1100")).clients).toEqual([])
            } finally {
                await db.query(`DELETE FROM "Company" WHERE id = 'c4'`)
            }
        })

        it("removes a section's many files, in as many calls as storage takes them", async () => {
            // 25 records of 10 files each: more than one call to storage takes.
            const archive = async (title: string) => {
                const section = (await Records.createSection(admin, { clientId: "v1", title })).id
                const files = (n: number) => JSON.stringify(Array.from({ length: 10 }, (_, i) => ({ url: `${BUCKET}/c1/records/${title}-${n}-${i}.pdf`, name: `${title}-${n}-${i}.pdf`, size: 1 })))
                for (let n = 0; n < 25; n++) await db.query(`INSERT INTO "ClientNote"(id, content, "sectionId", "updatedAt", attachment) VALUES ($1, 'Archived', $2, now(), $3)`, [`${title}-${n}`, section, files(n)])
                return section
            }
            const noted = async (title: string) => (await db.query(`SELECT count(*)::int AS n FROM "RemovedRecordFile" WHERE path LIKE $1`, [`c1/records/${title}-%`])).rows[0].n
            removed.length = 0
            await Records.deleteSection(admin, await archive("archive"))
            expect(new Set(removed).size).toBe(250)
            expect(await noted("archive")).toBe(250)
            // One call refused leaves the others' files removed, and its own noted as removed, for the sweep.
            removed.length = 0
            refuseCalls = 1
            await Records.deleteSection(admin, await archive("boxes"))
            expect(refuseCalls).toBe(0)
            expect(new Set(removed).size).toBe(150)
            expect(await noted("boxes")).toBe(250)
        })

        it("removes a file from storage only once it's noted as removed for good", async () => {
            // Noting the file as removed fails as it's committed.
            await db.query(`CREATE FUNCTION test_fail() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'commit failed'; END $$ LANGUAGE plpgsql`)
            await db.query(`CREATE CONSTRAINT TRIGGER test_fail AFTER INSERT ON "RemovedRecordFile" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW WHEN (NEW.path = 'c1/records/notary.pdf') EXECUTE FUNCTION test_fail()`)
            try {
                const deed = (await Records.create(admin, { content: "Notary deed", files: [file("c1", "notary.pdf")], expiryDate: null, reminderDays: null, clientId: "v1", sectionTitle: "Contracts" })).id
                removed.length = 0
                await Records.delete(admin, deed)
                // Still in storage, so a record may still be given it.
                expect(removed).toEqual([])
                await Records.create(admin, { content: "Notary deed, again", files: [file("c1", "notary.pdf")], expiryDate: null, reminderDays: null, clientId: "v1", sectionTitle: "Contracts" })
            } finally {
                await db.query(`DROP TRIGGER test_fail ON "RemovedRecordFile"; DROP FUNCTION test_fail()`)
            }
        })

        it("sends the reminders on when their company's deletion holds a record, then deletes whoever added it", async () => {
            await db.query(`INSERT INTO "User"(id, email, password, "firstName", "lastName", role, "lastDayOffResetYear", username, "companyId", "roleId") SELECT 'e9', 'e9@x', 'p', 'Rana', 'Gone', 'EMPLOYEE', 2026, 'e9', 'c1', id FROM "Role" WHERE "companyId" = 'c1' AND "builtIn" = 'EMPLOYEE'`)
            const theirs = (await Records.create({ user: withGrants({ id: "e9", role: "EMPLOYEE", companyId: "c1" }) } as any, { content: "Fire certificate", files: [], expiryDate: "2026-10-16", reminderDays: null, clientId: "v1", sectionTitle: "Contracts" })).id
            // As CompanyService.delete does: its records held (filesOfCompany), then its people deleted with it.
            const deleting = new Client({ connectionString: process.env.POSTGRES_PRISMA_URL })
            await deleting.connect()
            try {
                await deleting.query("BEGIN")
                await deleting.query(`SELECT id FROM "ClientNote" WHERE id = $1 FOR UPDATE`, [theirs])
                const checking = Records.checkExpiries()
                await new Promise(r => setTimeout(r, 300))
                const deleted = deleting.query(`DELETE FROM "User" WHERE id = 'e9'`).then(() => deleting.query("COMMIT"))
                const [checked, done] = await Promise.allSettled([checking, deleted])
                // Neither is the one a deadlock aborts.
                expect(checked.status).toBe("fulfilled")
                expect(done.status).toBe("fulfilled")
            } finally {
                await deleting.end()
            }
            const { rows } = await db.query(`SELECT "notifiedOnExpiry", "createdById" FROM "ClientNote" WHERE id = $1`, [theirs])
            expect(rows).toEqual([{ notifiedOnExpiry: true, createdById: null }])
        })

        it("waits for whoever added a record while they're held, then sends their reminder", async () => {
            await db.query(`INSERT INTO "User"(id, email, password, "firstName", "lastName", role, "lastDayOffResetYear", username, "companyId", "roleId") SELECT 'e10', 'e10@x', 'p', 'Hala', 'Held', 'EMPLOYEE', 2026, 'e10', 'c1', id FROM "Role" WHERE "companyId" = 'c1' AND "builtIn" = 'EMPLOYEE'`)
            const theirs = (await Records.create({ user: withGrants({ id: "e10", role: "EMPLOYEE", companyId: "c1" }) } as any, { content: "Lift inspection", files: [], expiryDate: "2026-10-16", reminderDays: null, clientId: "v1", sectionTitle: "Contracts" })).id
            // Held as their deletion holds them, then let go: the reminder asks again rather than failing.
            const holding = new Client({ connectionString: process.env.POSTGRES_PRISMA_URL })
            await holding.connect()
            try {
                await holding.query("BEGIN")
                await holding.query(`SELECT id FROM "User" WHERE id = 'e10' FOR UPDATE`)
                const checking = Records.checkExpiries()
                await new Promise(r => setTimeout(r, 250))
                await holding.query("ROLLBACK")
                await checking
            } finally {
                await holding.end()
            }
            expect((await db.query(`SELECT "notifiedOnExpiry" FROM "ClientNote" WHERE id = $1`, [theirs])).rows[0].notifiedOnExpiry).toBe(true)
            expect((await db.query(`SELECT count(*)::int AS n FROM "Notification" WHERE "userId" = 'e10' AND "relatedId" = $1`, [`/dashboard/records/${theirs}`])).rows[0].n).toBe(1)
        })

        it("sends the reminders on when whoever added a record is deleted as they go out", async () => {
            await db.query(`INSERT INTO "User"(id, email, password, "firstName", "lastName", role, "lastDayOffResetYear", username, "companyId", "roleId") SELECT 'e8', 'e8@x', 'p', 'Nour', 'Gone', 'EMPLOYEE', 2026, 'e8', 'c1', id FROM "Role" WHERE "companyId" = 'c1' AND "builtIn" = 'EMPLOYEE'`)
            const leaver = { user: withGrants({ id: "e8", role: "EMPLOYEE", companyId: "c1" }) } as any
            const theirs = (await Records.create(leaver, { content: "Trade licence", files: [], expiryDate: "2026-10-16", reminderDays: null, clientId: "v1", sectionTitle: "Contracts" })).id
            const soon = (await Records.create(leaver, { content: "Tax card", files: [], expiryDate: "2026-10-20", reminderDays: 7, clientId: "v1", sectionTitle: "Contracts" })).id
            // Someone is editing the record as the job finds it, and the person who added it is deleted meanwhile.
            const edit = new Client({ connectionString: process.env.POSTGRES_PRISMA_URL })
            const leave = new Client({ connectionString: process.env.POSTGRES_PRISMA_URL })
            await edit.connect()
            await leave.connect()
            try {
                await edit.query("BEGIN")
                await edit.query(`SELECT id FROM "ClientNote" WHERE id = ANY($1) FOR UPDATE`, [[theirs, soon]])
                const checking = Records.checkExpiries()
                await new Promise(r => setTimeout(r, 300))
                const leaving = leave.query(`DELETE FROM "User" WHERE id = 'e8'`)
                await new Promise(r => setTimeout(r, 300))
                await edit.query("COMMIT")
                const [checked, left] = await Promise.allSettled([checking, leaving])
                expect(checked.status).toBe("fulfilled")
                expect(left.status).toBe("fulfilled")
            } finally {
                await edit.end()
                await leave.end()
            }
            const { rows } = await db.query(`SELECT "notifiedOnExpiry", "notifiedDaysBefore", "createdById" FROM "ClientNote" WHERE id = ANY($1) ORDER BY content`, [[theirs, soon]])
            expect(rows).toEqual([
                { notifiedOnExpiry: false, notifiedDaysBefore: true, createdById: null },
                { notifiedOnExpiry: true, notifiedDaysBefore: false, createdById: null },
            ])
            expect((await db.query(`SELECT count(*)::int AS n FROM "User" WHERE id = 'e8'`)).rows[0].n).toBe(0)
        })
    })
})

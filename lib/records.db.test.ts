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
const sql = (name: string) => readFileSync(`prisma/migrations/${name}/migration.sql`, "utf8")

const BUCKET = "https://abc.supabase.co/storage/v1/object/public/app-assets"
const removed: string[] = []
// Storage answers a refused removal with an error, rather than throwing.
let refuseRemoval = false
// How long storage takes to remove files, for a test that needs it to take a moment.
let removalTakes = 0
// How many calls to come storage refuses, after which it removes again.
let refuseCalls = 0
vi.mock("@/lib/storage", () => ({
    supabase: { storage: { from: () => ({ remove: async (paths: string[]) => {
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

const admin = { user: withGrants({ id: "a1", role: "ADMIN", companyId: "c1" }) } as any
const employee = { user: withGrants({ id: "e1", role: "EMPLOYEE", companyId: "c1" }) } as any
const otherAdmin = { user: withGrants({ id: "a2", role: "ADMIN", companyId: "c2" }) } as any
const superAdmin = { user: { id: "sa1", role: "SUPER_ADMIN", companyId: null } } as any
const file = (company: string, name: string) => ({ url: `${BUCKET}/${company}/records/${name}`, name, size: 100 })

describe.skipIf(!ADMIN_URL)("records on clients, in Postgres", () => {
    const dbName = `records_test_${Date.now()}`
    let db: Client
    let Records: typeof import("@/lib/services/record.service").RecordService
    let Vendors: typeof import("@/lib/services/vendor.service").VendorService
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
            await db.query(sql(m))
            if (m === "20260920000000_team_leader") await db.query(PEOPLE)
        }
        await db.query(`INSERT INTO "SuperAdmin"(id, email, password, "firstName", "lastName", username, "isProtected", "updatedAt") VALUES ('sa1', 'sa@x', 'p', 'Sam', 'Admin', 'sa1', true, now())`)
        await db.query(`INSERT INTO "Vendor"(id, "companyId", name, "ownerName", "mobileNumber", "locationName", "updatedAt") VALUES
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
        Vendors = (await import("@/lib/services/vendor.service")).VendorService
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
            const { rows } = await db.query(`SELECT r."builtIn", g.permission, r.version FROM "RoleGrant" g JOIN "Role" r ON r.id = g."roleId" WHERE r."companyId" = 'c1' AND (g.permission LIKE 'clients.%' OR g.permission LIKE 'records.%') ORDER BY 1, 2`)
            expect(rows.map(r => `${r.builtIn} ${r.permission}`).sort()).toEqual([
                "ADMIN records.contribute", "ADMIN records.delete", "ADMIN records.edit", "ADMIN records.view",
                "EMPLOYEE records.contribute", "EMPLOYEE records.view",
                "TEAM_LEADER records.contribute", "TEAM_LEADER records.edit", "TEAM_LEADER records.view",
            ])
            const { rows: [employeeRole] } = await db.query(`SELECT version FROM "Role" WHERE "companyId" = 'c1' AND "builtIn" = 'EMPLOYEE'`)
            expect(employeeRole.version).toBe(2)
            const { rows: [template] } = await db.query(`SELECT grants FROM "RoleTemplate" WHERE id = 't'`)
            expect(template.grants).toEqual([{ permission: "tasks.view", scope: "TEAM" }, { permission: "records.delete", scope: "COMPANY" }])
        })

        it("moves a company's own name and icon for the section to Records", async () => {
            const { rows: [company] } = await db.query(`SELECT "moduleLabels", "moduleIcons" FROM "Company" WHERE id = 'c1'`)
            expect(company).toEqual({ moduleLabels: { records: "Files", tasks: "Jobs" }, moduleIcons: { records: "📁" } })
        })

        it("renames the old names on the way in, as main's code still writes them while this waits for review", async () => {
            const { rows: [grant] } = await db.query(`INSERT INTO "RoleGrant"("roleId", permission, scope) SELECT id, 'clients.edit', 'COMPANY' FROM "Role" WHERE "companyId" = 'c2' AND "builtIn" = 'EMPLOYEE' RETURNING permission`)
            expect(grant.permission).toBe("records.edit")
            await db.query(`DELETE FROM "RoleGrant" WHERE permission = 'records.edit' AND "roleId" = (SELECT id FROM "Role" WHERE "companyId" = 'c2' AND "builtIn" = 'EMPLOYEE')`)
            const { rows: [company] } = await db.query(`UPDATE "Company" SET "moduleLabels" = '{"clients":"Accounts"}' WHERE id = 'c2' RETURNING "moduleLabels"`)
            expect(company.moduleLabels).toEqual({ records: "Accounts" })
            // Every other name passes through as it is.
            const { rows: [kept] } = await db.query(`UPDATE "Company" SET "moduleLabels" = '{"vendors":"Suppliers"}' WHERE id = 'c2' RETURNING "moduleLabels"`)
            expect(kept.moduleLabels).toEqual({ vendors: "Suppliers" })
        })

        it("keeps the old section's own rows for main's code, and a section has exactly one owner", async () => {
            await db.query(`INSERT INTO "ClientSection"(id, title, "clientId", "updatedAt") VALUES ('old-s2', 'Another', 'old', now())`)
            await expect(db.query(`INSERT INTO "ClientSection"(id, title, "updatedAt") VALUES ('none', 'Nobody''s', now())`)).rejects.toThrow(/ClientSection_one_owner/)
            await expect(db.query(`INSERT INTO "ClientSection"(id, title, "clientId", "vendorId", "updatedAt") VALUES ('both', 'Both', 'old', 'v1', now())`)).rejects.toThrow(/ClientSection_one_owner/)
        })
    })

    describe("RecordService", () => {
        let licence: string, contract: string, note: string, gamma: string

        it("starts a client's first section by name, and a second record of that name goes into it", async () => {
            const later = () => vi.setSystemTime(new Date(Date.now() + 1000))
            licence = (await Records.create(admin, { content: "Commercial register", files: [file("c1", "reg.pdf")], expiryDate: "2026-10-20", reminderDays: 7, vendorId: "v1", sectionTitle: "Licences" })).id
            later()
            contract = (await Records.create(employee, { content: "Supply contract", files: [], expiryDate: "2026-10-01", reminderDays: null, vendorId: "v1", sectionTitle: "Licences" })).id
            const { sections } = await Records.sectionsOf(admin, "v1")
            expect(sections).toEqual([{ id: expect.any(String), title: "Licences", records: 2 }])
            later()
            note = (await Records.create(admin, { content: "Call before visiting", files: [], expiryDate: null, reminderDays: null, vendorId: "v2", sectionTitle: "Notes" })).id
            later()
            gamma = (await Records.create(otherAdmin, { content: "Gamma licence", files: [], expiryDate: "2026-10-18", reminderDays: null, vendorId: "v3", sectionTitle: "Licences" })).id
            await expect(Records.createSection(admin, { vendorId: "v1", title: "Licences" })).rejects.toThrow("RECORD_SECTION_TAKEN")
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
            expect((await Records.list(admin, { vendorId: "v2", page: 1, limit: 20 })).data.map(r => r.id)).toEqual([note])
        })

        it("hides another company's record, and refuses one's own company's without the permission", async () => {
            await expect(Records.get(otherAdmin, licence)).rejects.toThrow("RECORD_NOT_FOUND")
            await expect(Records.delete(employee, licence)).rejects.toThrow("RECORD_FORBIDDEN")
            await expect(Records.update(admin, { id: licence, content: "x", files: [], filesBefore: [file("c1", "reg.pdf").url], expiryDate: null, reminderDays: null, sectionId: (await Records.sectionsOf(otherAdmin, "v3")).sections[0].id })).rejects.toThrow("RECORD_SECTION_NOT_FOUND")
            await expect(Records.create(admin, { content: "x", files: [file("c2", "theirs.pdf")], expiryDate: null, reminderDays: null, vendorId: "v1", sectionTitle: "Licences" })).rejects.toThrow("RECORD_FILE_INVALID")
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

        it("won't delete a client that has records; its records go first", async () => {
            await expect(Vendors.delete("v2", admin)).rejects.toThrow("VENDOR_HAS_RECORDS")
            await Records.delete(admin, note)
            await Vendors.delete("v2", admin)
            expect((await db.query(`SELECT count(*)::int AS n FROM "ClientSection" WHERE "vendorId" = 'v2'`)).rows[0].n).toBe(0)
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
            expect(audit).toEqual({ userId: "a1", details: { title: "Licences", vendorId: "v1", records: 2 } })
        })

        it("carries only records' files, and removes one only once no record has it", async () => {
            const avatar = { url: `${BUCKET}/c1/avatars/1-face.png`, name: "face.png", size: 100 }
            await expect(Records.create(admin, { content: "x", files: [avatar], expiryDate: null, reminderDays: null, vendorId: "v1", sectionTitle: "Contracts" })).rejects.toThrow("RECORD_FILE_INVALID")
            removed.length = 0
            const shared = file("c1", "shared.pdf")
            const first = (await Records.create(admin, { content: "Lease", files: [shared], expiryDate: null, reminderDays: null, vendorId: "v1", sectionTitle: "Contracts" })).id
            const second = (await Records.create(admin, { content: "Lease, copy", files: [shared, file("c1", "own.pdf")], expiryDate: null, reminderDays: null, vendorId: "v1", sectionTitle: "Contracts" })).id
            await Records.delete(admin, first)
            await Records.update(admin, { id: second, content: "Lease, copy", files: [shared], filesBefore: [shared.url, file("c1", "own.pdf").url], expiryDate: null, reminderDays: null })
            expect(removed).toEqual(["c1/records/own.pdf"])
            await Records.delete(admin, second)
            expect(removed).toEqual(["c1/records/own.pdf", "c1/records/shared.pdf"])
        })

        it("discards files uploaded for a record never saved, but none a record has or that aren't the person's", async () => {
            removed.length = 0
            const kept = file("c1", "on-a-record.pdf")
            await Records.create(admin, { content: "Deed", files: [kept], expiryDate: null, reminderDays: null, vendorId: "v1", sectionTitle: "Contracts" })
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
                const add = (content: string) => Records.create(admin, { content, files: [], expiryDate: null, reminderDays: null, vendorId: "v1", sectionTitle: "Permits" })
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

        it("won't delete a client while a record is being added to it", async () => {
            await db.query(`INSERT INTO "Vendor"(id, "companyId", name, "ownerName", "mobileNumber", "locationName", "updatedAt") VALUES ('v4', 'c1', 'Delta', 'Nour', '0103', 'Suez', now())`)
            const section = (await Records.createSection(admin, { vendorId: "v4", title: "Licences" })).id
            // The record is written and its transaction takes a moment to finish, as someone deletes the client.
            await db.query(`CREATE FUNCTION test_slow() RETURNS trigger AS $$ BEGIN PERFORM pg_sleep(0.5); RETURN NEW; END $$ LANGUAGE plpgsql`)
            await db.query(`CREATE TRIGGER test_slow AFTER INSERT ON "ClientNote" FOR EACH ROW WHEN (NEW.content = 'Trade licence') EXECUTE FUNCTION test_slow()`)
            try {
                const adding = Records.create(admin, { content: "Trade licence", files: [], expiryDate: null, reminderDays: null, sectionId: section })
                await new Promise(r => setTimeout(r, 150))
                const deleting = Vendors.delete("v4", admin)
                const [added, deleted] = await Promise.allSettled([adding, deleting])
                expect(added.status).toBe("fulfilled")
                expect(deleted).toMatchObject({ status: "rejected", reason: { message: "VENDOR_HAS_RECORDS" } })
                expect((await db.query(`SELECT count(*)::int AS n FROM "ClientNote" WHERE "sectionId" = $1`, [section])).rows[0].n).toBe(1)
            } finally {
                await db.query(`DROP TRIGGER test_slow ON "ClientNote"; DROP FUNCTION test_slow()`)
            }
        })

        it("measures expiry by the day where the client's company is", async () => {
            // At 09:00 UTC on the 16th it's 12:00 on the 16th in Cairo and still 23:00 on the 15th in Honolulu.
            await db.query(`UPDATE "Company" SET timezone = 'Pacific/Honolulu' WHERE id = 'c2'`)
            try {
                const there = (await Records.create(otherAdmin, { content: "Harbour permit", files: [], expiryDate: "2026-10-15", reminderDays: null, vendorId: "v3", sectionTitle: "Licences" })).id
                const here = (await Records.create(admin, { content: "Shop permit", files: [], expiryDate: "2026-10-15", reminderDays: null, vendorId: "v1", sectionTitle: "Contracts" })).id
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
            const due = (await Records.create(admin, { content: "Fire certificate", files: [], expiryDate: "2026-10-16", reminderDays: null, vendorId: "v1", sectionTitle: "Contracts" })).id
            const soon = (await Records.create(admin, { content: "Insurance", files: [], expiryDate: "2026-10-20", reminderDays: 7, vendorId: "v1", sectionTitle: "Contracts" })).id
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
            const section = (await Records.createSection(admin, { vendorId: "v1", title: "Old papers" })).id
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
            const section = (await Records.createSection(admin, { vendorId: "v1", title: "Doomed" })).id
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

        it("refuses an edit from a form opened before someone else changed the record's files", async () => {
            const id = (await Records.create(admin, { content: "Lease", files: [], expiryDate: null, reminderDays: null, vendorId: "v1", sectionTitle: "Contracts" })).id
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
            const id = (await Records.create(admin, { content: "Deed", files: [kept], expiryDate: null, reminderDays: null, vendorId: "v1", sectionTitle: "Contracts" })).id
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
            const id = (await Records.create(admin, { content: "Permit", files: [], expiryDate: null, reminderDays: null, vendorId: "v1", sectionTitle: "Contracts" })).id
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
            const id = (await Records.create(admin, { content: "Stamp", files: [file("c1", "stamp.pdf")], expiryDate: null, reminderDays: null, vendorId: "v1", sectionTitle: "Contracts" })).id
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
            await db.query(`INSERT INTO "Vendor"(id, "companyId", name, "ownerName", "mobileNumber", "locationName", "updatedAt") VALUES ('v6', 'c3', 'Zeta', 'Rana', '0105', 'Aswan', now())`)
            await Records.create(superAdmin, { content: "Zeta licence", files: [file("c3", "zeta.pdf")], expiryDate: null, reminderDays: null, vendorId: "v6", sectionTitle: "Licences" })
            removed.length = 0
            const { CompanyService } = await import("@/lib/services/company.service")
            await CompanyService.delete("c3", { user: { ...superAdmin.user, mfaEnabled: true, stepUpAt: Date.now() } })
            expect((await db.query(`SELECT count(*)::int AS n FROM "Company" WHERE id = 'c3'`)).rows[0].n).toBe(0)
            expect(removed).toEqual(["c3/records/zeta.pdf"])
        })

        it("tells a Super Admin's record from one by a user since deleted", async () => {
            await db.query(`INSERT INTO "User"(id, email, password, "firstName", "lastName", role, "lastDayOffResetYear", username, "companyId", "roleId") SELECT 'e9', 'e9@x', 'p', 'Lina', 'Gone', 'EMPLOYEE', 2026, 'e9', 'c1', id FROM "Role" WHERE "companyId" = 'c1' AND "builtIn" = 'EMPLOYEE'`)
            const leaver = { user: withGrants({ id: "e9", role: "EMPLOYEE", companyId: "c1" }) } as any
            const theirs = (await Records.create(leaver, { content: "Left behind", files: [], expiryDate: null, reminderDays: null, vendorId: "v1", sectionTitle: "Contracts" })).id
            const support = (await Records.create(superAdmin, { content: "Added by support", files: [], expiryDate: null, reminderDays: null, vendorId: "v1", sectionTitle: "Contracts" })).id
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
            expect(names(await Records.clients(employee))).toEqual(["Acme", "Delta"])
            expect(names(await Records.clients(otherAdmin))).toEqual(["Gamma"])
            // A Super Admin's chosen company, or every company's, each named with its company.
            expect(names(await Records.clients(superAdmin, "c2"))).toEqual(["Gamma"])
            expect((await Records.clients(superAdmin)).clients.map(c => `${c.name} ${c.company}`)).toEqual(["Acme One", "Delta One", "Gamma Two"])
            // Someone on a role without records.contribute.
            const without = { user: { id: "e1", role: "EMPLOYEE", companyId: "c1", grants: "" } } as any
            await expect(Records.clients(without)).rejects.toThrow("RECORD_FORBIDDEN")
        })

        it("deletes a section with the files an edit just gave one of its records", async () => {
            const id = (await Records.create(admin, { content: "Map", files: [], expiryDate: null, reminderDays: null, vendorId: "v1", sectionTitle: "Plans" })).id
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
            await db.query(`INSERT INTO "Vendor"(id, "companyId", name, "ownerName", "mobileNumber", "locationName", "updatedAt") VALUES ('v7', 'c4', 'Eta', 'Huda', '0106', 'Tanta', now())`)
            const id = (await Records.create(superAdmin, { content: "Eta permit", files: [], expiryDate: null, reminderDays: null, vendorId: "v7", sectionTitle: "Licences" })).id
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
                added = await db.query(`INSERT INTO "Vendor"(id, "companyId", name, "ownerName", "mobileNumber", "locationName", "updatedAt") VALUES ('v8', 'c5', 'Theta', 'Rami', '0107', 'Minya', now())`).then(() => "added", (e: Error) => e.message)
                await db.query(`RESET lock_timeout`)
            })
            expect(added).toMatch(/lock timeout/)
            await db.query(`DELETE FROM "Company" WHERE id = 'c5'`)
        })

        it("gives no record a file being removed from storage", async () => {
            const x = file("c1", "handover.pdf")
            const a = (await Records.create(admin, { content: "Handover", files: [x], expiryDate: null, reminderDays: null, vendorId: "v1", sectionTitle: "Contracts" })).id
            removalTakes = 500
            try {
                removed.length = 0
                // Its file is taken off, and as storage removes it, a request gives the same file to another record.
                const takingOff = Records.update(admin, { id: a, content: "Handover", files: [], filesBefore: [x.url], expiryDate: null, reminderDays: null })
                await new Promise(r => setTimeout(r, 150))
                const [, giving] = await Promise.allSettled([takingOff, Records.create(admin, { content: "Handover, copy", files: [x], expiryDate: null, reminderDays: null, vendorId: "v1", sectionTitle: "Contracts" })])
                expect(removed).toEqual(["c1/records/handover.pdf"])
                expect(giving).toMatchObject({ status: "rejected", reason: { message: "RECORD_FILE_INVALID" } })
                // Nor later.
                await expect(Records.create(admin, { content: "Handover, again", files: [x], expiryDate: null, reminderDays: null, vendorId: "v1", sectionTitle: "Contracts" })).rejects.toThrow("RECORD_FILE_INVALID")
            } finally {
                removalTakes = 0
            }
        })

        it("keeps a file a record is being given as another takes it off", async () => {
            const x = file("c1", "permit-scan.pdf")
            const a = (await Records.create(admin, { content: "Permit scan", files: [x], expiryDate: null, reminderDays: null, vendorId: "v1", sectionTitle: "Contracts" })).id
            await db.query(`CREATE FUNCTION test_slow() RETURNS trigger AS $$ BEGIN PERFORM pg_sleep(0.5); RETURN NEW; END $$ LANGUAGE plpgsql`)
            await db.query(`CREATE TRIGGER test_slow AFTER INSERT ON "ClientNote" FOR EACH ROW WHEN (NEW.content = 'Permit scan, copy') EXECUTE FUNCTION test_slow()`)
            try {
                removed.length = 0
                // Another record is being given the file, and before it's saved, the first takes it off.
                const giving = Records.create(admin, { content: "Permit scan, copy", files: [x], expiryDate: null, reminderDays: null, vendorId: "v1", sectionTitle: "Contracts" })
                await new Promise(r => setTimeout(r, 150))
                await Promise.all([giving, Records.update(admin, { id: a, content: "Permit scan", files: [], filesBefore: [x.url], expiryDate: null, reminderDays: null })])
                // The copy has it, so it stays.
                expect(removed).toEqual([])
            } finally {
                await db.query(`DROP TRIGGER test_slow ON "ClientNote"; DROP FUNCTION test_slow()`)
            }
        })

        it("won't add a record to a client deleted meanwhile", async () => {
            await db.query(`INSERT INTO "Vendor"(id, "companyId", name, "ownerName", "mobileNumber", "locationName", "updatedAt") VALUES ('v5', 'c1', 'Epsilon', 'Hana', '0104', 'Luxor', now())`)
            const section = (await Records.createSection(admin, { vendorId: "v5", title: "Licences" })).id
            await db.query(`DELETE FROM "Vendor" WHERE id = 'v5'`)
            await expect(Records.create(admin, { content: "Late", files: [], expiryDate: null, reminderDays: null, sectionId: section })).rejects.toThrow("RECORD_SECTION_NOT_FOUND")
            await expect(Records.create(admin, { content: "Late", files: [], expiryDate: null, reminderDays: null, vendorId: "v5", sectionTitle: "New" })).rejects.toThrow("VENDOR_NOT_FOUND")
        })

        it("finds any of a company's clients to add a record to by its name, however many it has", async () => {
            await db.query(`INSERT INTO "Company"(id, name, "updatedAt") VALUES ('c4', 'Four', now())`)
            await db.query(`INSERT INTO "Vendor"(id, "companyId", name, "ownerName", "mobileNumber", "locationName", "updatedAt") SELECT 'm' || n, 'c4', 'Market ' || lpad(n::text, 4, '0'), 'Owner', '0100', 'Cairo', now() FROM generate_series(1, 1100) n`)
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
                const section = (await Records.createSection(admin, { vendorId: "v1", title })).id
                const files = (n: number) => JSON.stringify(Array.from({ length: 10 }, (_, i) => ({ url: `${BUCKET}/c1/records/${title}-${n}-${i}.pdf`, name: `${title}-${n}-${i}.pdf`, size: 1 })))
                for (let n = 0; n < 25; n++) await db.query(`INSERT INTO "ClientNote"(id, content, "sectionId", "updatedAt", attachment) VALUES ($1, 'Archived', $2, now(), $3)`, [`${title}-${n}`, section, files(n)])
                return section
            }
            const noted = async (title: string) => (await db.query(`SELECT count(*)::int AS n FROM "RemovedRecordFile" WHERE path LIKE $1`, [`c1/records/${title}-%`])).rows[0].n
            removed.length = 0
            await Records.deleteSection(admin, await archive("archive"))
            expect(new Set(removed).size).toBe(250)
            expect(await noted("archive")).toBe(250)
            // One call refused leaves the others' files removed, and its own for the sweep.
            removed.length = 0
            refuseCalls = 1
            await Records.deleteSection(admin, await archive("boxes"))
            expect(refuseCalls).toBe(0)
            expect(new Set(removed).size).toBe(150)
            expect(await noted("boxes")).toBe(150)
        })

        it("sends the reminders on when whoever added a record is deleted as they go out", async () => {
            await db.query(`INSERT INTO "User"(id, email, password, "firstName", "lastName", role, "lastDayOffResetYear", username, "companyId", "roleId") SELECT 'e8', 'e8@x', 'p', 'Nour', 'Gone', 'EMPLOYEE', 2026, 'e8', 'c1', id FROM "Role" WHERE "companyId" = 'c1' AND "builtIn" = 'EMPLOYEE'`)
            const leaver = { user: withGrants({ id: "e8", role: "EMPLOYEE", companyId: "c1" }) } as any
            const theirs = (await Records.create(leaver, { content: "Trade licence", files: [], expiryDate: "2026-10-16", reminderDays: null, vendorId: "v1", sectionTitle: "Contracts" })).id
            const soon = (await Records.create(leaver, { content: "Tax card", files: [], expiryDate: "2026-10-20", reminderDays: 7, vendorId: "v1", sectionTitle: "Contracts" })).id
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

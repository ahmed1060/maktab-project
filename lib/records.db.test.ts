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
vi.mock("@/lib/storage", () => ({ supabase: { storage: { from: () => ({ remove: async (paths: string[]) => { removed.push(...paths); return {} } }) } } }))

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
        Records = (await import("@/lib/services/record.service")).RecordService
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
            await expect(Records.update(admin, { id: licence, content: "x", files: [], expiryDate: null, reminderDays: null, sectionId: (await Records.sectionsOf(otherAdmin, "v3")).sections[0].id })).rejects.toThrow("RECORD_SECTION_NOT_FOUND")
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
            await Records.update(admin, { id: licence, content: "Commercial register, renewed", files: [], expiryDate: "2027-10-20", reminderDays: 7, sectionId: section })
            const { rows: [row] } = await db.query(`SELECT "notifiedDaysBefore", "notifiedOnExpiry", "lastEditedById" FROM "ClientNote" WHERE id = $1`, [licence])
            expect(row).toEqual({ notifiedDaysBefore: false, notifiedOnExpiry: false, lastEditedById: "a1" })
            expect(removed).toEqual(["c1/records/reg.pdf"])
            // An edit that leaves the dates alone leaves what was sent alone.
            await db.query(`UPDATE "ClientNote" SET "notifiedDaysBefore" = true WHERE id = $1`, [licence])
            await Records.update(admin, { id: licence, content: "Commercial register, renewed.", files: [], expiryDate: "2027-10-20", reminderDays: 7 })
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
            await Records.update(admin, { id: contract, content: "Supply contract", files: [file("c1", "contract.pdf")], expiryDate: null, reminderDays: null })
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
            await Records.update(admin, { id: second, content: "Lease, copy", files: [shared], expiryDate: null, reminderDays: null })
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

        it("won't add a record to a client deleted meanwhile", async () => {
            await db.query(`INSERT INTO "Vendor"(id, "companyId", name, "ownerName", "mobileNumber", "locationName", "updatedAt") VALUES ('v5', 'c1', 'Epsilon', 'Hana', '0104', 'Luxor', now())`)
            const section = (await Records.createSection(admin, { vendorId: "v5", title: "Licences" })).id
            await db.query(`DELETE FROM "Vendor" WHERE id = 'v5'`)
            await expect(Records.create(admin, { content: "Late", files: [], expiryDate: null, reminderDays: null, sectionId: section })).rejects.toThrow("RECORD_SECTION_NOT_FOUND")
            await expect(Records.create(admin, { content: "Late", files: [], expiryDate: null, reminderDays: null, vendorId: "v5", sectionTitle: "New" })).rejects.toThrow("VENDOR_NOT_FOUND")
        })
    })
})

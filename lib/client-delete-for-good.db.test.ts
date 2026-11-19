import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { readFileSync, readdirSync } from "node:fs"
import { Client } from "pg"
import { withGrants } from "@/lib/permissions/test-actors"

/**
 * Deleting a client that has a tax position (CLIENT_PORTAL_PLAN.md §3.6;
 * PR 313), against a real Postgres: it's archived instead, as one with tasks
 * or records is, and deleted for good only from the archive, where no task
 * or record holds it.
 *
 * Needs a Postgres it may create databases on: set ROLES_TEST_DATABASE_URL to
 * its maintenance database. Skipped without it (CI has no database).
 */

const ADMIN_URL = process.env.ROLES_TEST_DATABASE_URL
const MIGRATIONS = readdirSync("prisma/migrations").filter(m => m !== "migration_lock.toml").sort((a, b) => (a === "0_init" ? -1 : b === "0_init" ? 1 : a.localeCompare(b)))
const sql = (name: string) => readFileSync(`prisma/migrations/${name}/migration.sql`, "utf8")

const PEOPLE = `
INSERT INTO "Company"(id, name, "updatedAt") VALUES ('c1', 'One', now()), ('c2', 'Two', now());
INSERT INTO "User"(id, email, password, "firstName", "lastName", role, "lastDayOffResetYear", username, "companyId", "teamLeaderId") VALUES
 ('a1', 'a1@x', 'p', 'Amal', 'One', 'ADMIN', 2026, 'a1', 'c1', NULL),
 ('e1', 'e1@x', 'p', 'Ehab', 'One', 'EMPLOYEE', 2026, 'e1', 'c1', NULL),
 ('a2', 'a2@x', 'p', 'Adel', 'Two', 'ADMIN', 2026, 'a2', 'c2', NULL);
`
// Plain has nothing. Taxed has a file with two open claims, and Nothing owed
// one with none. In the archive, already: Kept, with a claim and no task or
// record; Bare, with nothing at all; Working, with a task; Filed, with a
// record. Busy has a claim and isn't archived. Theirs is another company's.
const CLIENTS = `
INSERT INTO "Client"(id, "companyId", name, "ownerName", "mobileNumber", "locationName", "updatedAt", "archivedAt") VALUES
 ('plain', 'c1', 'Plain', 'Omar', '0100', 'Cairo', now(), NULL),
 ('taxed', 'c1', 'Taxed', 'Dina', '0101', 'Giza', now(), NULL),
 ('nothing-owed', 'c1', 'Nothing owed', 'Farid', '0102', 'Giza', now(), NULL),
 ('kept', 'c1', 'Kept', 'Ola', '0103', 'Giza', now(), '2026-10-01T10:00:00Z'),
 ('bare', 'c1', 'Bare', 'Basma', '0104', 'Giza', now(), '2026-10-01T10:00:00Z'),
 ('working', 'c1', 'Working', 'Wael', '0105', 'Giza', now(), '2026-10-01T10:00:00Z'),
 ('filed', 'c1', 'Filed', 'Fadi', '0106', 'Giza', now(), '2026-10-01T10:00:00Z'),
 ('busy', 'c1', 'Busy', 'Bahaa', '0107', 'Giza', now(), NULL),
 ('theirs', 'c2', 'Theirs', 'Tarek', '0108', 'Tokyo', now(), '2026-10-01T10:00:00Z');
INSERT INTO "ClientTaxPosition"("clientId", "companyId", "asOf", "uploadedById", "uploadedByName", "uploadedAt", "updatedAt")
 SELECT id, "companyId", '2026-10-14', NULL, 'Amal One', '2026-10-15T09:00:00Z', now() FROM "Client" WHERE id NOT IN ('plain', 'bare');
INSERT INTO "TaxClaim"(id, "companyId", "clientId", "claimNumber", item, "originalAmount", "paidAmount", "remainingAmount", "dueDate") VALUES
 ('x1', 'c1', 'taxed', '000101', 'إقرار ضريبة الدخل', 100, 0, 100, '2026-12-31'),
 ('x2', 'c1', 'taxed', '000102', 'إقرار القيمة المضافة', 50, 10, 40, '2026-12-31'),
 ('k1', 'c1', 'kept', '000201', 'إقرار ضريبة الدخل', 100, 0, 100, '2026-12-31'),
 ('w1', 'c1', 'working', '000301', 'إقرار ضريبة الدخل', 100, 0, 100, '2026-12-31'),
 ('f1', 'c1', 'filed', '000401', 'إقرار ضريبة الدخل', 100, 0, 100, '2026-12-31'),
 ('b1', 'c1', 'busy', '000501', 'إقرار ضريبة الدخل', 100, 0, 100, '2026-12-31'),
 ('t1', 'c2', 'theirs', '000601', 'إقرار ضريبة الدخل', 100, 0, 100, '2026-12-31');
INSERT INTO "Task"(id, title, description, status, deadline, "companyId", "clientId", "updatedAt") VALUES
 ('job', 'Fix the gate', 'd', 'IN_PROGRESS', now() + interval '2 days', 'c1', 'working', now());
INSERT INTO "ClientSection"(id, title, "clientId", "updatedAt") VALUES ('licences', 'Licences', 'filed', now());
INSERT INTO "ClientNote"(id, content, "sectionId", "updatedAt") VALUES ('licence', 'Trade licence', 'licences', now());
`

// People who can sign in (§3.6, PR 329): Signed is in use with two, and
// no tax position, task or record; Gone is in the archive with three; Both
// is in use with a tax position and one.
const ACCOUNTS = `
INSERT INTO "Client"(id, "companyId", name, "ownerName", "mobileNumber", "locationName", "updatedAt", "archivedAt") VALUES
 ('signed', 'c1', 'Signed', 'Sara', '0109', 'Giza', now(), NULL),
 ('gone', 'c1', 'Gone', 'Gamal', '0110', 'Giza', now(), '2026-10-01T10:00:00Z'),
 ('both', 'c1', 'Both', 'Bassem', '0111', 'Giza', now(), NULL);
INSERT INTO "ClientTaxPosition"("clientId", "companyId", "asOf", "uploadedById", "uploadedByName", "uploadedAt", "updatedAt")
 VALUES ('both', 'c1', '2026-10-14', NULL, 'Amal One', '2026-10-15T09:00:00Z', now());
INSERT INTO "ClientAccount"(id, "companyId", "clientId", name, email, "updatedAt") VALUES
 ('b9', 'c1', 'both', 'Basma', 'b9@client.example', now()),
 ('s1', 'c1', 'signed', 'Salma', 's1@client.example', now()),
 ('s2', 'c1', 'signed', 'Samir', 's2@client.example', now()),
 ('g1', 'c1', 'gone', 'Ghada', 'g1@client.example', now()),
 ('g2', 'c1', 'gone', 'Galal', 'g2@client.example', now()),
 ('g3', 'c1', 'gone', 'Gihan', 'g3@client.example', now());
`

const admin = { user: withGrants({ id: "a1", role: "ADMIN", companyId: "c1", name: "Amal One" }) } as any
const employee = { user: withGrants({ id: "e1", role: "EMPLOYEE", companyId: "c1", name: "Ehab One" }) } as any
const otherAdmin = { user: withGrants({ id: "a2", role: "ADMIN", companyId: "c2", name: "Adel Two" }) } as any

describe.skipIf(!ADMIN_URL)("deleting a client that has a tax position, in Postgres", () => {
    const dbName = `client_for_good_test_${Date.now()}`
    let db: Client
    let ClientService: typeof import("@/lib/services/client.service").ClientService
    let prisma: typeof import("@/lib/prisma").prisma

    const row = async (id: string) => (await db.query(`SELECT "archivedAt" FROM "Client" WHERE id = $1`, [id])).rows[0] as { archivedAt: Date | null } | undefined
    const claims = async (id: string) => Number((await db.query(`SELECT count(*) FROM "TaxClaim" WHERE "clientId" = $1`, [id])).rows[0].count)
    const positions = async (id: string) => Number((await db.query(`SELECT count(*) FROM "ClientTaxPosition" WHERE "clientId" = $1`, [id])).rows[0].count)
    const accounts = async (id: string) => Number((await db.query(`SELECT count(*) FROM "ClientAccount" WHERE "clientId" = $1`, [id])).rows[0].count)
    const logged = async (id: string) => (await db.query(`SELECT action, details, "userId" FROM "AuditLog" WHERE "entityId" = $1 ORDER BY "createdAt"`, [id])).rows as { action: string; details: unknown; userId: string | null }[]

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
            await db.query(sql(m))
            if (m === "20260920000000_team_leader") await db.query(PEOPLE)
        }
        await db.query(CLIENTS)
        await db.query(ACCOUNTS)
        process.env.POSTGRES_PRISMA_URL = url.toString()
        ClientService = (await import("@/lib/services/client.service")).ClientService
        prisma = (await import("@/lib/prisma")).prisma
    }, 180_000)

    afterAll(async () => {
        await prisma?.$disconnect()
        await db?.end()
        const a = new Client({ connectionString: ADMIN_URL })
        await a.connect()
        await a.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`)
        await a.end()
    })

    describe("Delete", () => {
        it("archives a client with a tax position instead, as one with tasks or records, its claims staying", async () => {
            const result = await ClientService.delete("taxed", admin)
            expect(result).toMatchObject({ archived: true, forTax: true })
            expect((await row("taxed"))?.archivedAt).toBeInstanceOf(Date)
            expect(await claims("taxed")).toBe(2)
            expect(await logged("taxed")).toEqual([{ action: "ARCHIVE_VENDOR", userId: "a1", details: { name: "Taxed", records: 0, tasks: 0, claims: 2 } }])
        })

        it("archives one whose file had no open claim too: the day and Nothing owed are its tax position", async () => {
            const result = await ClientService.delete("nothing-owed", admin)
            expect(result).toMatchObject({ archived: true, forTax: true })
            expect((await row("nothing-owed"))?.archivedAt).toBeInstanceOf(Date)
            expect(await positions("nothing-owed")).toBe(1)
        })

        it("still deletes one with nothing", async () => {
            const result = await ClientService.delete("plain", admin)
            expect(result).toMatchObject({ archived: false })
            expect(await row("plain")).toBeUndefined()
            expect(await logged("plain")).toEqual([{ action: "DELETE_VENDOR", userId: "a1", details: { name: "Plain" } }])
        })

        it("leaves an archived client in the archive, with the day it went there", async () => {
            const result = await ClientService.delete("kept", admin)
            expect(result).toMatchObject({ archived: true })
            expect((await row("kept"))?.archivedAt?.toISOString()).toBe("2026-10-01T10:00:00.000Z")
            expect(await claims("kept")).toBe(1)
        })

        it("says a client archived for its tasks or records wasn't archived for its tax position", async () => {
            expect(await ClientService.delete("working", admin)).toMatchObject({ archived: true, forTax: false, forPeople: false })
        })

        it("archives a client with people who can sign in instead, though nothing else holds it, their accounts staying (PR 329)", async () => {
            const result = await ClientService.delete("signed", admin)
            expect(result).toMatchObject({ archived: true, forTax: false, forPeople: true })
            expect((await row("signed"))?.archivedAt).toBeInstanceOf(Date)
            expect(await accounts("signed")).toBe(2)
            expect(await logged("signed")).toEqual([{ action: "ARCHIVE_VENDOR", userId: "a1", details: { name: "Signed", records: 0, tasks: 0, people: 2 } }])
        })

        it("says a client archived for its tax position wasn't archived for its people, though it has some", async () => {
            expect(await ClientService.delete("both", admin)).toMatchObject({ archived: true, forTax: true, forPeople: false })
            expect(await logged("both")).toEqual([{ action: "ARCHIVE_VENDOR", userId: "a1", details: { name: "Both", records: 0, tasks: 0, claims: 0, people: 1 } }])
        })
    })

    describe("Delete permanently", () => {
        it("is only from the archive: a client in use is refused, and nothing of it goes", async () => {
            await expect(ClientService.delete("busy", admin, { forGood: true })).rejects.toThrow("CLIENT_NOT_ARCHIVED")
            expect(await row("busy")).toEqual({ archivedAt: null })
            expect(await claims("busy")).toBe(1)
            expect(await logged("busy")).toEqual([])
        })

        it("is for whoever may manage clients, in their own company", async () => {
            await expect(ClientService.delete("kept", employee, { forGood: true })).rejects.toThrow("FORBIDDEN")
            await expect(ClientService.delete("kept", otherAdmin, { forGood: true })).rejects.toThrow("FORBIDDEN")
            await expect(ClientService.delete("nobody", admin, { forGood: true })).rejects.toThrow("CLIENT_NOT_FOUND")
            expect(await row("kept")).toBeDefined()
            expect(await claims("kept")).toBe(1)
        })

        it("keeps one with tasks or records in the archive", async () => {
            await expect(ClientService.delete("working", admin, { forGood: true })).rejects.toThrow("CLIENT_IN_USE")
            await expect(ClientService.delete("filed", admin, { forGood: true })).rejects.toThrow("CLIENT_IN_USE")
            expect(await row("working")).toBeDefined()
            expect(await row("filed")).toBeDefined()
            expect(await claims("working")).toBe(1)
            expect(await claims("filed")).toBe(1)
            expect((await db.query(`SELECT count(*) FROM "ClientNote" WHERE id = 'licence'`)).rows[0].count).toBe("1")
            expect((await db.query(`SELECT "clientId" FROM "Task" WHERE id = 'job'`)).rows[0].clientId).toBe("working")
        })

        it("deletes an archived client that only its tax position holds, its claims and their day going with it", async () => {
            const result = await ClientService.delete("kept", admin, { forGood: true })
            expect(result).toMatchObject({ archived: false })
            expect(await row("kept")).toBeUndefined()
            expect(await claims("kept")).toBe(0)
            expect(await positions("kept")).toBe(0)
            const entries = await logged("kept")
            expect(entries[entries.length - 1]).toEqual({ action: "DELETE_VENDOR", userId: "a1", details: { name: "Kept", claims: 1 } })
        })

        it("deletes one with nothing at all", async () => {
            await ClientService.delete("bare", admin, { forGood: true })
            expect(await row("bare")).toBeUndefined()
            expect(await logged("bare")).toEqual([{ action: "DELETE_VENDOR", userId: "a1", details: { name: "Bare", claims: 0 } }])
        })

        it("deletes an archived client with people who can sign in, their accounts going with it, and says how many went (PR 329)", async () => {
            await ClientService.delete("gone", admin, { forGood: true })
            expect(await row("gone")).toBeUndefined()
            expect(await accounts("gone")).toBe(0)
            expect(await logged("gone")).toEqual([{ action: "DELETE_VENDOR", userId: "a1", details: { name: "Gone", claims: 0, people: 3 } }])
        })

        it("deletes one just archived for its people, in the second step", async () => {
            // Signed was archived above, by Delete.
            await ClientService.delete("signed", admin, { forGood: true })
            expect(await row("signed")).toBeUndefined()
            expect(await accounts("signed")).toBe(0)
        })

        it("deletes one just archived for its tax position, in the second step", async () => {
            // Taxed was archived above, by Delete.
            await ClientService.delete("taxed", admin, { forGood: true })
            expect(await row("taxed")).toBeUndefined()
            expect(await claims("taxed")).toBe(0)
            // The other company's is untouched by any of it.
            expect(await claims("theirs")).toBe(1)
        })
    })
})

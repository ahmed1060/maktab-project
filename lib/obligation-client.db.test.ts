import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { readFileSync, readdirSync } from "node:fs"
import { Client } from "pg"
import { withGrants } from "@/lib/permissions/test-actors"

/**
 * An obligation's client, against a real Postgres built from the migrations
 * (LATER_CHANGES_PLAN.md §7.7, 7a): the column and its key, taken as a
 * task's is (there, the obligation's company's, not archived), kept each
 * time a repeating one comes round, the list's filter, and a client with
 * obligations archived rather than deleted.
 *
 * Needs a Postgres it may create databases on: set ROLES_TEST_DATABASE_URL to
 * its maintenance database. Skipped without it (CI has no database).
 */

const ADMIN_URL = process.env.ROLES_TEST_DATABASE_URL
const MIGRATIONS = readdirSync("prisma/migrations").filter(m => m !== "migration_lock.toml").sort((a, b) => (a === "0_init" ? -1 : b === "0_init" ? 1 : a.localeCompare(b)))
const sql = (name: string) => readFileSync(`prisma/migrations/${name}/migration.sql`, "utf8")

// Made-up companies, people and clients.
const PEOPLE = `
INSERT INTO "Company"(id, name, "updatedAt", timezone) VALUES ('c1', 'Made Up', now(), 'Africa/Cairo'), ('c2', 'Other Made Up', now(), 'Africa/Cairo');
INSERT INTO "User"(id, email, password, "firstName", "lastName", role, "lastDayOffResetYear", username, "companyId") VALUES
 ('a1', 'a1@x', 'p', 'Amal', 'One', 'ADMIN', 2026, 'a1', 'c1'),
 ('e1', 'e1@x', 'p', 'Ehab', 'One', 'EMPLOYEE', 2026, 'e1', 'c1'),
 ('e2', 'e2@x', 'p', 'Eman', 'Two', 'EMPLOYEE', 2026, 'e2', 'c2');
`

const admin = { user: withGrants({ id: "a1", role: "ADMIN", companyId: "c1", name: "Amal One" }) }
const superAdmin = { user: { id: "sa", role: "SUPER_ADMIN", companyId: null, name: "Nizmo" } }
const inDays = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString()
const asked = (fields: object = {}) => ({ title: "Monthly VAT return", description: "Filed for the client each month", assigneeIds: ["e1"], deadline: inDays(3), recurrence: "MONTHLY", difficulty: 1, ...fields }) as never

describe.skipIf(!ADMIN_URL)("an obligation's client, in Postgres", () => {
    const dbName = `obligation_client_test_${Date.now()}`
    let db: Client
    let prisma: typeof import("@/lib/prisma").prisma
    let Obligations: typeof import("@/lib/services/obligation.service").ObligationService

    const refusal = (p: Promise<unknown>) => p.then(() => "made", (e: Error) => e.message)
    const clientOf = async (id: string) => (await db.query(`SELECT "clientId" FROM "Obligation" WHERE id = $1`, [id])).rows[0]?.clientId ?? null
    const count = async () => Number((await db.query(`SELECT count(*) FROM "Obligation"`)).rows[0].count)

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
        await db.query(`INSERT INTO "SuperAdmin"(id, email, username, password, "firstName", "lastName", "updatedAt") VALUES ('sa', 'sa@x', 'sa', 'p', 'Sara', 'Admin', now())`)
        await db.query(`INSERT INTO "Client"(id, name, "ownerName", "mobileNumber", "locationName", "companyId", "updatedAt", "archivedAt") VALUES
            ('k1', 'Nile Foods', 'Owner One', '01000000001', 'Made-up street', 'c1', now(), NULL),
            ('k2', 'Delta Paper', 'Owner Two', '01000000002', 'Made-up street', 'c1', now(), now()),
            ('k3', 'Other Company Client', 'Owner Three', '01000000003', 'Made-up street', 'c2', now(), NULL),
            ('k4', 'Red Sea Tiles', 'Owner Four', '01000000004', 'Made-up street', 'c1', now(), NULL)`)
        process.env.POSTGRES_PRISMA_URL = url.toString()
        prisma = (await import("@/lib/prisma")).prisma
        Obligations = (await import("@/lib/services/obligation.service")).ObligationService
    }, 180_000)

    afterAll(async () => {
        await prisma?.$disconnect()
        await db?.end()
        const a = new Client({ connectionString: ADMIN_URL })
        await a.connect()
        await a.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`)
        await a.end()
    })

    it("is a column with its index, whose client deleted leaves the obligation with none", async () => {
        const column = (await db.query(`SELECT is_nullable FROM information_schema.columns WHERE table_name = 'Obligation' AND column_name = 'clientId'`)).rows
        expect(column).toEqual([{ is_nullable: "YES" }])
        const index = (await db.query(`SELECT indexdef FROM pg_indexes WHERE tablename = 'Obligation' AND indexname = 'Obligation_clientId_idx'`)).rows
        expect(index).toHaveLength(1)
        const key = (await db.query(`SELECT confdeltype FROM pg_constraint WHERE conname = 'Obligation_clientId_fkey'`)).rows
        expect(key).toEqual([{ confdeltype: "n" }])
    })

    it("is kept as picked, or none", async () => {
        const withClient = await Obligations.create(asked({ clientId: "k1" }), admin)
        expect(await clientOf(withClient.id)).toBe("k1")
        const without = await Obligations.create(asked({ title: "Yearly audit" }), admin)
        expect(await clientOf(without.id)).toBeNull()
        await db.query(`DELETE FROM "Obligation"`)
    })

    it("is refused, with nothing written, when it isn't there, is another company's, or is archived", async () => {
        expect(await refusal(Obligations.create(asked({ clientId: "gone" }), admin))).toBe("CLIENT_NOT_FOUND")
        expect(await refusal(Obligations.create(asked({ clientId: "k3" }), admin))).toBe("CROSS_COMPANY_CLIENT_FORBIDDEN")
        expect(await refusal(Obligations.create(asked({ clientId: "k2" }), admin))).toBe("CLIENT_ARCHIVED")
        expect(await count()).toBe(0)
    })

    it("is checked before anything is held, as a task's is: there, the work's company's, not archived", async () => {
        // The shared check, before the transaction; the hold inside it catches one archived meanwhile.
        const { clientFor } = await import("@/lib/services/client-in-use")
        expect(await clientFor("k1", "c1")).toBe("k1")
        expect(await refusal(clientFor("gone", "c1"))).toBe("CLIENT_NOT_FOUND")
        expect(await refusal(clientFor("k3", "c1"))).toBe("CROSS_COMPANY_CLIENT_FORBIDDEN")
        expect(await refusal(clientFor("k2", "c1"))).toBe("CLIENT_ARCHIVED")
    })

    it("is the first person's company's for the Super Admin", async () => {
        expect(await refusal(Obligations.create(asked({ clientId: "k1", assigneeIds: ["e2"] }), superAdmin))).toBe("CROSS_COMPANY_CLIENT_FORBIDDEN")
        const made = await Obligations.create(asked({ clientId: "k3", assigneeIds: ["e2"] }), superAdmin)
        expect(await clientOf(made.id)).toBe("k3")
        await db.query(`DELETE FROM "Obligation"`)
    })

    it("is refused when archived while the obligation is being written, the client held until it is", async () => {
        // Archiving holds the client's row first, as deleting it does (CLIENTS_PLAN.md §4.3).
        const archiving = new Client({ connectionString: (process.env.POSTGRES_PRISMA_URL as string) })
        await archiving.connect()
        try {
            await archiving.query("BEGIN")
            await archiving.query(`SELECT id FROM "Client" WHERE id = 'k4' FOR UPDATE`)
            const making = refusal(Obligations.create(asked({ clientId: "k4" }), admin))
            await new Promise(r => setTimeout(r, 300))
            await archiving.query(`UPDATE "Client" SET "archivedAt" = now() WHERE id = 'k4'`)
            await archiving.query("COMMIT")
            expect(await making).toBe("CLIENT_ARCHIVED")
            expect(await count()).toBe(0)
        } finally {
            await archiving.query(`UPDATE "Client" SET "archivedAt" = NULL WHERE id = 'k4'`)
            await archiving.end()
        }
    })

    it("is kept each time a repeating one comes round, archived since or not", async () => {
        const monthly = await Obligations.create(asked({ clientId: "k4" }), admin)
        await db.query(`UPDATE "Obligation" SET status = 'APPROVED' WHERE id = $1`, [monthly.id])
        await db.query(`UPDATE "Client" SET "archivedAt" = now() WHERE id = 'k4'`)
        try {
            const made = await Obligations.processRecurrentObligations()
            expect(made).toHaveLength(1)
            expect(await clientOf(made[0].nextId)).toBe("k4")
        } finally {
            await db.query(`UPDATE "Client" SET "archivedAt" = NULL WHERE id = 'k4'`)
            await db.query(`DELETE FROM "Notification"`)
            await db.query(`DELETE FROM "Obligation"`)
        }
    })

    it("narrows the list to one client, or to those with none", async () => {
        const { placeFilters, NO_CLIENT } = await import("@/lib/place-filters")
        const nile = await Obligations.create(asked({ clientId: "k1" }), admin)
        const none = await Obligations.create(asked({ title: "Yearly audit" }), admin)
        const ids = async (clientId: string) => (await prisma.obligation.findMany({ where: { companyId: "c1", AND: placeFilters(clientId) }, select: { id: true } })).map(o => o.id)
        expect(await ids("k1")).toEqual([nile.id])
        expect(await ids(NO_CLIENT)).toEqual([none.id])
        await db.query(`DELETE FROM "Obligation"`)
    })

    it("holds its client: archived rather than deleted, and not deleted for good from the archive", async () => {
        const { ClientService } = await import("@/lib/services/client.service")
        await Obligations.create(asked({ clientId: "k1" }), admin)
        const archived = await ClientService.delete("k1", admin as never)
        expect(archived).toMatchObject({ archived: true, forTax: false, forPeople: false })
        expect(await refusal(ClientService.delete("k1", admin as never, { forGood: true }))).toBe("CLIENT_IN_USE")
        expect((await db.query(`SELECT "archivedAt" IS NOT NULL AS archived FROM "Client" WHERE id = 'k1'`)).rows[0].archived).toBe(true)
        const audit = (await db.query(`SELECT details FROM "AuditLog" WHERE action = 'ARCHIVE_VENDOR' AND "entityId" = 'k1'`)).rows
        expect(audit[0].details).toMatchObject({ records: 0, tasks: 0, obligations: 1 })
    })
})

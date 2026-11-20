import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { readFileSync, readdirSync } from "node:fs"
import { Client } from "pg"
import { withGrants } from "@/lib/permissions/test-actors"

/**
 * A client's responsible accountant (CLIENT_PORTAL_PLAN.md §7, §12 step 9b;
 * PR 343), against a real Postgres: who may be picked, saving a pick with its
 * audit entry, what's refused, what a contract's end does to it, and the
 * clients a person answers for.
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
 ('a1', 'a1@x.co', 'p', 'Amal', 'One', 'ADMIN', 2026, 'a1', 'c1', NULL),
 ('t1', 't1@x.co', 'p', 'Tamer', 'One', 'TEAM_LEADER', 2026, 't1', 'c1', NULL),
 ('e1', 'e1@x.co', 'p', 'Eman', 'One', 'EMPLOYEE', 2026, 'e1', 'c1', 't1'),
 ('s1', 's1@x.co', 'p', 'Samy', 'Away', 'EMPLOYEE', 2026, 's1', 'c1', NULL),
 ('gone', 'gone@x.co', 'p', 'Gamal', 'Gone', 'EMPLOYEE', 2026, 'gone', 'c1', NULL),
 ('del', 'del@x.co', 'p', 'Dalia', 'Deleted', 'EMPLOYEE', 2026, 'del', 'c1', NULL),
 ('a2', 'a2@x.co', 'p', 'Adel', 'Two', 'ADMIN', 2026, 'a2', 'c2', NULL);
`
// Al Noor and Delta are in use; Old Mill is archived; Their client is another company's.
const CLIENTS = `
UPDATE "User" SET "whatsappNumber" = '+201001234567' WHERE id = 't1';
UPDATE "User" SET status = 'SUSPENDED' WHERE id = 's1';
UPDATE "User" SET status = 'ARCHIVED' WHERE id = 'gone';
UPDATE "User" SET status = 'DELETED' WHERE id = 'del';
INSERT INTO "SuperAdmin"(id, email, password, "firstName", "lastName", username, "updatedAt") VALUES ('sa', 'sam@nizmo.co', 'p', 'Sam', 'Admin', 'sa', now());
INSERT INTO "Client"(id, "companyId", name, "ownerName", "mobileNumber", "locationName", "updatedAt", "archivedAt") VALUES
 ('noor', 'c1', 'Al Noor', 'Omar', '0100', 'Cairo', now(), NULL),
 ('delta', 'c1', 'Delta Foods', 'Dina', '0102', 'Giza', now(), NULL),
 ('old', 'c1', 'Old Mill', 'Ola', '0107', 'Giza', now(), now()),
 ('theirs', 'c2', 'Their client', 'Tarek', '0108', 'Tokyo', now(), NULL);
`

const admin = withGrants({ id: "a1", role: "ADMIN", companyId: "c1", name: "Amal One" }) as any
const leader = withGrants({ id: "t1", role: "TEAM_LEADER", companyId: "c1", name: "Tamer One" }) as any
const otherAdmin = withGrants({ id: "a2", role: "ADMIN", companyId: "c2", name: "Adel Two" }) as any
const superAdmin = { id: "sa", role: "SUPER_ADMIN", companyId: null, name: "Sam Admin" } as any
const FIVE = { page: 1, limit: 5, skip: 0 }

describe.skipIf(!ADMIN_URL)("the responsible accountant, in Postgres", () => {
    const dbName = `client_accountant_test_${Date.now()}`
    let db: Client
    let accountants: typeof import("@/lib/services/client-accountant.service")
    let prisma: typeof import("@/lib/prisma").prisma

    const kept = async (clientId: string) => (await db.query(`SELECT "responsibleAccountantId" AS id FROM "Client" WHERE id = $1`, [clientId])).rows[0].id
    const logged = async (clientId: string) => (await db.query(`SELECT action, "entityType", details, "userId", "superAdminId" FROM "AuditLog" WHERE "entityId" = $1 AND action = 'SET_CLIENT_ACCOUNTANT' ORDER BY "createdAt"`, [clientId])).rows
    const everything = async () => (await db.query(`SELECT (SELECT string_agg(id || '=' || coalesce("responsibleAccountantId", '-'), ',' ORDER BY id) FROM "Client") AS picks, (SELECT count(*) FROM "AuditLog")::int AS logged`)).rows[0]
    const set = (user: unknown, clientId: string, userId: string | null) => accountants.setClientAccountant(user as any, { clientId, userId })

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
        process.env.POSTGRES_PRISMA_URL = url.toString()
        accountants = await import("@/lib/services/client-accountant.service")
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

    describe("the column", () => {
        it("is no one's to start with", async () => {
            expect(await kept("noor")).toBeNull()
        })

        it("holds a person who's there, and is no one's when they're deleted outright", async () => {
            const refused = await db.query(`UPDATE "Client" SET "responsibleAccountantId" = 'nobody' WHERE id = 'delta'`).then(() => "saved", (error: { code?: string }) => error.code)
            expect(refused).toBe("23503")
            await db.query(`INSERT INTO "User"(id, email, password, "firstName", "lastName", role, "lastDayOffResetYear", username, "companyId", "roleId")
                SELECT 'brief', 'brief@x.co', 'p', 'Brief', 'Stay', 'EMPLOYEE', 2026, 'brief', 'c1', id FROM "Role" WHERE "companyId" = 'c1' AND "builtIn" = 'EMPLOYEE'`)
            await db.query(`UPDATE "Client" SET "responsibleAccountantId" = 'brief' WHERE id = 'delta'`)
            await db.query(`DELETE FROM "User" WHERE id = 'brief'`)
            expect(await kept("delta")).toBeNull()
        })
    })

    describe("who may be picked", () => {
        it("is the client's company's people whose contracts haven't ended, by name", async () => {
            expect(await accountants.accountantCandidates(admin, "noor")).toEqual({
                people: [
                    { id: "a1", name: "Amal One" },
                    { id: "e1", name: "Eman One" },
                    // Suspended, still employed.
                    { id: "s1", name: "Samy Away" },
                    { id: "t1", name: "Tamer One" },
                ],
            })
        })

        it("is the client's company's for the Super Admin too", async () => {
            expect((await accountants.accountantCandidates(superAdmin, "theirs")).people).toEqual([{ id: "a2", name: "Adel Two" }])
        })

        it("is asked only by whoever may manage clients, of their own company's client", async () => {
            await expect(accountants.accountantCandidates(leader, "noor")).rejects.toThrow("CLIENTS_MANAGE_REQUIRED")
            await expect(accountants.accountantCandidates(admin, "theirs")).rejects.toThrow("CLIENT_NOT_FOUND")
            await expect(accountants.accountantCandidates(otherAdmin, "noor")).rejects.toThrow("CLIENT_NOT_FOUND")
            await expect(accountants.accountantCandidates(admin, "nobody")).rejects.toThrow("CLIENT_NOT_FOUND")
            await expect(accountants.accountantCandidates(admin, null)).rejects.toThrow("ACCOUNTANT_CLIENT_REQUIRED")
        })
    })

    describe("picking one", () => {
        it("keeps them, says who the client's people can write to, and writes the audit log", async () => {
            expect(await set(admin, "noor", "t1")).toEqual({
                person: { id: "t1", name: "Tamer One", role: "TEAM_LEADER", whatsappNumber: "+201001234567", ended: false },
                reach: "whatsapp",
            })
            expect(await kept("noor")).toBe("t1")
            expect(await logged("noor")).toEqual([{
                action: "SET_CLIENT_ACCOUNTANT", entityType: "VENDOR", userId: "a1", superAdminId: null,
                details: { name: "Al Noor", accountant: { from: null, to: "Tamer One" } },
            }])
        })

        it("changes them, saying who it was", async () => {
            expect(await set(admin, "noor", "e1")).toEqual({
                person: { id: "e1", name: "Eman One", role: "EMPLOYEE", whatsappNumber: null, ended: false },
                reach: "no_number",
            })
            expect((await logged("noor")).slice(-1)[0].details).toEqual({ name: "Al Noor", accountant: { from: "Tamer One", to: "Eman One" } })
        })

        it("writes nothing where the pick is who's kept already", async () => {
            const before = await everything()
            expect((await set(admin, "noor", "e1")).person?.id).toBe("e1")
            expect(await everything()).toEqual(before)
        })

        it("takes them away with no one", async () => {
            expect(await set(admin, "noor", null)).toEqual({ person: null, reach: "none" })
            expect(await kept("noor")).toBeNull()
            expect((await logged("noor")).slice(-1)[0].details).toEqual({ name: "Al Noor", accountant: { from: "Eman One", to: null } })
        })

        it("is the Super Admin's on any company's client", async () => {
            expect((await set(superAdmin, "theirs", "a2")).person?.id).toBe("a2")
            expect((await logged("theirs")).slice(-1)[0]).toMatchObject({ userId: null, superAdminId: "sa" })
        })
    })

    describe("what's refused, writing nothing", () => {
        it("one whose contract has ended, or who was deleted", async () => {
            const before = await everything()
            await expect(set(admin, "delta", "gone")).rejects.toThrow("ACCOUNTANT_CONTRACT_ENDED")
            await expect(set(admin, "delta", "del")).rejects.toThrow("ACCOUNTANT_CONTRACT_ENDED")
            expect(await everything()).toEqual(before)
        })

        it("anyone not of the client's company", async () => {
            const before = await everything()
            await expect(set(admin, "delta", "a2")).rejects.toThrow("ACCOUNTANT_NOT_IN_COMPANY")
            await expect(set(admin, "delta", "nobody")).rejects.toThrow("ACCOUNTANT_NOT_IN_COMPANY")
            expect(await everything()).toEqual(before)
        })

        it("an archived client, and another company's", async () => {
            const before = await everything()
            await expect(set(admin, "old", "t1")).rejects.toThrow("CLIENT_ARCHIVED")
            await expect(set(admin, "theirs", "t1")).rejects.toThrow("CLIENT_NOT_FOUND")
            await expect(set(otherAdmin, "delta", "a2")).rejects.toThrow("CLIENT_NOT_FOUND")
            expect(await everything()).toEqual(before)
        })

        it("whoever may not manage clients, and what isn't a pick", async () => {
            const before = await everything()
            await expect(set(leader, "delta", "t1")).rejects.toThrow("CLIENTS_MANAGE_REQUIRED")
            await expect(accountants.setClientAccountant(admin, { clientId: "delta", userId: 5 })).rejects.toThrow("ACCOUNTANT_PERSON_INVALID")
            await expect(accountants.setClientAccountant(admin, { clientId: "delta" })).rejects.toThrow("ACCOUNTANT_PERSON_INVALID")
            await expect(accountants.setClientAccountant(admin, { userId: "t1" })).rejects.toThrow("ACCOUNTANT_CLIENT_REQUIRED")
            await expect(accountants.setClientAccountant(admin, null)).rejects.toThrow("ACCOUNTANT_CLIENT_REQUIRED")
            expect(await everything()).toEqual(before)
        })
    })

    describe("when their contract ends", () => {
        it("they stay picked, and the client's people can't write to them until another is", async () => {
            await set(admin, "delta", "t1")
            await db.query(`UPDATE "User" SET status = 'ARCHIVED' WHERE id = 't1'`)
            try {
                expect(await accountants.accountantOf("delta")).toEqual({
                    person: { id: "t1", name: "Tamer One", role: "TEAM_LEADER", whatsappNumber: "+201001234567", ended: true },
                    reach: "ended",
                })
                expect(await kept("delta")).toBe("t1")
                // And they're no longer among who may be picked.
                expect((await accountants.accountantCandidates(admin, "delta")).people.map(p => p.id)).not.toContain("t1")
            } finally {
                await db.query(`UPDATE "User" SET status = 'OFFLINE' WHERE id = 't1'`)
            }
        })
    })

    describe("on the Tax position", () => {
        it("comes with the client's tax position", async () => {
            const tax = await import("@/lib/services/tax-claim.service")
            expect((await tax.taxPositionOf(admin, "delta", FIVE)).accountant).toEqual({
                person: { id: "t1", name: "Tamer One", role: "TEAM_LEADER", whatsappNumber: "+201001234567", ended: false },
                reach: "whatsapp",
            })
            expect((await tax.taxPositionOf(admin, "noor", FIVE)).accountant).toEqual({ person: null, reach: "none" })
        })
    })

    describe("the clients a person answers for", () => {
        it("are named, by name, an archived client left out", async () => {
            await db.query(`UPDATE "Client" SET "responsibleAccountantId" = 't1' WHERE id IN ('noor', 'old')`)
            expect(await accountants.clientsAnsweredFor("t1")).toEqual(["Al Noor", "Delta Foods"])
            expect(await accountants.clientsAnsweredFor("e1")).toEqual([])
        })
    })
})

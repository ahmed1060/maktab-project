import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { readFileSync, readdirSync } from "node:fs"
import { Client } from "pg"
import { withGrants } from "@/lib/permissions/test-actors"

/**
 * Client accounts as they're kept (CLIENT_PORTAL_PLAN.md §5.1, §5.2, §15;
 * PR 322), against a real Postgres: one email to one account across the
 * company's people, Super Admins and client accounts, and adding, listing
 * and removing a client's people.
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
 ('t1', 'Tamer@X.co', 'p', 'Tamer', 'One', 'TEAM_LEADER', 2026, 't1', 'c1', NULL),
 ('a2', 'a2@x.co', 'p', 'Adel', 'Two', 'ADMIN', 2026, 'a2', 'c2', NULL);
`
// Al Noor and Delta are in use; Old Mill is archived, with one person from
// before; Crowd has 20 people already; Their client is another company's.
const CLIENTS = `
INSERT INTO "SuperAdmin"(id, email, password, "firstName", "lastName", username, "updatedAt") VALUES ('sa', 'Sam@Nizmo.co', 'p', 'Sam', 'Admin', 'sa', now());
INSERT INTO "Client"(id, "companyId", name, "ownerName", "mobileNumber", "locationName", "updatedAt", "archivedAt") VALUES
 ('noor', 'c1', 'Al Noor', 'Omar', '0100', 'Cairo', now(), NULL),
 ('delta', 'c1', 'Delta Foods', 'Dina', '0102', 'Giza', now(), NULL),
 ('gone', 'c1', 'Going', 'Gamal', '0103', 'Giza', now(), NULL),
 ('crowd', 'c1', 'Crowd', 'Karim', '0104', 'Giza', now(), NULL),
 ('old', 'c1', 'Old Mill', 'Ola', '0107', 'Giza', now(), now()),
 ('theirs', 'c2', 'Their client', 'Tarek', '0108', 'Tokyo', now(), NULL);
INSERT INTO "ClientAccount"(id, "companyId", "clientId", name, email, "invitedAt", "updatedAt") VALUES
 ('old-1', 'c1', 'old', 'Ola Old', 'ola@old.co', '2026-10-01T08:00:00Z', now()),
 ('their-1', 'c2', 'theirs', 'Tarek Two', 'tarek@theirs.co', '2026-10-02T08:00:00Z', now());
INSERT INTO "ClientAccount"(id, "companyId", "clientId", name, email, "updatedAt")
 SELECT 'crowd-' || n, 'c1', 'crowd', 'Person ' || n, 'p' || n || '@crowd.co', now() FROM generate_series(1, 20) n;
`
const NOW = new Date("2026-11-19T07:00:00Z")

const admin = withGrants({ id: "a1", role: "ADMIN", companyId: "c1", name: "Amal One" }) as any
const leader = withGrants({ id: "t1", role: "TEAM_LEADER", companyId: "c1", name: "Tamer One" }) as any
const otherAdmin = withGrants({ id: "a2", role: "ADMIN", companyId: "c2", name: "Adel Two" }) as any
const superAdmin = { id: "sa", role: "SUPER_ADMIN", companyId: null, name: "Sam Admin" } as any

describe.skipIf(!ADMIN_URL)("client accounts, in Postgres", () => {
    const dbName = `client_accounts_test_${Date.now()}`
    let db: Client
    let accounts: typeof import("@/lib/services/client-account.service")
    let emails: typeof import("@/lib/account-email")
    let prisma: typeof import("@/lib/prisma").prisma

    const rows = async (clientId: string) => (await db.query(`
        SELECT id, name, email, "companyId", password, "activatedAt", "lastSignInAt", "addedById", "addedByName", "sessionVersion",
               to_char("invitedAt" AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI') AS "invitedAt"
        FROM "ClientAccount" WHERE "clientId" = $1 ORDER BY "createdAt", id`, [clientId])).rows
    const logged = async (clientId: string) => (await db.query(`SELECT action, "entityType", details, "userId", "superAdminId" FROM "AuditLog" WHERE "entityId" = $1 ORDER BY "createdAt"`, [clientId])).rows
    const everything = async () => (await db.query(`SELECT (SELECT count(*) FROM "ClientAccount")::int AS accounts, (SELECT count(*) FROM "AuditLog")::int AS logged`)).rows[0]
    const person = (clientId: string, name: string, email: string) => ({ clientId, name, email })
    /** What the database refused a statement with. */
    const refused = (statement: string, values: unknown[] = []) => db.query(statement, values).then(() => "saved", (error: { code?: string; constraint?: string }) => `${error.code} ${error.constraint}`)
    const insertAccount = (id: string, email: string, more = "") => `INSERT INTO "ClientAccount"(id, "companyId", "clientId", name, email, "updatedAt"${more ? ", " + more.split("=")[0] : ""}) VALUES ('${id}', 'c1', 'noor', 'N', '${email}', now()${more ? ", " + more.split("=")[1] : ""})`
    /**
     * What `act` comes to while somebody else's save, on a connection of its
     * own, isn't finished yet: what two saves at once look like, without
     * depending on timing.
     */
    const savingElsewhere = async (statement: string, act: () => Promise<unknown>) => {
        const other = new Client({ connectionString: process.env.POSTGRES_PRISMA_URL })
        await other.connect()
        try {
            await other.query("BEGIN")
            await other.query(statement)
            const acting = act().then(() => "saved", (error: { code?: string; message: string }) => error.code ?? error.message)
            await new Promise(resolve => setTimeout(resolve, 500))
            await other.query("COMMIT")
            return await acting
        } finally {
            await other.end()
        }
    }
    const insertPerson = (id: string, email: string) => `INSERT INTO "User"(id, email, password, "firstName", "lastName", role, "lastDayOffResetYear", username, "companyId", "roleId")
        SELECT '${id}', '${email}', 'p', 'X', 'Y', 'EMPLOYEE', 2026, '${id}', 'c1', id FROM "Role" WHERE "companyId" = 'c1' AND "builtIn" = 'EMPLOYEE'`

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
        accounts = await import("@/lib/services/client-account.service")
        emails = await import("@/lib/account-email")
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

    describe("the table", () => {
        it("has Row Level Security on", async () => {
            expect((await db.query(`SELECT relrowsecurity FROM pg_class WHERE relname = 'ClientAccount'`)).rows[0].relrowsecurity).toBe(true)
        })

        it("keeps an email trimmed and in small letters, and an account with a name", async () => {
            expect(await refused(insertAccount("bad-1", "Mona@x.co"))).toBe("23514 ClientAccount_email_kept")
            expect(await refused(insertAccount("bad-2", " mona@x.co"))).toBe("23514 ClientAccount_email_kept")
            expect(await refused(insertAccount("bad-3", "mona"))).toBe("23514 ClientAccount_email_kept")
            expect(await refused(`INSERT INTO "ClientAccount"(id, "companyId", "clientId", name, email, "updatedAt") VALUES ('bad-4', 'c1', 'noor', '  ', 'blank@x.co', now())`)).toBe("23514 ClientAccount_named")
        })

        it("has an account active only once it has a password", async () => {
            expect(await refused(insertAccount("bad-5", "half@x.co", `"activatedAt"=now()`))).toBe("23514 ClientAccount_active_with_password")
            expect(await refused(insertAccount("bad-6", "half@x.co", `password='hash'`))).toBe("23514 ClientAccount_active_with_password")
        })

        it("goes with its client", async () => {
            await db.query(insertAccount("gone-1", "g1@gone.co").replace("'noor'", "'gone'"))
            await db.query(`DELETE FROM "Client" WHERE id = 'gone'`)
            expect(await rows("gone")).toEqual([])
        })
    })

    describe("one email, one account", () => {
        it("is one client account's", async () => {
            expect(await refused(insertAccount("dup-1", "ola@old.co"))).toBe("23505 ClientAccount_email_key")
        })

        it("is refused a client account where one of the company's people has it, capitals aside", async () => {
            expect(await refused(insertAccount("dup-2", "a1@x.co"))).toBe("23505 email_once_across_accounts")
            expect(await refused(insertAccount("dup-3", "tamer@x.co"))).toBe("23505 email_once_across_accounts")
        })

        it("is refused a client account where a Super Admin has it, capitals aside", async () => {
            expect(await refused(insertAccount("dup-4", "sam@nizmo.co"))).toBe("23505 email_once_across_accounts")
        })

        it("is refused a person or a Super Admin where a client account has it, added or changed, capitals aside", async () => {
            expect(await refused(insertPerson("p-new", "Ola@Old.co"))).toBe("23505 email_once_across_accounts")
            expect(await refused(`UPDATE "User" SET email = 'OLA@old.co' WHERE id = 't1'`)).toBe("23505 email_once_across_accounts")
            expect(await refused(`UPDATE "SuperAdmin" SET email = 'ola@OLD.co' WHERE id = 'sa'`)).toBe("23505 email_once_across_accounts")
            expect(await refused(`INSERT INTO "SuperAdmin"(id, email, password, "firstName", "lastName", username, "updatedAt") VALUES ('sa-2', 'tarek@theirs.co', 'p', 'S', 'T', 'sa2', now())`)).toBe("23505 email_once_across_accounts")
            // Nothing else about a person is held up: another column saves, and so does an email nobody has.
            expect(await refused(`UPDATE "User" SET "firstName" = 'Tamer' WHERE id = 't1'`)).toBe("saved")
            expect(await refused(`UPDATE "User" SET email = 'Tamer@X.co' WHERE id = 't1'`)).toBe("saved")
        })

        it("says whether a client account has an email, capitals aside", async () => {
            expect(await emails.clientAccountHasEmail("ola@old.co")).toBe(true)
            expect(await emails.clientAccountHasEmail(" OLA@Old.co ")).toBe(true)
            expect(await emails.clientAccountHasEmail("nobody@old.co")).toBe(false)
            expect(await emails.clientAccountHasEmail("a1@x.co")).toBe(false)
        })

        it("is said to whoever adds one of the company's people, or a Super Admin, with a client account's email", async () => {
            const { UserService } = await import("@/lib/services/user.service")
            const { SuperAdminService } = await import("@/lib/services/super-admin.service")
            const hire = { firstName: "New", lastName: "Hire", email: "Ola@Old.co", password: "a-long-password-123", role: "EMPLOYEE" }
            await expect(UserService.create(hire as any, { user: admin } as any)).rejects.toThrow("USER_ALREADY_EXISTS")
            // The Super Admins page answers a unique clash as Email already exists.
            const refusal: any = await SuperAdminService.create({ firstName: "New", lastName: "Admin", email: "OLA@old.co", password: "a-long-password-123" } as any, { user: superAdmin } as any).then(() => null, e => e)
            expect(refusal?.code).toBe("P2002")
            const holders = await db.query(`SELECT count(*)::int AS n FROM (SELECT email FROM "User" UNION ALL SELECT email FROM "SuperAdmin") e WHERE lower(email) = 'ola@old.co'`)
            expect(holders.rows[0].n).toBe(0)
        })

        it("is answered as any email in use is, where a person's save meets a client account's", async () => {
            const error: any = await prisma.user.update({ where: { id: "t1" }, data: { email: "ola@old.co" } }).then(() => null, e => e)
            // What UserService.update, the Super Admins page and Security settings look for.
            expect(error?.code).toBe("P2002")
            expect(JSON.stringify(error?.meta ?? {})).toMatch(/email/i)
        })

        // Another account given the email in a save not yet finished, in
        // another table: what a check before the save can't see, and no
        // table's own index can either.
        it("never gives a person and a client account the same email, even saved at the same moment", async () => {
            expect(await savingElsewhere(insertPerson("race-1", "Race.One@x.co"), () => accounts.addClientPerson(admin, person("noor", "Race One", "race.one@x.co"), NOW))).toBe("CLIENT_PERSON_EMAIL_IN_USE")
            expect(await savingElsewhere(insertAccount("race-2", "race.two@x.co"), () => db.query(`UPDATE "User" SET email = 'Race.Two@x.co' WHERE id = 'a2'`))).toBe("23505")
            const holders = await db.query(`SELECT count(*)::int AS n FROM (SELECT email FROM "User" UNION ALL SELECT email FROM "SuperAdmin" UNION ALL SELECT email FROM "ClientAccount") e WHERE lower(email) IN ('race.one@x.co', 'race.two@x.co')`)
            expect(holders.rows[0].n).toBe(2)
            await db.query(`DELETE FROM "ClientAccount" WHERE id = 'race-2'`)
        })
    })

    describe("adding one of a client's people", () => {
        it("adds them as invited, with who added them, and gives them back as the list has them", async () => {
            const added = await accounts.addClientPerson(admin, person("noor", "  Mona   Fouad ", " Mona.Fouad@Example.com "), NOW)
            expect(added).toEqual({ id: expect.any(String), name: "Mona Fouad", email: "mona.fouad@example.com", state: "invited", invitedAt: "2026-11-19T07:00:00.000Z", lastSignInAt: null })
            expect(await rows("noor")).toEqual([{
                id: added.id, name: "Mona Fouad", email: "mona.fouad@example.com", companyId: "c1", password: null, activatedAt: null, lastSignInAt: null,
                addedById: "a1", addedByName: "Amal One", sessionVersion: 0, invitedAt: "2026-11-19T07:00",
            }])
        })

        it("writes it in the audit log, on the client, with the person's name and email", async () => {
            expect(await logged("noor")).toEqual([{
                action: "ADD_CLIENT_ACCOUNT", entityType: "VENDOR", userId: "a1", superAdminId: null,
                details: { name: "Al Noor", person: "Mona Fouad", email: "mona.fouad@example.com" },
            }])
        })

        it("is the Super Admin's to do for any company's client, kept by their name", async () => {
            const added = await accounts.addClientPerson(superAdmin, person("theirs", "Yara Two", "yara@theirs.co"), NOW)
            expect((await rows("theirs")).find(row => row.id === added.id)).toMatchObject({ companyId: "c2", addedById: null, addedByName: "Sam Admin" })
            expect((await logged("theirs")).map(entry => [entry.action, entry.userId, entry.superAdminId])).toEqual([["ADD_CLIENT_ACCOUNT", null, "sa"]])
        })

        it("is refused, with nothing saved, for whoever may not, and for another company's client", async () => {
            const before = await everything()
            await expect(accounts.addClientPerson(leader, person("noor", "Nour", "nour@x.co"), NOW)).rejects.toThrow("CLIENT_ACCOUNTS_MANAGE_REQUIRED")
            await expect(accounts.addClientPerson(otherAdmin, person("noor", "Nour", "nour@x.co"), NOW)).rejects.toThrow("CLIENT_NOT_FOUND")
            await expect(accounts.addClientPerson(admin, person("theirs", "Nour", "nour@x.co"), NOW)).rejects.toThrow("CLIENT_NOT_FOUND")
            await expect(accounts.addClientPerson(admin, person("nobody", "Nour", "nour@x.co"), NOW)).rejects.toThrow("CLIENT_NOT_FOUND")
            expect(await everything()).toEqual(before)
        })

        it("is refused for an archived client, whose people can't sign in", async () => {
            await expect(accounts.addClientPerson(admin, person("old", "Nour", "nour@x.co"), NOW)).rejects.toThrow("CLIENT_ARCHIVED")
            expect((await rows("old")).map(row => row.id)).toEqual(["old-1"])
        })

        it("is refused where what's sent isn't a person: no client, no name or one too long, no email", async () => {
            const before = await everything()
            await expect(accounts.addClientPerson(admin, { name: "Nour", email: "nour@x.co" }, NOW)).rejects.toThrow("CLIENT_PERSON_CLIENT_REQUIRED")
            await expect(accounts.addClientPerson(admin, person("noor", "  ", "nour@x.co"), NOW)).rejects.toThrow("CLIENT_PERSON_NAME_REQUIRED")
            await expect(accounts.addClientPerson(admin, person("noor", "n".repeat(101), "nour@x.co"), NOW)).rejects.toThrow("CLIENT_PERSON_NAME_TOO_LONG")
            await expect(accounts.addClientPerson(admin, person("noor", "Nour", "nour"), NOW)).rejects.toThrow("CLIENT_PERSON_EMAIL_INVALID")
            expect(await everything()).toEqual(before)
        })

        it("is refused an email someone has: a person, a Super Admin, or anyone's client account, capitals aside", async () => {
            const before = await everything()
            for (const email of ["A1@x.co", "tamer@x.co", "sam@nizmo.co", "Mona.Fouad@example.com", "OLA@old.co", "tarek@theirs.co"]) {
                await expect(accounts.addClientPerson(admin, person("delta", "Nour", email), NOW), email).rejects.toThrow("CLIENT_PERSON_EMAIL_IN_USE")
            }
            expect(await everything()).toEqual(before)
        })

        it("is refused for a client that has 20 people already", async () => {
            await expect(accounts.addClientPerson(admin, person("crowd", "One More", "more@crowd.co"), NOW)).rejects.toThrow("CLIENT_PEOPLE_FULL")
            expect(await rows("crowd")).toHaveLength(20)
        })

        it("holds the client while it counts, so two added at once can't pass 20 together", async () => {
            await db.query(`DELETE FROM "ClientAccount" WHERE id = 'crowd-20'`)
            // Somebody else's add, not yet finished: it holds the client, and its person is the twentieth.
            const theirs = `SELECT 1 FROM "Client" WHERE id = 'crowd' FOR UPDATE; ${insertAccount("crowd-20b", "p20b@crowd.co").replace("'noor'", "'crowd'")}`
            expect(await savingElsewhere(theirs, () => accounts.addClientPerson(admin, person("crowd", "One More", "more@crowd.co"), NOW))).toBe("CLIENT_PEOPLE_FULL")
            expect(await rows("crowd")).toHaveLength(20)
        })
    })

    describe("a client's people, listed", () => {
        it("are each given by name, email, whether invited or active, and when, in the order they were added", async () => {
            await accounts.addClientPerson(admin, person("delta", "Dalia Delta", "dalia@delta.co"), new Date("2026-11-10T09:00:00Z"))
            const active = await accounts.addClientPerson(admin, person("delta", "Bassem Delta", "bassem@delta.co"), new Date("2026-11-12T09:00:00Z"))
            await db.query(`UPDATE "ClientAccount" SET password = 'hash', "activatedAt" = '2026-11-13T10:00:00Z', "lastSignInAt" = '2026-11-18T16:30:00Z', "inviteTokenHash" = NULL, "inviteExpiresAt" = NULL WHERE id = $1`, [active.id])
            expect(await accounts.clientPeople(admin, "delta")).toEqual({
                client: { id: "delta", name: "Delta Foods", archived: false },
                max: 20,
                people: [
                    { id: expect.any(String), name: "Dalia Delta", email: "dalia@delta.co", state: "invited", invitedAt: "2026-11-10T09:00:00.000Z", lastSignInAt: null },
                    { id: active.id, name: "Bassem Delta", email: "bassem@delta.co", state: "active", invitedAt: "2026-11-12T09:00:00.000Z", lastSignInAt: "2026-11-18T16:30:00.000Z" },
                ],
            })
        })

        it("never give a password, or anything else that's kept", async () => {
            const listed = await accounts.clientPeople(admin, "delta")
            for (const one of listed.people) expect(Object.keys(one).sort()).toEqual(["email", "id", "invitedAt", "lastSignInAt", "name", "state"])
        })

        it("are an archived client's too, said to be archived, and nobody for a client with none", async () => {
            expect(await accounts.clientPeople(admin, "old")).toMatchObject({ client: { id: "old", archived: true }, people: [{ id: "old-1", state: "invited" }] })
            await db.query(`INSERT INTO "Client"(id, "companyId", name, "ownerName", "mobileNumber", "locationName", "updatedAt") VALUES ('empty', 'c1', 'Empty', 'E', '0109', 'Giza', now())`)
            expect(await accounts.clientPeople(admin, "empty")).toEqual({ client: { id: "empty", name: "Empty", archived: false }, max: 20, people: [] })
        })

        it("are the Super Admin's to see for any company, and nobody else's outside their own", async () => {
            expect((await accounts.clientPeople(superAdmin, "theirs")).people.map(one => one.email)).toEqual(["tarek@theirs.co", "yara@theirs.co"])
            await expect(accounts.clientPeople(admin, "theirs")).rejects.toThrow("CLIENT_NOT_FOUND")
            await expect(accounts.clientPeople(otherAdmin, "delta")).rejects.toThrow("CLIENT_NOT_FOUND")
            await expect(accounts.clientPeople(leader, "delta")).rejects.toThrow("CLIENT_ACCOUNTS_MANAGE_REQUIRED")
            await expect(accounts.clientPeople(admin, null)).rejects.toThrow("CLIENT_PERSON_CLIENT_REQUIRED")
            await expect(accounts.clientPeople(admin, "no such client")).rejects.toThrow("CLIENT_NOT_FOUND")
        })
    })

    describe("removing one of a client's people", () => {
        it("takes their account away, leaves the others, and says so in the audit log", async () => {
            const [dalia, bassem] = (await accounts.clientPeople(admin, "delta")).people
            expect(await accounts.removeClientPerson(admin, dalia.id)).toEqual({ removed: true })
            expect((await rows("delta")).map(row => row.id)).toEqual([bassem.id])
            expect((await logged("delta")).slice(-1)).toEqual([{
                action: "REMOVE_CLIENT_ACCOUNT", entityType: "VENDOR", userId: "a1", superAdminId: null,
                details: { name: "Delta Foods", person: "Dalia Delta", email: "dalia@delta.co" },
            }])
            // Their email is free again.
            expect(await emails.clientAccountHasEmail("dalia@delta.co")).toBe(false)
        })

        it("is refused, with nobody removed, for whoever may not, for another company's person, and for nobody's", async () => {
            const before = await everything()
            const [bassem] = (await accounts.clientPeople(admin, "delta")).people
            await expect(accounts.removeClientPerson(leader, bassem.id)).rejects.toThrow("CLIENT_ACCOUNTS_MANAGE_REQUIRED")
            await expect(accounts.removeClientPerson(otherAdmin, bassem.id)).rejects.toThrow("CLIENT_PERSON_NOT_FOUND")
            await expect(accounts.removeClientPerson(admin, "their-1")).rejects.toThrow("CLIENT_PERSON_NOT_FOUND")
            await expect(accounts.removeClientPerson(admin, "nobody")).rejects.toThrow("CLIENT_PERSON_NOT_FOUND")
            await expect(accounts.removeClientPerson(admin, "no such person")).rejects.toThrow("CLIENT_PERSON_NOT_FOUND")
            expect(await everything()).toEqual(before)
        })

        it("works for an archived client's person, and for the Super Admin on any company's", async () => {
            expect(await accounts.removeClientPerson(admin, "old-1")).toEqual({ removed: true })
            expect(await rows("old")).toEqual([])
            expect(await accounts.removeClientPerson(superAdmin, "their-1")).toEqual({ removed: true })
            expect((await logged("theirs")).slice(-1)[0]).toMatchObject({ action: "REMOVE_CLIENT_ACCOUNT", userId: null, superAdminId: "sa" })
        })

        it("says there's nobody to remove where they were removed a moment before", async () => {
            const [bassem] = (await accounts.clientPeople(admin, "delta")).people
            const both = await Promise.all([0, 1].map(() => accounts.removeClientPerson(admin, bassem.id).then(() => "removed", (error: Error) => error.message)))
            expect(both.sort()).toEqual(["CLIENT_PERSON_NOT_FOUND", "removed"])
            expect((await logged("delta")).filter(entry => entry.action === "REMOVE_CLIENT_ACCOUNT" && entry.details.email === "bassem@delta.co")).toHaveLength(1)
        })
    })
})

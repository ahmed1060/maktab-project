import { describe, it, expect, beforeAll, afterAll, vi } from "vitest"
import { readFileSync, readdirSync } from "node:fs"
import { Client } from "pg"
import bcrypt from "bcryptjs"
import { withGrants } from "@/lib/permissions/test-actors"
import { newInvitation } from "@/lib/client-invitation"

// Adding a person emails them (PR 325): nothing here reaches a mail server.
vi.mock("@/lib/email", async importOriginal => ({
    ...(await importOriginal<typeof import("@/lib/email")>()),
    sendOfficeEmail: vi.fn(async () => "SENT"),
}))

/**
 * Setting a password from an invitation (CLIENT_PORTAL_PLAN.md §5.2, §15;
 * PR 324), against a real Postgres: each person added has a link for 72
 * hours, the link read, the password set once, and every link that can't be
 * used refused as it is.
 *
 * Needs a Postgres it may create databases on: set ROLES_TEST_DATABASE_URL to
 * its maintenance database. Skipped without it (CI has no database).
 */

const ADMIN_URL = process.env.ROLES_TEST_DATABASE_URL
const MIGRATIONS = readdirSync("prisma/migrations").filter(m => m !== "migration_lock.toml").sort((a, b) => (a === "0_init" ? -1 : b === "0_init" ? 1 : a.localeCompare(b)))
const sql = (name: string) => readFileSync(`prisma/migrations/${name}/migration.sql`, "utf8")

const PEOPLE = `
INSERT INTO "Company"(id, name, "updatedAt") VALUES ('c1', 'Al Amal Accounting', now()), ('c2', 'Old Office', now()), ('c3', 'Plain Office', now());
INSERT INTO "User"(id, email, password, "firstName", "lastName", role, "lastDayOffResetYear", username, "companyId", "teamLeaderId") VALUES
 ('a1', 'a1@x.co', 'p', 'Amal', 'One', 'ADMIN', 2026, 'a1', 'c1', NULL);
`
// Al Amal has the client portal; Old Office had it, but its trial ran out
// long ago; Plain Office's package hasn't it.
const OFFICES = `
INSERT INTO "Package"(id, name, "hasCompanyManagement", "hasClientPortal", "updatedAt") VALUES ('portal', 'Portal', true, true, now()), ('plain', 'Plain', true, false, now());
UPDATE "Company" SET "packageId" = 'portal' WHERE id IN ('c1', 'c2');
UPDATE "Company" SET "packageId" = 'plain' WHERE id = 'c3';
UPDATE "Company" SET "createdAt" = '2024-01-01T00:00:00Z', "trialPreset" = 'FOURTEEN_DAYS' WHERE id = 'c2';
INSERT INTO "Client"(id, "companyId", name, "ownerName", "mobileNumber", "locationName", "updatedAt", "archivedAt") VALUES
 ('noor', 'c1', 'Al Noor Trading', 'Omar', '0100', 'Cairo', now(), NULL),
 ('old', 'c1', 'Old Mill', 'Ola', '0107', 'Giza', now(), now()),
 ('late', 'c2', 'Late Client', 'Lina', '0108', 'Giza', now(), NULL),
 ('plain', 'c3', 'Plain Client', 'Pia', '0109', 'Giza', now(), NULL);
`
const NOW = new Date("2026-11-19T09:00:00Z")
const HOUR = 3600_000
const PASSWORD = "a-long-password-1"
const admin = withGrants({ id: "a1", role: "ADMIN", companyId: "c1", name: "Amal One" }) as any

describe.skipIf(!ADMIN_URL)("setting a password from an invitation, in Postgres", () => {
    const dbName = `client_invitation_test_${Date.now()}`
    let db: Client
    let invitations: typeof import("@/lib/services/client-invitation.service")
    let accounts: typeof import("@/lib/services/client-account.service")
    let prisma: typeof import("@/lib/prisma").prisma
    let testUrl = ""

    let n = 0
    /** One of a client's people, invited with a link this test holds, as 6b-2's email will. */
    const invited = async (clientId: string, companyId = "c1", made = NOW) => {
        n += 1
        const link = newInvitation(made)
        const id = `acct-${n}`
        await db.query(`INSERT INTO "ClientAccount"(id, "companyId", "clientId", name, email, "invitedAt", "inviteTokenHash", "inviteExpiresAt", "updatedAt") VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now())`,
            [id, companyId, clientId, `Person ${n}`, `person${n}@client.co`, made, link.tokenHash, link.expiresAt])
        return { id, token: link.token, email: `person${n}@client.co`, name: `Person ${n}` }
    }
    const row = async (id: string) => (await db.query(`SELECT password, "activatedAt", "inviteTokenHash", "inviteExpiresAt", "sessionVersion" FROM "ClientAccount" WHERE id = $1`, [id])).rows[0]
    const logged = async (clientId: string) => (await db.query(`SELECT action, "entityType", details, "userId", "superAdminId" FROM "AuditLog" WHERE "entityId" = $1 AND action = 'ACCEPT_CLIENT_INVITATION' ORDER BY "createdAt"`, [clientId])).rows
    const set = (token: string, password = PASSWORD, confirmPassword = password, now = NOW) => invitations.setInvitationPassword({ token, password, confirmPassword }, now)
    const why = (p: Promise<unknown>) => p.then(() => "set", (error: Error) => error.message)

    beforeAll(async () => {
        const a = new Client({ connectionString: ADMIN_URL })
        await a.connect()
        await a.query(`CREATE DATABASE ${dbName}`)
        await a.end()
        const url = new URL(ADMIN_URL!)
        url.pathname = `/${dbName}`
        testUrl = url.toString()
        db = new Client({ connectionString: testUrl })
        await db.connect()
        for (const m of MIGRATIONS) {
            await db.query(sql(m))
            if (m === "20260920000000_team_leader") await db.query(PEOPLE)
        }
        await db.query(OFFICES)
        process.env.POSTGRES_PRISMA_URL = url.toString()
        invitations = await import("@/lib/services/client-invitation.service")
        accounts = await import("@/lib/services/client-account.service")
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

    describe("each person added", () => {
        it("has a link for 72 hours, kept only as its hash", async () => {
            const added = await accounts.addClientPerson(admin, { clientId: "noor", name: "Mona Fouad", email: "mona@client.co" }, NOW)
            const kept = await row(added.id)
            expect(kept.inviteTokenHash).toMatch(/^[0-9a-f]{64}$/)
            expect(kept.inviteExpiresAt.toISOString()).toBe("2026-11-22T09:00:00.000Z")
            expect(kept.password).toBeNull()
            // Nothing given back holds the link.
            expect(JSON.stringify(added)).not.toMatch(/inviteToken|inviteExpires|token|hash/i)
        })

        it("and the database holds a link whole, and none on an active account", async () => {
            const { id } = await invited("noor")
            const refused = (statement: string) => db.query(statement).then(() => "saved", (e: { constraint?: string }) => e.constraint)
            expect(await refused(`UPDATE "ClientAccount" SET "inviteExpiresAt" = NULL WHERE id = '${id}'`)).toBe("ClientAccount_invitation_whole")
            expect(await refused(`UPDATE "ClientAccount" SET password = 'h', "activatedAt" = now() WHERE id = '${id}'`)).toBe("ClientAccount_active_not_invited")
        })
    })

    describe("reading a link", () => {
        it("says who invited them, for whom, their email and until when", async () => {
            const { token, email } = await invited("noor")
            expect(await invitations.readInvitation({ token }, NOW)).toEqual({
                office: "Al Amal Accounting", client: "Al Noor Trading", email, expiresAt: "2026-11-22T09:00:00.000Z", language: "ar",
            })
        })

        it("is refused for no link, one Nizmo never made, and one that ran out", async () => {
            const { token } = await invited("noor", "c1", new Date(NOW.getTime() - 73 * HOUR))
            expect(await why(invitations.readInvitation({}, NOW))).toBe("INVITATION_TOKEN_REQUIRED")
            expect(await why(invitations.readInvitation({ token: newInvitation(NOW).token }, NOW))).toBe("INVITATION_UNKNOWN")
            expect(await why(invitations.readInvitation({ token }, NOW))).toBe("INVITATION_EXPIRED")
        })

        it("works for 72 hours, and not a moment after", async () => {
            const { token } = await invited("noor")
            expect(await invitations.readInvitation({ token }, new Date(NOW.getTime() + 72 * HOUR - 1000))).toHaveProperty("email")
            expect(await why(invitations.readInvitation({ token }, new Date(NOW.getTime() + 72 * HOUR)))).toBe("INVITATION_EXPIRED")
        })

        it("is refused where the office's portal isn't open: the client archived, the subscription ended, the add-on gone", async () => {
            for (const [clientId, companyId] of [["old", "c1"], ["late", "c2"], ["plain", "c3"]]) {
                const { token } = await invited(clientId, companyId)
                expect(await why(invitations.readInvitation({ token }, NOW)), clientId).toBe("INVITATION_CLOSED")
            }
        })
    })

    describe("setting the password", () => {
        it("sets it, makes the account active, ends the link and anything signed in with it before, and gives back the email to sign in with", async () => {
            const { id, token, email } = await invited("noor")
            expect(await set(token)).toEqual({ email })
            const kept = await row(id)
            expect(await bcrypt.compare(PASSWORD, kept.password)).toBe(true)
            expect(kept.activatedAt.toISOString()).toBe(NOW.toISOString())
            expect(kept.inviteTokenHash).toBeNull()
            expect(kept.inviteExpiresAt).toBeNull()
            expect(kept.sessionVersion).toBe(1)
        })

        it("writes it in the audit log, on the client, by none of the company's people", async () => {
            const { id, token, email, name } = await invited("noor")
            await set(token)
            expect((await logged("noor")).slice(-1)).toEqual([{
                action: "ACCEPT_CLIENT_INVITATION", entityType: "VENDOR", userId: null, superAdminId: null,
                details: { name: "Al Noor Trading", person: name, email, account: id },
            }])
        })

        it("works once: the same link again doesn't work", async () => {
            const { token } = await invited("noor")
            await set(token)
            expect(await why(set(token, "another-password-2"))).toBe("INVITATION_UNKNOWN")
            expect(await why(invitations.readInvitation({ token }, NOW))).toBe("INVITATION_UNKNOWN")
        })

        it("works for 72 hours, and not a moment after", async () => {
            const { id, token } = await invited("noor")
            expect(await why(set(token, PASSWORD, PASSWORD, new Date(NOW.getTime() + 72 * HOUR)))).toBe("INVITATION_EXPIRED")
            expect((await row(id)).password).toBeNull()
            expect(await set(token, PASSWORD, PASSWORD, new Date(NOW.getTime() + 72 * HOUR - 1000))).toHaveProperty("email")
        })

        it("is refused, setting nothing, for a password too short, too long or not the same twice", async () => {
            const { id, token } = await invited("noor")
            expect(await why(set(token, "short-11-ch"))).toBe("INVITATION_PASSWORD_SHORT")
            expect(await why(set(token, "x".repeat(73)))).toBe("INVITATION_PASSWORD_LONG")
            expect(await why(set(token, PASSWORD, `${PASSWORD}!`))).toBe("INVITATION_PASSWORD_MISMATCH")
            expect((await row(id)).password).toBeNull()
            expect((await row(id)).inviteTokenHash).not.toBeNull()
        })

        it("is refused for a person removed since the link was sent", async () => {
            const { id, token } = await invited("noor")
            await accounts.removeClientPerson(admin, id)
            expect(await why(set(token))).toBe("INVITATION_UNKNOWN")
        })

        it("is refused where the office's portal isn't open, setting nothing", async () => {
            const { id, token } = await invited("late", "c2")
            expect(await why(set(token))).toBe("INVITATION_CLOSED")
            expect((await row(id)).password).toBeNull()
        })

        it("is refused where the client was archived after the link was read", async () => {
            await db.query(`INSERT INTO "Client"(id, "companyId", name, "ownerName", "mobileNumber", "locationName", "updatedAt") VALUES ('soon', 'c1', 'Soon Archived', 'S', '0110', 'Giza', now())`)
            const { token } = await invited("soon")
            expect(await invitations.readInvitation({ token }, NOW)).toHaveProperty("email")
            await db.query(`UPDATE "Client" SET "archivedAt" = now() WHERE id = 'soon'`)
            expect(await why(set(token))).toBe("INVITATION_CLOSED")
        })

        it("is refused where the client is archived while the password is being set", async () => {
            await db.query(`INSERT INTO "Client"(id, "companyId", name, "ownerName", "mobileNumber", "locationName", "updatedAt") VALUES ('midway', 'c1', 'Midway', 'M', '0111', 'Giza', now())`)
            const { id, token } = await invited("midway")
            // Archived by somebody else, not yet saved: the link still reads
            // as open, and setting it waits on the client's row.
            const other = new Client({ connectionString: testUrl })
            await other.connect()
            try {
                await other.query("BEGIN")
                await other.query(`UPDATE "Client" SET "archivedAt" = now() WHERE id = 'midway'`)
                const setting = why(set(token))
                for (let i = 0; i < 100; i += 1) {
                    const waiting = await db.query(`SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock'`)
                    if (waiting.rows[0].n > 0) break
                    await new Promise(resolve => setTimeout(resolve, 50))
                }
                await other.query("COMMIT")
                expect(await setting).toBe("INVITATION_CLOSED")
            } finally {
                await other.end()
            }
            expect((await row(id)).password).toBeNull()
        })

        it("is refused, and keeps no one waiting, where the client is deleted while the password is being set", async () => {
            // Found by Codex on PR 324: the account was held before its client,
            // and deleting a client holds the client, then its people go with
            // it, so each waited on the other and Postgres ended one.
            await db.query(`INSERT INTO "Client"(id, "companyId", name, "ownerName", "mobileNumber", "locationName", "updatedAt") VALUES ('going', 'c1', 'Going', 'G', '0112', 'Giza', now())`)
            const { id, token } = await invited("going")
            const other = new Client({ connectionString: testUrl })
            await other.connect()
            try {
                await other.query("BEGIN")
                await other.query(`SELECT id FROM "Client" WHERE id = 'going' FOR UPDATE`)
                const setting = why(set(token))
                for (let i = 0; i < 100; i += 1) {
                    const waiting = await db.query(`SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock'`)
                    if (waiting.rows[0].n > 0) break
                    await new Promise(resolve => setTimeout(resolve, 50))
                }
                // Its people go with it, as ClientService.delete deletes it.
                const deleted = await other.query(`DELETE FROM "Client" WHERE id = 'going'`).then(() => "deleted", (e: Error) => e.message)
                await other.query("COMMIT").catch(() => other.query("ROLLBACK"))
                expect(deleted).toBe("deleted")
                expect(await setting).toBe("INVITATION_UNKNOWN")
            } finally {
                await other.end()
            }
            expect((await db.query(`SELECT count(*)::int AS n FROM "ClientAccount" WHERE id = $1`, [id])).rows[0].n).toBe(0)
        }, 15_000)

        it("set twice at the same moment, sets it once: the other is told the link doesn't work", async () => {
            const { id, token } = await invited("noor")
            const both = await Promise.all([why(set(token, "first-password-1")), why(set(token, "second-password-2"))])
            expect(both.sort()).toEqual(["INVITATION_UNKNOWN", "set"])
            const kept = await row(id)
            const which = await bcrypt.compare("first-password-1", kept.password) ? 1 : await bcrypt.compare("second-password-2", kept.password) ? 2 : 0
            expect(which).toBeGreaterThan(0)
            expect(kept.sessionVersion).toBe(1)
        })

        it("only ever sets its own account's", async () => {
            const one = await invited("noor")
            const two = await invited("noor")
            await set(one.token)
            expect((await row(two.id)).password).toBeNull()
            expect((await row(two.id)).inviteTokenHash).not.toBeNull()
        })
    })
})

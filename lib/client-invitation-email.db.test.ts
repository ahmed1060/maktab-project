import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest"
import { readFileSync, readdirSync } from "node:fs"
import { Client } from "pg"
import { withGrants } from "@/lib/permissions/test-actors"
import { invitationHash } from "@/lib/client-invitation"

/**
 * The invitation's email, sent on Add person and on Resend invitation
 * (CLIENT_PORTAL_PLAN.md §5.2, §12 step 6b-2; PR 325), against a real
 * Postgres: in the language the person is invited in, from the office, with
 * a reply to whoever sent it, as the save ends. Nothing reaches a mail
 * server: what would be sent is kept here.
 *
 * Needs a Postgres it may create databases on: set ROLES_TEST_DATABASE_URL to
 * its maintenance database. Skipped without it (CI has no database).
 */

type Sent = { to: { name: string; address: string }; fromName: string; replyTo: { name: string; address: string } | null; subject: string; text: string; html: string }
const outbox = vi.hoisted(() => ({ sent: [] as Sent[], fail: false }))
vi.mock("@/lib/email", async importOriginal => ({
    ...(await importOriginal<typeof import("@/lib/email")>()),
    sendOfficeEmail: vi.fn(async (message: Sent) => {
        if (outbox.fail) throw new Error("SMTP_DOWN")
        outbox.sent.push(message)
        return "SENT"
    }),
}))

const ADMIN_URL = process.env.ROLES_TEST_DATABASE_URL
const MIGRATIONS = readdirSync("prisma/migrations").filter(m => m !== "migration_lock.toml").sort((a, b) => (a === "0_init" ? -1 : b === "0_init" ? 1 : a.localeCompare(b)))
const sql = (name: string) => readFileSync(`prisma/migrations/${name}/migration.sql`, "utf8")

const PEOPLE = `
INSERT INTO "Company"(id, name, "updatedAt") VALUES ('c1', 'Al Amal Accounting', now()), ('c2', 'Other Office', now());
INSERT INTO "User"(id, email, password, "firstName", "lastName", role, "lastDayOffResetYear", username, "companyId", "teamLeaderId") VALUES
 ('a1', 'a1@x.co', 'p', 'Amal', 'One', 'ADMIN', 2026, 'a1', 'c1', NULL),
 ('t1', 't1@x.co', 'p', 'Tamer', 'One', 'TEAM_LEADER', 2026, 't1', 'c1', NULL),
 ('a2', 'a2@x.co', 'p', 'Adel', 'Two', 'ADMIN', 2026, 'a2', 'c2', NULL);
`
const OFFICES = `
INSERT INTO "SuperAdmin"(id, email, password, "firstName", "lastName", username, "updatedAt") VALUES ('sa', 'sam@nizmo.co', 'p', 'Sam', 'Admin', 'sa', now());
INSERT INTO "Package"(id, name, "hasCompanyManagement", "hasClientPortal", "updatedAt") VALUES ('portal', 'Portal', true, true, now());
UPDATE "Company" SET "packageId" = 'portal';
INSERT INTO "Client"(id, "companyId", name, "ownerName", "mobileNumber", "locationName", "updatedAt", "archivedAt") VALUES
 ('noor', 'c1', 'Al Noor Trading', 'Omar', '0100', 'Cairo', now(), NULL),
 ('old', 'c1', 'Old Mill', 'Ola', '0107', 'Giza', now(), now()),
 ('theirs', 'c2', 'Their Client', 'Tarek', '0108', 'Giza', now(), NULL);
`
const NOW = new Date("2026-11-19T09:00:00Z")
const HOUR = 3600_000
const ORIGIN = "https://nizmo.vercel.app"
const admin = withGrants({ id: "a1", role: "ADMIN", companyId: "c1", name: "Amal One" }) as any
const leader = withGrants({ id: "t1", role: "TEAM_LEADER", companyId: "c1", name: "Tamer One" }) as any
const otherAdmin = withGrants({ id: "a2", role: "ADMIN", companyId: "c2", name: "Adel Two" }) as any
const superAdmin = { id: "sa", role: "SUPER_ADMIN", companyId: null, name: "Sam Admin" } as any

/** The secret of the link an email carries. */
const linkIn = (message: Sent) => {
    const found = /\/invitation#([A-Za-z0-9_-]{43})/.exec(message.text)
    expect(found, "the email's link").not.toBeNull()
    expect(message.html).toContain(`href="${ORIGIN}/invitation#${found![1]}"`)
    return found![1]
}

describe.skipIf(!ADMIN_URL)("the invitation's email, in Postgres", () => {
    const dbName = `client_invitation_email_test_${Date.now()}`
    let db: Client
    let testUrl = ""
    let accounts: typeof import("@/lib/services/client-account.service")
    let invitations: typeof import("@/lib/services/client-invitation.service")
    let prisma: typeof import("@/lib/prisma").prisma

    let n = 0
    const nextEmail = () => `person${++n}@client.co`
    const add = (user: any, more: Record<string, unknown> = {}, now = NOW) => accounts.addClientPerson(user, { clientId: "noor", name: "Mona Fouad", email: nextEmail(), ...more }, now, ORIGIN)
    const resend = (user: any, id: string, now = NOW) => accounts.resendClientInvitation(user, id, now, ORIGIN)
    const row = async (id: string) => (await db.query(`SELECT language, "activatedAt", "inviteTokenHash", "inviteExpiresAt" FROM "ClientAccount" WHERE id = $1`, [id])).rows[0]
    const logged = async (action: string) => (await db.query(`SELECT action, "entityType", "entityId", details, "userId", "superAdminId" FROM "AuditLog" WHERE action = $1 ORDER BY "createdAt"`, [action])).rows
    const why = (p: Promise<unknown>) => p.then(() => "done", (error: Error) => error.message)

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
        process.env.POSTGRES_PRISMA_URL = testUrl
        accounts = await import("@/lib/services/client-account.service")
        invitations = await import("@/lib/services/client-invitation.service")
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

    beforeEach(() => {
        outbox.sent.length = 0
        outbox.fail = false
    })

    describe("adding one of a client's people", () => {
        it("emails them their link, in Arabic where no language is asked for, from the office, with a reply to whoever added them", async () => {
            const added = await add(admin, { email: "mona@client.co" })
            expect(outbox.sent).toHaveLength(1)
            const [message] = outbox.sent
            expect(message.to).toEqual({ name: "Mona Fouad", address: "mona@client.co" })
            expect(message.fromName).toBe("Al Amal Accounting")
            expect(message.replyTo).toEqual({ name: "Amal One", address: "a1@x.co" })
            expect(message.subject).toBe("دعوة لمتابعة الموقف الضريبي لـAl Noor Trading")
            expect(message.text).toContain("للاستفسار، يُرجى التواصل مع")
            expect(message.text).not.toContain("سابق")
            // The link that opens this person's invitation, and no one else's.
            expect(invitationHash(linkIn(message))).toBe((await row(added.id)).inviteTokenHash)
            expect((await row(added.id)).language).toBe("ar")
            expect(added.language).toBe("ar")
        })

        it("emails them in English where English is asked for, and the account keeps it", async () => {
            const added = await add(admin, { language: "en" })
            expect(outbox.sent[0].subject).toBe("Invitation to the tax position of Al Noor Trading")
            expect(outbox.sent[0].text).toContain("For any questions, please contact")
            expect(outbox.sent[0].text).not.toMatch(/[ء-ي]/)
            expect((await row(added.id)).language).toBe("en")
            const listed = await accounts.clientPeople(admin, "noor")
            expect(listed.people.find(p => p.id === added.id)?.language).toBe("en")
        })

        it("is refused a language Nizmo doesn't speak, with nothing saved or sent", async () => {
            const email = nextEmail()
            for (const language of ["fr", "AR", "", 1, null]) {
                expect(await why(accounts.addClientPerson(admin, { clientId: "noor", name: "Mona", email, language }, NOW, ORIGIN)), String(language)).toBe("CLIENT_PERSON_LANGUAGE_INVALID")
            }
            expect((await db.query(`SELECT count(*)::int AS n FROM "ClientAccount" WHERE email = $1`, [email])).rows[0].n).toBe(0)
            expect(outbox.sent).toHaveLength(0)
        })

        it("added by a Super Admin, has no reply address, and names the office alone", async () => {
            await add(superAdmin)
            expect(outbox.sent[0].fromName).toBe("Al Amal Accounting")
            expect(outbox.sent[0].replyTo).toBeNull()
            expect(outbox.sent[0].text).toMatch(/للاستفسار، يُرجى التواصل مع \S*Al Amal Accounting\S*\.$/m)
        })

        it("has a reply go to the email the person's account has now", async () => {
            await db.query(`UPDATE "User" SET email = 'amal.new@x.co', "firstName" = 'Amal N.' WHERE id = 'a1'`)
            try {
                await add(admin)
                expect(outbox.sent[0].replyTo).toEqual({ name: "Amal N. One", address: "amal.new@x.co" })
            } finally {
                await db.query(`UPDATE "User" SET email = 'a1@x.co', "firstName" = 'Amal' WHERE id = 'a1'`)
            }
        })

        it("that can't be sent saves nothing: no person, and nothing in the audit log", async () => {
            const before = (await logged("ADD_CLIENT_ACCOUNT")).length
            const email = nextEmail()
            outbox.fail = true
            expect(await why(accounts.addClientPerson(admin, { clientId: "noor", name: "Mona", email }, NOW, ORIGIN))).toBe("SMTP_DOWN")
            expect((await db.query(`SELECT count(*)::int AS n FROM "ClientAccount" WHERE email = $1`, [email])).rows[0].n).toBe(0)
            expect(await logged("ADD_CLIENT_ACCOUNT")).toHaveLength(before)
        })

        it("emails nobody where the person is refused", async () => {
            expect(await why(accounts.addClientPerson(admin, { clientId: "old", name: "Mona", email: nextEmail() }, NOW, ORIGIN))).toBe("CLIENT_ARCHIVED")
            expect(await why(accounts.addClientPerson(leader, { clientId: "noor", name: "Mona", email: nextEmail() }, NOW, ORIGIN))).toBe("CLIENT_ACCOUNTS_MANAGE_REQUIRED")
            expect(outbox.sent).toHaveLength(0)
        })
    })

    describe("the database", () => {
        it("keeps a language Nizmo speaks, and Arabic where none is given", async () => {
            await db.query(`INSERT INTO "ClientAccount"(id, "companyId", "clientId", name, email, "updatedAt") VALUES ('lang-1', 'c1', 'noor', 'L', 'lang1@client.co', now())`)
            expect((await row("lang-1")).language).toBe("ar")
            const refused = await db.query(`UPDATE "ClientAccount" SET language = 'fr' WHERE id = 'lang-1'`).then(() => "saved", (e: { constraint?: string }) => e.constraint)
            expect(refused).toBe("ClientAccount_language_known")
        })
    })

    describe("reading a link", () => {
        it("says the language the person was invited in, for the page to open in", async () => {
            await add(admin, { language: "en" })
            expect(await invitations.readInvitation({ token: linkIn(outbox.sent[0]) }, NOW)).toHaveProperty("language", "en")
        })
    })

    describe("sending an invitation again", () => {
        it("makes a new link, for 72 hours from now, and the earlier one stops working", async () => {
            const added = await add(admin)
            const first = linkIn(outbox.sent[0])
            const later = new Date(NOW.getTime() + 5 * HOUR)
            expect(await resend(admin, added.id, later)).toEqual({ resent: true })
            expect(outbox.sent).toHaveLength(2)
            const second = linkIn(outbox.sent[1])
            expect(second).not.toBe(first)
            expect(await why(invitations.readInvitation({ token: first }, later))).toBe("INVITATION_UNKNOWN")
            expect(await invitations.readInvitation({ token: second }, later)).toHaveProperty("expiresAt", new Date(later.getTime() + 72 * HOUR).toISOString())
            expect((await row(added.id)).inviteExpiresAt.toISOString()).toBe(new Date(later.getTime() + 72 * HOUR).toISOString())
        })

        it("says an earlier link no longer works, in the account's language, from the office, with a reply to whoever sent it again", async () => {
            const added = await add(superAdmin, { language: "en" })
            await resend(admin, added.id)
            const [, again] = outbox.sent
            expect(again.to.address).toBe(added.email)
            expect(again.subject).toBe("Invitation to the tax position of Al Noor Trading")
            expect(again.text).toContain("Any earlier invitation link no longer works.")
            expect(again.fromName).toBe("Al Amal Accounting")
            expect(again.replyTo).toEqual({ name: "Amal One", address: "a1@x.co" })
        })

        it("writes it in the audit log, on the client, with the person's name and email", async () => {
            const added = await add(admin)
            await resend(admin, added.id)
            expect((await logged("RESEND_CLIENT_INVITATION")).slice(-1)).toEqual([{
                action: "RESEND_CLIENT_INVITATION", entityType: "VENDOR", entityId: "noor", userId: "a1", superAdminId: null,
                details: { name: "Al Noor Trading", person: "Mona Fouad", email: added.email },
            }])
        })

        it("is the Super Admin's to do for any company's person, with no reply address", async () => {
            const theirs = await accounts.addClientPerson(otherAdmin, { clientId: "theirs", name: "Tarek", email: nextEmail() }, NOW, ORIGIN)
            await resend(superAdmin, theirs.id)
            expect(outbox.sent[1].fromName).toBe("Other Office")
            expect(outbox.sent[1].replyTo).toBeNull()
            expect((await logged("RESEND_CLIENT_INVITATION")).slice(-1)[0]).toMatchObject({ userId: null, superAdminId: "sa", entityId: "theirs" })
        })

        it("is refused, sending nothing and changing nothing, for someone who has set their password", async () => {
            const added = await add(admin)
            await invitations.setInvitationPassword({ token: linkIn(outbox.sent[0]), password: "a-long-password-1", confirmPassword: "a-long-password-1" }, NOW)
            outbox.sent.length = 0
            expect(await why(resend(admin, added.id))).toBe("CLIENT_PERSON_ACTIVE")
            expect(outbox.sent).toHaveLength(0)
            expect((await row(added.id)).inviteTokenHash).toBeNull()
        })

        it("is refused for whoever may not, for another company's person, and for nobody's", async () => {
            const added = await add(admin)
            const theirs = await accounts.addClientPerson(otherAdmin, { clientId: "theirs", name: "Tarek", email: nextEmail() }, NOW, ORIGIN)
            outbox.sent.length = 0
            expect(await why(resend(leader, added.id))).toBe("CLIENT_ACCOUNTS_MANAGE_REQUIRED")
            expect(await why(resend(admin, theirs.id))).toBe("CLIENT_PERSON_NOT_FOUND")
            for (const id of ["nobody", "", "x".repeat(65), "a'; DROP TABLE x"]) expect(await why(resend(admin, id)), id).toBe("CLIENT_PERSON_NOT_FOUND")
            expect(outbox.sent).toHaveLength(0)
        })

        it("is refused for an archived client's person, whose people can't sign in", async () => {
            await db.query(`INSERT INTO "ClientAccount"(id, "companyId", "clientId", name, email, "inviteTokenHash", "inviteExpiresAt", "updatedAt") VALUES ('old-1', 'c1', 'old', 'Ola', 'ola@old.co', repeat('0', 64), now(), now())`)
            expect(await why(resend(admin, "old-1"))).toBe("CLIENT_ARCHIVED")
            expect(outbox.sent).toHaveLength(0)
        })

        it("that can't be sent leaves the earlier link working, and writes nothing in the audit log", async () => {
            const added = await add(admin)
            const first = linkIn(outbox.sent[0])
            const before = (await logged("RESEND_CLIENT_INVITATION")).length
            outbox.fail = true
            expect(await why(resend(admin, added.id))).toBe("SMTP_DOWN")
            expect(await invitations.readInvitation({ token: first }, NOW)).toHaveProperty("email", added.email)
            expect(await logged("RESEND_CLIENT_INVITATION")).toHaveLength(before)
        })

        it("waits on a client held by another save, and is refused where it was archived meanwhile", async () => {
            await db.query(`INSERT INTO "Client"(id, "companyId", name, "ownerName", "mobileNumber", "locationName", "updatedAt") VALUES ('midway', 'c1', 'Midway', 'M', '0111', 'Giza', now())`)
            const added = await accounts.addClientPerson(admin, { clientId: "midway", name: "Mona", email: nextEmail() }, NOW, ORIGIN)
            outbox.sent.length = 0
            const other = new Client({ connectionString: testUrl })
            await other.connect()
            try {
                await other.query("BEGIN")
                await other.query(`UPDATE "Client" SET "archivedAt" = now() WHERE id = 'midway'`)
                const sending = why(resend(admin, added.id))
                for (let i = 0; i < 100; i += 1) {
                    const waiting = await db.query(`SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock'`)
                    if (waiting.rows[0].n > 0) break
                    await new Promise(resolve => setTimeout(resolve, 50))
                }
                await other.query("COMMIT")
                expect(await sending).toBe("CLIENT_ARCHIVED")
            } finally {
                await other.end()
            }
            expect(outbox.sent).toHaveLength(0)
        })
    })
})

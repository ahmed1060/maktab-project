import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest"
import { readFileSync, readdirSync } from "node:fs"
import { Client } from "pg"
import { withGrants } from "@/lib/permissions/test-actors"
import type { ClaimDraft } from "@/lib/tax-file"

/**
 * The update email, sent when an upload of the tax portal's file is saved
 * (CLIENT_PORTAL_PLAN.md §4.4, §12 step 11b; PR 351), against a real
 * Postgres: only with the company's switch on and the client portal in its
 * package; to each of the client's people who has set a password, in their
 * own language, from the office; at most once a day for a client, in the
 * company's time zone; after the save, which an email that fails leaves
 * saved. Nothing reaches a mail server: what would be sent is kept here.
 *
 * Needs a Postgres it may create databases on: set ROLES_TEST_DATABASE_URL to
 * its maintenance database. Skipped without it (CI has no database).
 */

type Sent = { to: { name: string; address: string }; fromName: string; replyTo: { name: string; address: string } | null; subject: string; text: string; html: string }
const outbox = vi.hoisted(() => ({ sent: [] as Sent[], failFor: new Set<string>(), sending: null as null | ((message: Sent) => Promise<void>) }))
vi.mock("@/lib/email", async importOriginal => ({
    ...(await importOriginal<typeof import("@/lib/email")>()),
    sendOfficeEmail: vi.fn(async (message: Sent) => {
        // What the database holds, seen from outside, while the email is on its way.
        if (outbox.sending) await outbox.sending(message)
        if (outbox.failFor.has(message.to.address)) throw new Error("SMTP_DOWN")
        outbox.sent.push(message)
        return "SENT"
    }),
}))

const ADMIN_URL = process.env.ROLES_TEST_DATABASE_URL
const MIGRATIONS = readdirSync("prisma/migrations").filter(m => m !== "migration_lock.toml").sort((a, b) => (a === "0_init" ? -1 : b === "0_init" ? 1 : a.localeCompare(b)))
const sql = (name: string) => readFileSync(`prisma/migrations/${name}/migration.sql`, "utf8")

const PEOPLE = `
INSERT INTO "Company"(id, name, "updatedAt") VALUES ('c1', 'Al Amal Accounting', now()), ('c2', 'Quiet Office', now()), ('c3', 'No Portal Office', now());
INSERT INTO "User"(id, email, password, "firstName", "lastName", role, "lastDayOffResetYear", username, "companyId", "teamLeaderId") VALUES
 ('a1', 'a1@x.co', 'p', 'Amal', 'One', 'ADMIN', 2026, 'a1', 'c1', NULL),
 ('a2', 'a2@x.co', 'p', 'Adel', 'Two', 'ADMIN', 2026, 'a2', 'c2', NULL),
 ('a3', 'a3@x.co', 'p', 'Aya', 'Three', 'ADMIN', 2026, 'a3', 'c3', NULL);
`
// Al Amal is in Cairo, with the client portal and the update email on.
// Quiet Office has the portal and the email off; No Portal Office has the
// email on and a package without the portal.
const OFFICES = `
INSERT INTO "SuperAdmin"(id, email, password, "firstName", "lastName", username, "updatedAt") VALUES ('sa', 'sam@nizmo.co', 'p', 'Sam', 'Admin', 'sa', now());
INSERT INTO "Package"(id, name, "hasCompanyManagement", "hasClientPortal", "updatedAt") VALUES ('portal', 'Portal', true, true, now()), ('plain', 'Plain', true, false, now());
UPDATE "Company" SET "packageId" = 'portal', timezone = 'Africa/Cairo', "taxUpdateEmails" = true WHERE id = 'c1';
UPDATE "Company" SET "packageId" = 'portal', "taxUpdateEmails" = false WHERE id = 'c2';
UPDATE "Company" SET "packageId" = 'plain', "taxUpdateEmails" = true WHERE id = 'c3';
INSERT INTO "Client"(id, "companyId", name, "ownerName", "mobileNumber", "locationName", "updatedAt") VALUES
 ('noor', 'c1', 'Al Noor Trading', 'Omar', '0100', 'Cairo', now()),
 ('quiet', 'c1', 'Quiet Client', 'Qadri', '0101', 'Giza', now()),
 ('shaky', 'c1', 'Shaky Mail', 'Sami', '0102', 'Giza', now()),
 ('byadmin', 'c1', 'Super Client', 'Sara', '0103', 'Giza', now()),
 ('big', 'c1', 'Big Client', 'Bassem', '0104', 'Giza', now()),
 ('after', 'c1', 'After Save', 'Adham', '0105', 'Giza', now()),
 ('theirs', 'c2', 'Their Client', 'Tarek', '0106', 'Giza', now()),
 ('plain', 'c3', 'Plain Client', 'Pakinam', '0107', 'Giza', now());
INSERT INTO "ClientAccount"(id, "companyId", "clientId", name, email, language, password, "activatedAt", "updatedAt") VALUES
 ('mona', 'c1', 'noor', 'Mona Fouad', 'mona@client.co', 'en', 'h', now(), now()),
 ('omar', 'c1', 'noor', 'عمر نور', 'omar@client.co', 'ar', 'h', now(), now()),
 ('nadia', 'c1', 'noor', 'Nadia Invited', 'nadia@client.co', 'ar', NULL, NULL, now()),
 ('qadri', 'c1', 'quiet', 'Qadri Invited', 'qadri@client.co', 'en', NULL, NULL, now()),
 ('sami', 'c1', 'shaky', 'Sami Ok', 'sami@client.co', 'en', 'h', now(), now()),
 ('samia', 'c1', 'shaky', 'Samia Down', 'samia@down.co', 'en', 'h', now(), now()),
 ('sara', 'c1', 'byadmin', 'Sara Super', 'sara@client.co', 'en', 'h', now(), now()),
 ('adham', 'c1', 'after', 'Adham After', 'adham@client.co', 'en', 'h', now(), now()),
 ('tarek', 'c2', 'theirs', 'Tarek Quiet', 'tarek@client.co', 'en', 'h', now(), now()),
 ('pakinam', 'c3', 'plain', 'Pakinam Plain', 'pakinam@client.co', 'en', 'h', now(), now());
INSERT INTO "ClientAccount"(id, "companyId", "clientId", name, email, language, password, "activatedAt", "updatedAt")
 SELECT 'big' || n, 'c1', 'big', 'Big ' || n, 'big' || n || '@client.co', 'en', 'h', now(), now() FROM generate_series(1, 12) AS n;
`
// 22:00 on 17 November in Cairo.
const NOW = new Date("2026-11-17T20:00:00Z")
// 23:30 on the 17th in Cairo, and 00:30 on the 18th there, the 17th still in UTC.
const LATER_TODAY = new Date("2026-11-17T21:30:00Z")
const TOMORROW_THERE = new Date("2026-11-17T22:30:00Z")
const ORIGIN = "https://nizmo.vercel.app"

const CLAIM: ClaimDraft = {
    claimNumber: "000101", item: "إقرار ضريبة الدخل", taxType: "دخل", registrationType: null, originalAmount: 1000, paidAmount: 0, remainingAmount: 1000,
    currency: "جنيه مصري", status: "في انتظار السداد", periodStart: "2025-01-01", periodEnd: "2025-12-31", dueDate: "2026-04-30",
}
// What a check screen sends, confirmed, so the file's company isn't asked about.
const upload = (clientId: string, uploads: number, over: Record<string, unknown> = {}) =>
    ({ clientId, uploads, asOf: "2026-11-17", fileName: "claims - 2026-11-17.xlsx", fileCompany: "", confirmed: true, claims: [CLAIM], ...over })

const admin = withGrants({ id: "a1", role: "ADMIN", companyId: "c1", name: "Amal One" }) as any
const quietAdmin = withGrants({ id: "a2", role: "ADMIN", companyId: "c2", name: "Adel Two" }) as any
const plainAdmin = withGrants({ id: "a3", role: "ADMIN", companyId: "c3", name: "Aya Three" }) as any
const superAdmin = { id: "sa", role: "SUPER_ADMIN", companyId: null, name: "Sam Admin" } as any

describe.skipIf(!ADMIN_URL)("the update email, in Postgres", () => {
    const dbName = `tax_update_email_test_${Date.now()}`
    let db: Client
    let tax: typeof import("@/lib/services/tax-claim.service")
    let prisma: typeof import("@/lib/prisma").prisma

    const emailedOn = async (clientId: string) => (await db.query(`SELECT to_char("emailedOn", 'YYYY-MM-DD') AS day FROM "ClientTaxPosition" WHERE "clientId" = $1`, [clientId])).rows[0]?.day ?? null
    const uploads = async (clientId: string) => (await db.query(`SELECT uploads FROM "ClientTaxPosition" WHERE "clientId" = $1`, [clientId])).rows[0]?.uploads ?? 0
    const logged = async (clientId: string) => (await db.query(`SELECT action, "entityType", details, "userId", "superAdminId" FROM "AuditLog" WHERE "entityId" = $1 ORDER BY "createdAt", action`, [clientId])).rows
    const to = () => outbox.sent.map(message => message.to.address).sort()

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
        await db.query(OFFICES)
        process.env.POSTGRES_PRISMA_URL = url.toString()
        tax = await import("@/lib/services/tax-claim.service")
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
        outbox.failFor.clear()
        outbox.sending = null
    })

    it("with the company's switch off, sends nothing, and says so", async () => {
        const saved = await tax.saveTaxFile(quietAdmin, upload("theirs", 0), NOW, ORIGIN)
        expect(saved.email).toEqual({ state: "off" })
        expect(outbox.sent).toHaveLength(0)
        expect(await emailedOn("theirs")).toBeNull()
        expect((await logged("theirs"))[0].details).not.toHaveProperty("emailed")
    })

    it("sends nothing where the company's package hasn't the client portal, the switch on or not", async () => {
        const saved = await tax.saveTaxFile(plainAdmin, upload("plain", 0), NOW, ORIGIN)
        expect(saved.email).toEqual({ state: "off" })
        expect(outbox.sent).toHaveLength(0)
        expect(await emailedOn("plain")).toBeNull()
    })

    it("emails each of the client's people who has set a password, in their own language, and none still invited", async () => {
        const saved = await tax.saveTaxFile(admin, upload("noor", 0), NOW, ORIGIN)
        expect(saved.email).toEqual({ state: "sent", sent: 2, failed: 0 })
        expect(to()).toEqual(["mona@client.co", "omar@client.co"])
        const mona = outbox.sent.find(message => message.to.address === "mona@client.co")!
        const omar = outbox.sent.find(message => message.to.address === "omar@client.co")!
        expect(mona.to).toEqual({ name: "Mona Fouad", address: "mona@client.co" })
        expect(mona.subject).toBe("The tax position of Al Noor Trading was updated")
        expect(mona.text).toContain("The figures are as of 17 November 2026.")
        expect(omar.subject).toBe("تحديث الموقف الضريبي لـAl Noor Trading")
        expect(omar.text).toContain("والأرقام حتى تاريخ ١٧ نوفمبر ٢٠٢٦.")
        for (const message of [mona, omar]) {
            // From the office, by its name, a reply going to whoever uploaded the file.
            expect(message.fromName).toBe("Al Amal Accounting")
            expect(message.replyTo).toEqual({ name: "Amal One", address: "a1@x.co" })
            // To Nizmo's sign-in page, on Nizmo's own address.
            expect(message.html).toContain(`href="${ORIGIN}/login"`)
        }
        // The day is kept in the company's time zone, and the upload's entry says how many.
        expect(await emailedOn("noor")).toBe("2026-11-17")
        const [entry] = await logged("noor")
        expect(entry).toMatchObject({ action: "UPDATE_TAX_POSITION", userId: "a1", superAdminId: null })
        expect(entry.details).toMatchObject({ name: "Al Noor Trading", claims: 1, emailed: 2 })
    })

    it("sends none for a second upload the same day, and says so", async () => {
        const saved = await tax.saveTaxFile(admin, upload("noor", 1, { claims: [] }), LATER_TODAY, ORIGIN)
        expect(saved.email).toEqual({ state: "today" })
        expect(outbox.sent).toHaveLength(0)
        expect(await uploads("noor")).toBe(2)
        expect((await logged("noor"))[1].details).not.toHaveProperty("emailed")
    })

    it("sends again on the next day where the company is, though it's still the same day in UTC", async () => {
        const saved = await tax.saveTaxFile(admin, upload("noor", 2, { asOf: "2026-11-18" }), TOMORROW_THERE, ORIGIN)
        expect(saved.email).toEqual({ state: "sent", sent: 2, failed: 0 })
        expect(await emailedOn("noor")).toBe("2026-11-18")
    })

    it("uploaded by a Super Admin, has no reply address", async () => {
        const saved = await tax.saveTaxFile(superAdmin, upload("byadmin", 0), NOW, ORIGIN)
        expect(saved.email).toEqual({ state: "sent", sent: 1, failed: 0 })
        expect(outbox.sent[0].replyTo).toBeNull()
        expect(outbox.sent[0].fromName).toBe("Al Amal Accounting")
        expect((await logged("byadmin"))[0]).toMatchObject({ userId: null, superAdminId: "sa" })
    })

    it("with no one who has set a password, sends nothing, says so, and leaves the day for when someone has", async () => {
        const first = await tax.saveTaxFile(admin, upload("quiet", 0), NOW, ORIGIN)
        expect(first.email).toEqual({ state: "nobody" })
        expect(outbox.sent).toHaveLength(0)
        expect(await emailedOn("quiet")).toBeNull()

        await db.query(`UPDATE "ClientAccount" SET password = 'h', "activatedAt" = now() WHERE id = 'qadri'`)
        const second = await tax.saveTaxFile(admin, upload("quiet", 1), LATER_TODAY, ORIGIN)
        expect(second.email).toEqual({ state: "sent", sent: 1, failed: 0 })
        expect(to()).toEqual(["qadri@client.co"])
    })

    it("sends each email once the upload is saved, never before", async () => {
        const seen: unknown[] = []
        outbox.sending = async () => { seen.push([await uploads("after"), await emailedOn("after")]) }
        await tax.saveTaxFile(admin, upload("after", 0), NOW, ORIGIN)
        expect(seen).toEqual([[1, "2026-11-17"]])
    })

    it("sends to as many people as the client has, a few at a time, each once", async () => {
        const saved = await tax.saveTaxFile(admin, upload("big", 0), NOW, ORIGIN)
        expect(saved.email).toEqual({ state: "sent", sent: 12, failed: 0 })
        expect(to()).toEqual(Array.from({ length: 12 }, (_, i) => `big${i + 1}@client.co`).sort())
    })

    it("that can't be sent to someone leaves the upload saved and the day marked, and a second audit log entry says how many", async () => {
        outbox.failFor.add("samia@down.co")
        const saved = await tax.saveTaxFile(admin, upload("shaky", 0), NOW, ORIGIN)
        expect(saved.email).toEqual({ state: "sent", sent: 1, failed: 1 })
        expect(to()).toEqual(["sami@client.co"])
        expect(await uploads("shaky")).toBe(1)
        expect(await emailedOn("shaky")).toBe("2026-11-17")
        const entries = await logged("shaky")
        expect(entries.map(entry => entry.action)).toEqual(["UPDATE_TAX_POSITION", "UPDATE_TAX_POSITION_NOT_EMAILED"])
        expect(entries[0].details).toMatchObject({ emailed: 2 })
        expect(entries[1]).toEqual({ action: "UPDATE_TAX_POSITION_NOT_EMAILED", entityType: "VENDOR", details: { name: "Shaky Mail", people: 1 }, userId: "a1", superAdminId: null })
    })

    it("sends nothing for an upload that's refused", async () => {
        await expect(tax.saveTaxFile(admin, upload("shaky", 0), LATER_TODAY, ORIGIN)).rejects.toThrow("TAX_CLAIMS_CHANGED")
        await expect(tax.saveTaxFile(admin, upload("theirs", 1), LATER_TODAY, ORIGIN)).rejects.toThrow("CLIENT_NOT_FOUND")
        expect(outbox.sent).toHaveLength(0)
    })
})

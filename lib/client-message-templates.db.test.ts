import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest"
import { readFileSync, readdirSync } from "node:fs"
import { Client } from "pg"
import { NIZMO_MESSAGES } from "./client-message-template"

/**
 * The messages' templates as they're kept (CLIENT_PORTAL_PLAN.md §7.1, §12
 * steps 10a, 10b, 10c-1 and 10c-2; PRs 346 to 349), against a real Postgres:
 * ClientMessageTemplate, what it refuses, each message once in each language
 * for Nizmo and for each company, what goes with a company or a person, the
 * texts a company's client's people are given, Nizmo's as the Super Admin
 * keeps them, and a company's own copy.
 *
 * Needs a Postgres it may create databases on: set ROLES_TEST_DATABASE_URL to
 * its maintenance database. Skipped without it (CI has no database).
 */

const ADMIN_URL = process.env.ROLES_TEST_DATABASE_URL
const MIGRATIONS = readdirSync("prisma/migrations").filter(m => m !== "migration_lock.toml").sort((a, b) => (a === "0_init" ? -1 : b === "0_init" ? 1 : a.localeCompare(b)))
const sql = (name: string) => readFileSync(`prisma/migrations/${name}/migration.sql`, "utf8")

const PEOPLE = `
INSERT INTO "Company"(id, name, "updatedAt") VALUES ('c1', 'One', now()), ('c2', 'Two', now());
INSERT INTO "User"(id, email, password, "firstName", "lastName", role, "lastDayOffResetYear", username, "companyId") VALUES
 ('a1', 'a1@x.co', 'p', 'Amal', 'One', 'ADMIN', 2026, 'a1', 'c1'),
 ('a2', 'a2@x.co', 'p', 'Adel', 'Two', 'ADMIN', 2026, 'a2', 'c2');
`

describe.skipIf(!ADMIN_URL)("the messages' templates, in Postgres", () => {
    const dbName = `client_messages_test_${Date.now()}`
    let db: Client
    let dbUrl: string
    let templates: typeof import("@/lib/services/client-message-template.service")
    let prisma: typeof import("@/lib/prisma").prisma

    const keep = (companyId: string | null, kind: string, language: string, text: string, updatedById: string | null = null, updatedByName: string | null = null) =>
        db.query(`INSERT INTO "ClientMessageTemplate"(id, "companyId", kind, language, text, "updatedById", "updatedByName", "updatedAt") VALUES (gen_random_uuid()::text, $1, $2, $3, $4, $5, $6, now())`,
            [companyId, kind, language, text, updatedById, updatedByName])
    /** The error's code where it's refused, "kept" where it isn't. */
    const tried = (write: Promise<unknown>) => write.then(() => "kept", (error: { code?: string }) => error.code)
    const kept = async () => (await db.query(`SELECT coalesce("companyId", '-') || ':' || kind || ':' || language AS row FROM "ClientMessageTemplate" ORDER BY 1`)).rows.map(r => r.row)

    beforeAll(async () => {
        const a = new Client({ connectionString: ADMIN_URL })
        await a.connect()
        // In UTF-8, as production's is, so a character is counted as one
        // whatever its bytes (the scratch cluster's own are SQL_ASCII).
        await a.query(`CREATE DATABASE ${dbName} ENCODING 'UTF8' TEMPLATE template0 LC_COLLATE 'C' LC_CTYPE 'C'`)
        await a.end()
        const url = new URL(ADMIN_URL!)
        url.pathname = `/${dbName}`
        dbUrl = url.toString()
        db = new Client({ connectionString: dbUrl })
        await db.connect()
        for (const m of MIGRATIONS) {
            await db.query(sql(m))
            if (m === "20260920000000_team_leader") await db.query(PEOPLE)
        }
        await db.query(`INSERT INTO "SuperAdmin"(id, email, password, "firstName", "lastName", username, "updatedAt") VALUES ('sa', 'sam@nizmo.co', 'p', 'Sam', 'Admin', 'sa', now())`)
        // One and Two's package has the client portal; Three's hasn't, and Four has no package, so no client portal (§2).
        await db.query(`INSERT INTO "Package"(id, name, "hasCompanyManagement", "hasClientPortal", "updatedAt") VALUES ('p-none', 'Without', true, false, now()), ('p-portal', 'With', true, true, now())`)
        await db.query(`UPDATE "Company" SET "packageId" = 'p-portal' WHERE id IN ('c1', 'c2')`)
        await db.query(`INSERT INTO "Company"(id, name, "packageId", "updatedAt") VALUES ('c3', 'Three', 'p-none', now()), ('c4', 'Four', NULL, now())`)
        process.env.POSTGRES_PRISMA_URL = url.toString()
        templates = await import("@/lib/services/client-message-template.service")
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

    beforeEach(async () => {
        await db.query(`DELETE FROM "ClientMessageTemplate"`)
        await db.query(`DELETE FROM "AuditLog"`)
    })

    describe("the table", () => {
        it("has row-level security on, as every table does", async () => {
            const { rows } = await db.query(`SELECT relrowsecurity FROM pg_class WHERE relname = 'ClientMessageTemplate'`)
            expect(rows).toEqual([{ relrowsecurity: true }])
        })

        it("keeps the two messages, each in Arabic and English", async () => {
            for (const kind of ["contact", "claim"]) for (const language of ["ar", "en"]) {
                expect(await tried(keep(null, kind, language, "Hi {person}"))).toBe("kept")
            }
            expect(await kept()).toEqual(["-:claim:ar", "-:claim:en", "-:contact:ar", "-:contact:en"])
        })

        it("refuses a message or a language there's no such one of", async () => {
            expect(await tried(keep(null, "reminder", "en", "Hi"))).toBe("23514")
            expect(await tried(keep(null, "contact", "fr", "Salut"))).toBe("23514")
            expect(await kept()).toEqual([])
        })

        it("refuses an empty text, or one of only spaces and new lines", async () => {
            expect(await tried(keep(null, "contact", "en", ""))).toBe("23514")
            expect(await tried(keep(null, "contact", "en", " \r\n\t "))).toBe("23514")
            expect(await kept()).toEqual([])
        })

        it("marks a company's row as using Nizmo's, never Nizmo's own (PR 348)", async () => {
            expect(await tried(db.query(`INSERT INTO "ClientMessageTemplate"(id, "companyId", kind, language, text, "usesNizmo", "updatedAt") VALUES ('back', 'c1', 'contact', 'en', 'Was ours', true, now())`))).toBe("kept")
            expect(await tried(db.query(`INSERT INTO "ClientMessageTemplate"(id, "companyId", kind, language, text, "usesNizmo", "updatedAt") VALUES ('self', NULL, 'contact', 'en', 'Hi', true, now())`))).toBe("23514")
            expect((await db.query(`SELECT "usesNizmo" FROM "ClientMessageTemplate" WHERE id = 'back'`)).rows).toEqual([{ usesNizmo: true }])
            await keep("c1", "claim", "en", "Ours")
            expect((await db.query(`SELECT "usesNizmo" FROM "ClientMessageTemplate" WHERE kind = 'claim'`)).rows).toEqual([{ usesNizmo: false }])
        })

        it("keeps up to 1,000 characters, an emoji as one, and refuses more", async () => {
            expect(await tried(keep(null, "contact", "en", "a".repeat(1000)))).toBe("kept")
            expect(await tried(keep(null, "contact", "ar", "😀".repeat(1000)))).toBe("kept")
            expect(await tried(keep(null, "claim", "en", "a".repeat(1001)))).toBe("23514")
            expect(await kept()).toEqual(["-:contact:ar", "-:contact:en"])
        })
    })

    describe("each message once in each language", () => {
        it("once for Nizmo", async () => {
            await keep(null, "contact", "en", "First")
            expect(await tried(keep(null, "contact", "en", "Second"))).toBe("23505")
        })

        it("once for each company", async () => {
            await keep("c1", "contact", "en", "First")
            expect(await tried(keep("c1", "contact", "en", "Second"))).toBe("23505")
        })

        it("Nizmo's, each company's, and the other language's of the same message, side by side", async () => {
            await keep(null, "contact", "en", "Nizmo's")
            await keep("c1", "contact", "en", "One's")
            await keep("c2", "contact", "en", "Two's")
            await keep("c1", "contact", "ar", "One's in Arabic")
            await keep("c1", "claim", "en", "One's claim")
            expect(await kept()).toEqual(["-:contact:en", "c1:claim:en", "c1:contact:ar", "c1:contact:en", "c2:contact:en"])
        })

        it("for a company that's there", async () => {
            expect(await tried(keep("nobody", "contact", "en", "Hi"))).toBe("23503")
        })
    })

    describe("what goes with what", () => {
        it("a company's own go with it; Nizmo's and the others' stay", async () => {
            await db.query(`INSERT INTO "Company"(id, name, "updatedAt") VALUES ('brief', 'Brief', now())`)
            await keep(null, "contact", "en", "Nizmo's")
            await keep("brief", "contact", "en", "Brief's")
            await keep("c1", "contact", "en", "One's")
            await db.query(`DELETE FROM "Company" WHERE id = 'brief'`)
            expect(await kept()).toEqual(["-:contact:en", "c1:contact:en"])
        })

        it("who changed one is no one when they're deleted outright, their name kept", async () => {
            await db.query(`INSERT INTO "User"(id, email, password, "firstName", "lastName", role, "lastDayOffResetYear", username, "companyId", "roleId")
                SELECT 'brief', 'brief@x.co', 'p', 'Brief', 'Stay', 'ADMIN', 2026, 'brief', 'c1', id FROM "Role" WHERE "companyId" = 'c1' AND "builtIn" = 'ADMIN'`)
            await keep("c1", "contact", "en", "One's", "brief", "Brief Stay")
            expect(await tried(keep("c1", "claim", "en", "Hi", "nobody", "No One"))).toBe("23503")
            await db.query(`DELETE FROM "User" WHERE id = 'brief'`)
            const { rows } = await db.query(`SELECT "updatedById", "updatedByName", text FROM "ClientMessageTemplate"`)
            expect(rows).toEqual([{ updatedById: null, updatedByName: "Brief Stay", text: "One's" }])
        })
    })

    describe("the texts a company's client's people are given", () => {
        it("Nizmo's own as written, where nothing is kept", async () => {
            expect(await templates.clientMessages("c1")).toEqual(NIZMO_MESSAGES)
        })

        it("Nizmo's as the Super Admin changed them, for every company", async () => {
            await keep(null, "contact", "en", "Hi from Nizmo, {person}", null, "Sam Admin")
            for (const company of ["c1", "c2"]) {
                expect(await templates.clientMessages(company)).toEqual({ ...NIZMO_MESSAGES, contact: { ...NIZMO_MESSAGES.contact, en: "Hi from Nizmo, {person}" } })
            }
        })

        it("the company's own before Nizmo's, and never another company's", async () => {
            await keep(null, "contact", "en", "Hi from Nizmo, {person}")
            await keep("c1", "contact", "en", "Hi from One, {person}", "a1", "Amal One")
            await keep("c1", "claim", "ar", "استفسار عن {number}", "a1", "Amal One")
            expect(await templates.clientMessages("c1")).toEqual({
                contact: { ar: NIZMO_MESSAGES.contact.ar, en: "Hi from One, {person}" },
                claim: { ar: "استفسار عن {number}", en: NIZMO_MESSAGES.claim.en },
            })
            expect(await templates.clientMessages("c2")).toEqual({ ...NIZMO_MESSAGES, contact: { ...NIZMO_MESSAGES.contact, en: "Hi from Nizmo, {person}" } })
        })
    })

    describe("Nizmo's messages, as the Super Admin keeps them", () => {
        const SAM = { id: "sa", name: "Sam Admin" }
        const save = (input: { kind: "contact" | "claim"; language: "ar" | "en"; text: string; since: string | null }) => templates.saveNizmoMessage(SAM, input)
        const refusal = (write: Promise<unknown>) => write.then(() => "saved", (error: Error) => error.message)
        const logged = async () => (await db.query(`SELECT action, "entityType", "entityId", "userId", "superAdminId", details FROM "AuditLog" ORDER BY "createdAt"`)).rows
        const nizmos = async () => (await db.query(`SELECT kind, language, text, "updatedById", "updatedByName" FROM "ClientMessageTemplate" WHERE "companyId" IS NULL ORDER BY kind, language`)).rows

        it("each message in each language, Nizmo's own as written, never changed, where nothing is kept", async () => {
            expect(await templates.nizmoMessages()).toEqual([
                { kind: "contact", language: "ar", text: NIZMO_MESSAGES.contact.ar, changedBy: null, changedAt: null },
                { kind: "contact", language: "en", text: NIZMO_MESSAGES.contact.en, changedBy: null, changedAt: null },
                { kind: "claim", language: "ar", text: NIZMO_MESSAGES.claim.ar, changedBy: null, changedAt: null },
                { kind: "claim", language: "en", text: NIZMO_MESSAGES.claim.en, changedBy: null, changedAt: null },
            ])
        })

        it("never a company's copy for Nizmo's", async () => {
            await keep("c1", "contact", "ar", "نسختنا {person}", "a1", "Amal One")
            expect((await templates.nizmoMessages())[0]).toEqual({ kind: "contact", language: "ar", text: NIZMO_MESSAGES.contact.ar, changedBy: null, changedAt: null })
        })

        it("a first change kept by the Super Admin's name, with what it was and what it is in the audit log", async () => {
            const saved = await save({ kind: "contact", language: "en", text: "Hi {person}", since: null })
            expect(saved).toEqual({ kind: "contact", language: "en", text: "Hi {person}", changedBy: "Sam Admin", changedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/) })
            expect(await nizmos()).toEqual([{ kind: "contact", language: "en", text: "Hi {person}", updatedById: null, updatedByName: "Sam Admin" }])
            const [row] = (await db.query(`SELECT id FROM "ClientMessageTemplate"`)).rows
            expect(await logged()).toEqual([{
                action: "UPDATE_CLIENT_MESSAGE", entityType: "CLIENT_MESSAGE", entityId: row.id, userId: null, superAdminId: "sa",
                details: { message: "CONTACT_ACCOUNTANT", language: "EN", before: NIZMO_MESSAGES.contact.en, after: "Hi {person}" },
            }])
            expect((await templates.nizmoMessages())[1]).toEqual(saved)
        })

        it("given to every company that has no copy of its own", async () => {
            await save({ kind: "claim", language: "ar", text: "استفسار عن {number}", since: null })
            expect((await templates.clientMessages("c2")).claim.ar).toBe("استفسار عن {number}")
        })

        it("a change from the text the page opened with is kept; from an older one, refused, and nothing written", async () => {
            const first = await save({ kind: "contact", language: "en", text: "One {person}", since: null })
            const second = await save({ kind: "contact", language: "en", text: "Two {person}", since: first.changedAt })
            expect(second.text).toBe("Two {person}")
            expect(await refusal(save({ kind: "contact", language: "en", text: "Three", since: first.changedAt }))).toBe("MESSAGE_CHANGED_SINCE")
            expect(await refusal(save({ kind: "contact", language: "en", text: "Three", since: null }))).toBe("MESSAGE_CHANGED_SINCE")
            expect(await refusal(save({ kind: "claim", language: "en", text: "Three {number}", since: second.changedAt }))).toBe("MESSAGE_CHANGED_SINCE")
            expect((await nizmos()).map(r => r.text)).toEqual(["Two {person}"])
            expect((await logged()).map(r => r.details.after)).toEqual(["One {person}", "Two {person}"])
            expect((await logged())[1].details.before).toBe("One {person}")
        })

        it("of two saves at once from the same text, one is kept and the other refused", async () => {
            const both = await Promise.all([
                refusal(save({ kind: "contact", language: "ar", text: "أولًا {person}", since: null })),
                refusal(save({ kind: "contact", language: "ar", text: "ثانيًا {person}", since: null })),
            ])
            expect(both.sort()).toEqual(["MESSAGE_CHANGED_SINCE", "saved"])
            expect(await nizmos()).toHaveLength(1)
            expect(await logged()).toHaveLength(1)
            const kept = await templates.nizmoMessages()
            const again = await Promise.all([
                refusal(save({ kind: "contact", language: "ar", text: "ثالثًا {person}", since: kept[0].changedAt })),
                refusal(save({ kind: "contact", language: "ar", text: "رابعًا {person}", since: kept[0].changedAt })),
            ])
            expect(again.sort()).toEqual(["MESSAGE_CHANGED_SINCE", "saved"])
            expect(await logged()).toHaveLength(2)
        })

        it("a first save refused where another first save is kept while it's being written, and nothing more written", async () => {
            // The other save's row, written and not yet kept: this one doesn't see it, and waits for it.
            const other = new Client({ connectionString: dbUrl })
            await other.connect()
            try {
                await other.query("BEGIN")
                await other.query(`INSERT INTO "ClientMessageTemplate"(id, "companyId", kind, language, text, "updatedByName", "updatedAt") VALUES ('first', NULL, 'contact', 'en', 'First {person}', 'Other Admin', now())`)
                const pending = refusal(save({ kind: "contact", language: "en", text: "Second {person}", since: null }))
                await new Promise(resolve => setTimeout(resolve, 500))
                await other.query("COMMIT")
                expect(await pending).toBe("MESSAGE_CHANGED_SINCE")
            } finally {
                await other.end()
            }
            expect((await nizmos()).map(r => r.text)).toEqual(["First {person}"])
            expect(await logged()).toEqual([])
        })

        it("the same text again writes nothing", async () => {
            const first = await save({ kind: "contact", language: "en", text: "Hi {person}", since: null })
            expect(await save({ kind: "contact", language: "en", text: "Hi {person}", since: first.changedAt })).toEqual(first)
            expect(await save({ kind: "claim", language: "en", text: NIZMO_MESSAGES.claim.en, since: null }))
                .toEqual({ kind: "claim", language: "en", text: NIZMO_MESSAGES.claim.en, changedBy: null, changedAt: null })
            expect(await logged()).toHaveLength(1)
            expect(await nizmos()).toHaveLength(1)
        })

        it("refuses an empty text, one past 1,000 characters, and one naming a field its message can't fill, keeping nothing", async () => {
            expect(await refusal(save({ kind: "contact", language: "en", text: " \n ", since: null }))).toBe("MESSAGE_EMPTY")
            expect(await refusal(save({ kind: "contact", language: "en", text: "a".repeat(1001), since: null }))).toBe("MESSAGE_TOO_LONG")
            expect(await refusal(save({ kind: "contact", language: "en", text: "About {number}", since: null }))).toBe("MESSAGE_FIELD")
            expect(await nizmos()).toEqual([])
            expect(await logged()).toEqual([])
        })

        it("keeps a line ended by a carriage return as a new line", async () => {
            expect((await save({ kind: "contact", language: "en", text: "a\r\nb\rc {person}", since: null })).text).toBe("a\nb\nc {person}")
        })

        it("leaves a company's own copy as it was, and the company still uses it", async () => {
            await keep("c1", "contact", "en", "Ours {person}", "a1", "Amal One")
            await save({ kind: "contact", language: "en", text: "Nizmo's {person}", since: null })
            expect((await db.query(`SELECT text, "updatedByName" FROM "ClientMessageTemplate" WHERE "companyId" = 'c1'`)).rows).toEqual([{ text: "Ours {person}", updatedByName: "Amal One" }])
            expect((await templates.clientMessages("c1")).contact.en).toBe("Ours {person}")
            expect((await templates.clientMessages("c2")).contact.en).toBe("Nizmo's {person}")
        })
    })

    describe("a company's own copy (step 10c-1)", () => {
        const AMAL = { id: "a1", name: "Amal One", role: "ADMIN" }
        const SAM = { id: "sa", name: "Sam Admin", role: "SUPER_ADMIN" }
        type Input = { kind: "contact" | "claim"; language: "ar" | "en"; text: string; since: string | null }
        const save = (input: Input, by = AMAL, company = "c1") => templates.saveCompanyMessage(by, company, input)
        const back = (input: Omit<Input, "text">, by = AMAL, company = "c1") => templates.nizmoMessageAgain(by, company, input)
        const refusal = (write: Promise<unknown>) => write.then(() => "saved", (error: Error) => error.message)
        const logged = async () => (await db.query(`SELECT action, "entityType", "entityId", "userId", "superAdminId", details FROM "AuditLog" ORDER BY "createdAt"`)).rows
        const copies = async (company = "c1") => (await db.query(`SELECT kind, language, text, "updatedById", "updatedByName" FROM "ClientMessageTemplate" WHERE "companyId" = $1 ORDER BY kind, language`, [company])).rows
        const nizmos = (kind: "contact" | "claim", language: "ar" | "en", text: string) => ({ kind, language, text, own: false, changedBy: null, changedAt: null })
        // Nizmo's, put back by someone: who did and when, the time a save says it started from.
        const putBack = (kind: "contact" | "claim", language: "ar" | "en", text: string, by: string) => ({ kind, language, text, own: false, changedBy: by, changedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/) })
        const marks = async (company = "c1") => (await db.query(`SELECT kind || ':' || language || ':' || "usesNizmo" AS mark FROM "ClientMessageTemplate" WHERE "companyId" = $1 ORDER BY 1`, [company])).rows.map(r => r.mark)

        it("each message in each language as the company uses it: Nizmo's, as the Super Admin changed it or as written, until it has its own", async () => {
            await keep(null, "contact", "en", "Nizmo's now {person}", null, "Sam Admin")
            expect(await templates.companyMessages("c1")).toEqual([
                nizmos("contact", "ar", NIZMO_MESSAGES.contact.ar),
                nizmos("contact", "en", "Nizmo's now {person}"),
                nizmos("claim", "ar", NIZMO_MESSAGES.claim.ar),
                nizmos("claim", "en", NIZMO_MESSAGES.claim.en),
            ])
        })

        it("its own copy, by who changed it and when, and never another company's", async () => {
            await keep("c1", "contact", "ar", "نسختنا {person}", "a1", "Amal One")
            const [mine] = await templates.companyMessages("c1")
            expect(mine).toEqual({ kind: "contact", language: "ar", text: "نسختنا {person}", own: true, changedBy: "Amal One", changedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/) })
            expect((await templates.companyMessages("c2"))[0]).toEqual(nizmos("contact", "ar", NIZMO_MESSAGES.contact.ar))
        })

        it("a first change kept as the company's copy, by the person's name, with the company, what it was and what it is in the audit log", async () => {
            await keep(null, "contact", "en", "Nizmo's now {person}", null, "Sam Admin")
            const saved = await save({ kind: "contact", language: "en", text: "Ours {person}", since: null })
            expect(saved).toEqual({ kind: "contact", language: "en", text: "Ours {person}", own: true, changedBy: "Amal One", changedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/) })
            expect(await copies()).toEqual([{ kind: "contact", language: "en", text: "Ours {person}", updatedById: "a1", updatedByName: "Amal One" }])
            const [row] = (await db.query(`SELECT id FROM "ClientMessageTemplate" WHERE "companyId" = 'c1'`)).rows
            expect(await logged()).toEqual([{
                action: "UPDATE_CLIENT_MESSAGE", entityType: "CLIENT_MESSAGE", entityId: row.id, userId: "a1", superAdminId: null,
                details: { company: "One", message: "CONTACT_ACCOUNTANT", language: "EN", before: "Nizmo's now {person}", after: "Ours {person}" },
            }])
            expect((await templates.companyMessages("c1"))[1]).toEqual(saved)
            // Its client's people are given it; Nizmo's, and every other company's, stay as they were.
            expect((await templates.clientMessages("c1")).contact.en).toBe("Ours {person}")
            expect((await templates.clientMessages("c2")).contact.en).toBe("Nizmo's now {person}")
            expect((await templates.nizmoMessages())[1].text).toBe("Nizmo's now {person}")
        })

        it("the Super Admin's change to a company's copy is kept by their name alone", async () => {
            await save({ kind: "claim", language: "ar", text: "استفسار عن {number}", since: null }, SAM, "c2")
            expect(await copies("c2")).toEqual([{ kind: "claim", language: "ar", text: "استفسار عن {number}", updatedById: null, updatedByName: "Sam Admin" }])
            expect((await logged()).map(r => [r.userId, r.superAdminId, r.details.company])).toEqual([[null, "sa", "Two"]])
        })

        it("a change from the text the page opened with is kept; from an older one, refused, and nothing written", async () => {
            const first = await save({ kind: "contact", language: "en", text: "One {person}", since: null })
            const second = await save({ kind: "contact", language: "en", text: "Two {person}", since: first.changedAt })
            expect(second.text).toBe("Two {person}")
            expect(await refusal(save({ kind: "contact", language: "en", text: "Three", since: first.changedAt }))).toBe("MESSAGE_CHANGED_SINCE")
            expect(await refusal(save({ kind: "contact", language: "en", text: "Three", since: null }))).toBe("MESSAGE_CHANGED_SINCE")
            expect(await refusal(save({ kind: "claim", language: "en", text: "Three {number}", since: second.changedAt }))).toBe("MESSAGE_CHANGED_SINCE")
            expect((await copies()).map(r => r.text)).toEqual(["Two {person}"])
            expect((await logged()).map(r => r.details.after)).toEqual(["One {person}", "Two {person}"])
            expect((await logged())[1].details.before).toBe("One {person}")
        })

        it("another company's copy, or Nizmo's, changed meanwhile, refuses nothing", async () => {
            const nizmo = await templates.saveNizmoMessage(SAM, { kind: "contact", language: "en", text: "Nizmo's {person}", since: null })
            await save({ kind: "contact", language: "en", text: "Theirs {person}", since: null }, { id: "a2", name: "Adel Two", role: "ADMIN" }, "c2")
            expect(nizmo.changedAt).not.toBeNull()
            expect(await refusal(save({ kind: "contact", language: "en", text: "Ours {person}", since: null }))).toBe("saved")
        })

        it("of two saves at once from the same text, one is kept and the other refused", async () => {
            const both = await Promise.all([
                refusal(save({ kind: "contact", language: "ar", text: "أولًا {person}", since: null })),
                refusal(save({ kind: "contact", language: "ar", text: "ثانيًا {person}", since: null })),
            ])
            expect(both.sort()).toEqual(["MESSAGE_CHANGED_SINCE", "saved"])
            expect(await copies()).toHaveLength(1)
            expect(await logged()).toHaveLength(1)
            const [kept] = await templates.companyMessages("c1")
            const again = await Promise.all([
                refusal(save({ kind: "contact", language: "ar", text: "ثالثًا {person}", since: kept.changedAt })),
                refusal(save({ kind: "contact", language: "ar", text: "رابعًا {person}", since: kept.changedAt })),
            ])
            expect(again.sort()).toEqual(["MESSAGE_CHANGED_SINCE", "saved"])
            expect(await logged()).toHaveLength(2)
        })

        it("the same text again writes nothing, and Nizmo's text unchanged makes no copy", async () => {
            const first = await save({ kind: "contact", language: "en", text: "Hi {person}", since: null })
            expect(await save({ kind: "contact", language: "en", text: "Hi {person}", since: first.changedAt })).toEqual(first)
            expect(await save({ kind: "claim", language: "en", text: NIZMO_MESSAGES.claim.en, since: null })).toEqual(nizmos("claim", "en", NIZMO_MESSAGES.claim.en))
            expect(await logged()).toHaveLength(1)
            expect(await copies()).toHaveLength(1)
        })

        it("refuses an empty text, one past 1,000 characters, and one naming a field its message can't fill, keeping nothing", async () => {
            expect(await refusal(save({ kind: "contact", language: "en", text: " \n ", since: null }))).toBe("MESSAGE_EMPTY")
            expect(await refusal(save({ kind: "contact", language: "en", text: "a".repeat(1001), since: null }))).toBe("MESSAGE_TOO_LONG")
            expect(await refusal(save({ kind: "contact", language: "en", text: "About {number}", since: null }))).toBe("MESSAGE_FIELD")
            expect(await copies()).toEqual([])
            expect(await logged()).toEqual([])
        })

        it("keeps a line ended by a carriage return as a new line", async () => {
            expect((await save({ kind: "contact", language: "en", text: "a\r\nb\rc {person}", since: null })).text).toBe("a\nb\nc {person}")
        })

        it("Use Nizmo's message: the copy is marked as Nizmo's, in the audit log with what it was and what it is, and the company follows Nizmo's again", async () => {
            const copy = await save({ kind: "claim", language: "ar", text: "نسختنا {number}", since: null })
            const [row] = (await db.query(`SELECT id FROM "ClientMessageTemplate" WHERE "companyId" = 'c1'`)).rows
            const again = await back({ kind: "claim", language: "ar", since: copy.changedAt })
            expect(again).toEqual(putBack("claim", "ar", NIZMO_MESSAGES.claim.ar, "Amal One"))
            expect(again.changedAt).not.toBe(copy.changedAt)
            expect(await marks()).toEqual(["claim:ar:true"])
            expect((await templates.companyMessages("c1"))[2]).toEqual(again)
            expect((await logged())[1]).toEqual({
                action: "USE_NIZMO_CLIENT_MESSAGE", entityType: "CLIENT_MESSAGE", entityId: row.id, userId: "a1", superAdminId: null,
                details: { company: "One", message: "ASK_ABOUT_CLAIM", language: "AR", before: "نسختنا {number}", after: NIZMO_MESSAGES.claim.ar },
            })
            // Its client's people are never given the copy it was.
            expect((await templates.clientMessages("c1")).claim.ar).toBe(NIZMO_MESSAGES.claim.ar)
            await templates.saveNizmoMessage(SAM, { kind: "claim", language: "ar", text: "لاحقًا {number}", since: null })
            expect((await templates.companyMessages("c1"))[2]).toEqual({ ...again, text: "لاحقًا {number}" })
            expect((await templates.clientMessages("c1")).claim.ar).toBe("لاحقًا {number}")
        })

        it("a save from Nizmo's text is refused where a copy was made and put back to Nizmo's since, and nothing more written", async () => {
            const read = (await templates.companyMessages("c1"))[1]
            expect(read.changedAt).toBeNull()
            const other = await save({ kind: "contact", language: "en", text: "Theirs {person}", since: null }, SAM)
            await back({ kind: "contact", language: "en", since: other.changedAt }, SAM)
            expect(await refusal(save({ kind: "contact", language: "en", text: "Mine {person}", since: read.changedAt }))).toBe("MESSAGE_CHANGED_SINCE")
            expect(await refusal(back({ kind: "contact", language: "en", since: read.changedAt }))).toBe("MESSAGE_CHANGED_SINCE")
            expect(await marks()).toEqual(["contact:en:true"])
            expect(await logged()).toHaveLength(2)
        })

        it("a save from Nizmo's, put back, makes the company's copy again", async () => {
            const copy = await save({ kind: "contact", language: "en", text: "Ours {person}", since: null })
            const again = await back({ kind: "contact", language: "en", since: copy.changedAt })
            const anew = await save({ kind: "contact", language: "en", text: "Ours anew {person}", since: again.changedAt }, SAM)
            expect(anew).toEqual({ kind: "contact", language: "en", text: "Ours anew {person}", own: true, changedBy: "Sam Admin", changedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/) })
            expect(await marks()).toEqual(["contact:en:false"])
            expect((await logged())[2].details).toEqual({ company: "One", message: "CONTACT_ACCOUNTANT", language: "EN", before: NIZMO_MESSAGES.contact.en, after: "Ours anew {person}" })
            expect((await templates.clientMessages("c1")).contact.en).toBe("Ours anew {person}")
        })

        it("Nizmo's text saved where Nizmo's was put back writes nothing, and Use Nizmo's message again writes nothing", async () => {
            const copy = await save({ kind: "contact", language: "en", text: "Ours {person}", since: null })
            const again = await back({ kind: "contact", language: "en", since: copy.changedAt })
            expect(await save({ kind: "contact", language: "en", text: NIZMO_MESSAGES.contact.en, since: again.changedAt })).toEqual(again)
            expect(await back({ kind: "contact", language: "en", since: again.changedAt })).toEqual(again)
            expect(await logged()).toHaveLength(2)
            expect(await marks()).toEqual(["contact:en:true"])
        })

        it("Use Nizmo's message gives Nizmo's as the Super Admin changed it, and the audit log says so", async () => {
            await templates.saveNizmoMessage(SAM, { kind: "contact", language: "en", text: "Nizmo's now {person}", since: null })
            const copy = await save({ kind: "contact", language: "en", text: "Ours {person}", since: null })
            expect(await back({ kind: "contact", language: "en", since: copy.changedAt })).toEqual(putBack("contact", "en", "Nizmo's now {person}", "Amal One"))
            expect((await logged())[2].details).toEqual({ company: "One", message: "CONTACT_ACCOUNTANT", language: "EN", before: "Ours {person}", after: "Nizmo's now {person}" })
        })

        it("Use Nizmo's message by the Super Admin is in the audit log, and kept, by their name", async () => {
            const copy = await save({ kind: "contact", language: "en", text: "Ours {person}", since: null })
            expect(await back({ kind: "contact", language: "en", since: copy.changedAt }, SAM)).toEqual(putBack("contact", "en", NIZMO_MESSAGES.contact.en, "Sam Admin"))
            expect((await copies()).map(r => [r.updatedById, r.updatedByName])).toEqual([[null, "Sam Admin"]])
            expect((await logged()).map(r => [r.action, r.userId, r.superAdminId])).toEqual([["UPDATE_CLIENT_MESSAGE", "a1", null], ["USE_NIZMO_CLIENT_MESSAGE", null, "sa"]])
        })

        it("Use Nizmo's message from an older copy is refused, and the copy stays", async () => {
            const first = await save({ kind: "contact", language: "en", text: "One {person}", since: null })
            await save({ kind: "contact", language: "en", text: "Two {person}", since: first.changedAt })
            expect(await refusal(back({ kind: "contact", language: "en", since: first.changedAt }))).toBe("MESSAGE_CHANGED_SINCE")
            expect(await refusal(back({ kind: "contact", language: "en", since: null }))).toBe("MESSAGE_CHANGED_SINCE")
            expect((await copies()).map(r => r.text)).toEqual(["Two {person}"])
            expect(await logged()).toHaveLength(2)
        })

        it("Use Nizmo's message where Nizmo's is used writes nothing; where someone put it back since, it's refused", async () => {
            expect(await back({ kind: "contact", language: "ar", since: null })).toEqual(nizmos("contact", "ar", NIZMO_MESSAGES.contact.ar))
            const copy = await save({ kind: "contact", language: "ar", text: "نسختنا {person}", since: null })
            await back({ kind: "contact", language: "ar", since: copy.changedAt })
            expect(await refusal(back({ kind: "contact", language: "ar", since: copy.changedAt }))).toBe("MESSAGE_CHANGED_SINCE")
            expect((await logged()).map(r => r.action)).toEqual(["UPDATE_CLIENT_MESSAGE", "USE_NIZMO_CLIENT_MESSAGE"])
        })

        it("of two at once from the same copy, one goes back and the other is refused", async () => {
            const copy = await save({ kind: "contact", language: "en", text: "Ours {person}", since: null })
            const both = await Promise.all([
                refusal(back({ kind: "contact", language: "en", since: copy.changedAt })),
                refusal(save({ kind: "contact", language: "en", text: "Ours again {person}", since: copy.changedAt })),
            ])
            expect(both.sort()).toEqual(["MESSAGE_CHANGED_SINCE", "saved"])
            expect(await logged()).toHaveLength(2)
        })

        it("Use Nizmo's message leaves another company's copy as it is", async () => {
            const ours = await save({ kind: "contact", language: "en", text: "Ours {person}", since: null })
            await save({ kind: "contact", language: "en", text: "Theirs {person}", since: null }, { id: "a2", name: "Adel Two", role: "ADMIN" }, "c2")
            await back({ kind: "contact", language: "en", since: ours.changedAt })
            expect((await copies("c2")).map(r => r.text)).toEqual(["Theirs {person}"])
        })

        it("is refused, writing nothing, for a company whose package hasn't the client portal, one with no package, and one that isn't there", async () => {
            expect(await refusal(templates.companyMessages("c3"))).toBe("CLIENT_PORTAL_NOT_IN_PACKAGE")
            expect(await refusal(save({ kind: "contact", language: "en", text: "Ours {person}", since: null }, SAM, "c3"))).toBe("CLIENT_PORTAL_NOT_IN_PACKAGE")
            await keep("c3", "contact", "en", "Before {person}", null, "Sam Admin")
            expect(await refusal(back({ kind: "contact", language: "en", since: null }, SAM, "c3"))).toBe("CLIENT_PORTAL_NOT_IN_PACKAGE")
            expect(await refusal(templates.companyMessages("c4"))).toBe("CLIENT_PORTAL_NOT_IN_PACKAGE")
            expect(await refusal(save({ kind: "contact", language: "en", text: "Ours {person}", since: null }, SAM, "c4"))).toBe("CLIENT_PORTAL_NOT_IN_PACKAGE")
            expect(await refusal(templates.companyMessages("gone"))).toBe("COMPANY_NOT_FOUND")
            expect(await refusal(save({ kind: "contact", language: "en", text: "Ours {person}", since: null }, SAM, "gone"))).toBe("COMPANY_NOT_FOUND")
            expect((await copies("c3")).map(r => r.text)).toEqual(["Before {person}"])
            expect(await copies("c4")).toEqual([])
            expect(await logged()).toEqual([])
        })
    })

    describe("Use Nizmo's message for every language at once (step 10c-2)", () => {
        const AMAL = { id: "a1", name: "Amal One", role: "ADMIN" }
        const SAM = { id: "sa", name: "Sam Admin", role: "SUPER_ADMIN" }
        type Since = { ar: string | null; en: string | null }
        const save = (kind: "contact" | "claim", language: "ar" | "en", text: string, since: string | null = null, by = AMAL, company = "c1") =>
            templates.saveCompanyMessage(by, company, { kind, language, text, since })
        const backAll = (kind: "contact" | "claim", since: Since, by = AMAL, company = "c1") => templates.nizmoMessagesAgain(by, company, { kind, since })
        const refusal = (write: Promise<unknown>) => write.then(() => "saved", (error: Error) => error.message)
        // In one go, two entries can share their moment: Arabic's first then.
        const logged = async () => (await db.query(`SELECT action, "userId", "superAdminId", details FROM "AuditLog" ORDER BY "createdAt", details->>'language'`)).rows
        const marks = async (company = "c1") => (await db.query(`SELECT kind || ':' || language || ':' || "usesNizmo" AS mark FROM "ClientMessageTemplate" WHERE "companyId" = $1 ORDER BY 1`, [company])).rows.map(r => r.mark)
        const nizmos = (kind: "contact" | "claim", language: "ar" | "en", text: string) => ({ kind, language, text, own: false, changedBy: null, changedAt: null })
        const putBack = (kind: "contact" | "claim", language: "ar" | "en", text: string, by: string) => ({ kind, language, text, own: false, changedBy: by, changedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/) })

        it("puts back both languages' copies, each in the audit log with what it was and what it is, Arabic first", async () => {
            const ar = await save("contact", "ar", "نسختنا {person}")
            const en = await save("contact", "en", "Ours {person}")
            expect(await backAll("contact", { ar: ar.changedAt, en: en.changedAt })).toEqual([
                putBack("contact", "ar", NIZMO_MESSAGES.contact.ar, "Amal One"),
                putBack("contact", "en", NIZMO_MESSAGES.contact.en, "Amal One"),
            ])
            expect(await marks()).toEqual(["contact:ar:true", "contact:en:true"])
            const after = (await logged()).slice(2)
            expect(after.map(r => [r.action, r.userId, r.superAdminId, r.details.language, r.details.before, r.details.after])).toEqual([
                ["USE_NIZMO_CLIENT_MESSAGE", "a1", null, "AR", "نسختنا {person}", NIZMO_MESSAGES.contact.ar],
                ["USE_NIZMO_CLIENT_MESSAGE", "a1", null, "EN", "Ours {person}", NIZMO_MESSAGES.contact.en],
            ])
            expect(await templates.clientMessages("c1")).toEqual({ contact: NIZMO_MESSAGES.contact, claim: NIZMO_MESSAGES.claim })
        })

        it("puts back the one language that's the company's, and writes nothing for the one using Nizmo's", async () => {
            const en = await save("claim", "en", "Ours {number}")
            expect(await backAll("claim", { ar: null, en: en.changedAt })).toEqual([
                nizmos("claim", "ar", NIZMO_MESSAGES.claim.ar),
                putBack("claim", "en", NIZMO_MESSAGES.claim.en, "Amal One"),
            ])
            expect(await marks()).toEqual(["claim:en:true"])
            expect((await logged()).map(r => r.action)).toEqual(["UPDATE_CLIENT_MESSAGE", "USE_NIZMO_CLIENT_MESSAGE"])
        })

        it("puts back none where either language was changed, made or put back since the tab read it", async () => {
            const ar = await save("contact", "ar", "نسختنا {person}")
            const en = await save("contact", "en", "Ours {person}")
            // English changed since: Arabic stays the company's copy too.
            await save("contact", "en", "Ours again {person}", en.changedAt, SAM)
            expect(await refusal(backAll("contact", { ar: ar.changedAt, en: en.changedAt }))).toBe("MESSAGE_CHANGED_SINCE")
            expect(await marks()).toEqual(["contact:ar:false", "contact:en:false"])
            expect((await logged()).map(r => r.action)).toEqual(["UPDATE_CLIENT_MESSAGE", "UPDATE_CLIENT_MESSAGE", "UPDATE_CLIENT_MESSAGE"])
            // A copy made since in the language the tab read as Nizmo's.
            const claim = await save("claim", "ar", "نسختنا {number}")
            await save("claim", "en", "Made since {number}")
            expect(await refusal(backAll("claim", { ar: claim.changedAt, en: null }))).toBe("MESSAGE_CHANGED_SINCE")
            expect(await marks()).toEqual(["claim:ar:false", "claim:en:false", "contact:ar:false", "contact:en:false"])
        })

        it("writes nothing where both use Nizmo's already", async () => {
            expect(await backAll("contact", { ar: null, en: null })).toEqual([
                nizmos("contact", "ar", NIZMO_MESSAGES.contact.ar),
                nizmos("contact", "en", NIZMO_MESSAGES.contact.en),
            ])
            expect(await marks()).toEqual([])
            expect(await logged()).toEqual([])
        })

        it("by the Super Admin, kept by their name, and never another company's copy", async () => {
            const ar = await save("contact", "ar", "نسختنا {person}")
            await save("contact", "ar", "نسختهم {person}", null, { id: "a2", name: "Adel Two", role: "ADMIN" }, "c2")
            expect(await backAll("contact", { ar: ar.changedAt, en: null }, SAM)).toEqual([
                putBack("contact", "ar", NIZMO_MESSAGES.contact.ar, "Sam Admin"),
                nizmos("contact", "en", NIZMO_MESSAGES.contact.en),
            ])
            expect((await logged()).map(r => [r.action, r.superAdminId])).toEqual([["UPDATE_CLIENT_MESSAGE", null], ["UPDATE_CLIENT_MESSAGE", null], ["USE_NIZMO_CLIENT_MESSAGE", "sa"]])
            expect(await marks("c2")).toEqual(["contact:ar:false"])
        })

        it("is refused, writing nothing, for a company whose package hasn't the client portal, one with no package, and one that isn't there", async () => {
            await keep("c3", "contact", "en", "Before {person}", null, "Sam Admin")
            expect(await refusal(backAll("contact", { ar: null, en: null }, SAM, "c3"))).toBe("CLIENT_PORTAL_NOT_IN_PACKAGE")
            expect(await refusal(backAll("contact", { ar: null, en: null }, SAM, "c4"))).toBe("CLIENT_PORTAL_NOT_IN_PACKAGE")
            expect(await refusal(backAll("contact", { ar: null, en: null }, SAM, "gone"))).toBe("COMPANY_NOT_FOUND")
            expect(await marks("c3")).toEqual(["contact:en:false"])
            expect(await logged()).toEqual([])
        })
    })
})

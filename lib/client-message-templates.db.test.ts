import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest"
import { readFileSync, readdirSync } from "node:fs"
import { Client } from "pg"
import { NIZMO_MESSAGES } from "./client-message-template"

/**
 * The messages' templates as they're kept (CLIENT_PORTAL_PLAN.md §7.1, §12
 * steps 10a and 10b; PRs 346 and 347), against a real Postgres:
 * ClientMessageTemplate, what it refuses, each message once in each language
 * for Nizmo and for each company, what goes with a company or a person, the
 * texts a company's client's people are given, and Nizmo's as the Super
 * Admin keeps them.
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
})

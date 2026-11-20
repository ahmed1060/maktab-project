import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest"
import { readFileSync, readdirSync } from "node:fs"
import { Client } from "pg"
import { NIZMO_MESSAGES } from "./client-message-template"

/**
 * The messages' templates as they're kept (CLIENT_PORTAL_PLAN.md §7.1, §12
 * step 10a; PR 346), against a real Postgres: ClientMessageTemplate, what it
 * refuses, each message once in each language for Nizmo and for each
 * company, what goes with a company or a person, and the texts a company's
 * client's people are given.
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
        db = new Client({ connectionString: url.toString() })
        await db.connect()
        for (const m of MIGRATIONS) {
            await db.query(sql(m))
            if (m === "20260920000000_team_leader") await db.query(PEOPLE)
        }
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
})

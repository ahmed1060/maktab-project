import { describe, it, expect, beforeAll, afterAll, vi } from "vitest"
import { readFileSync, readdirSync } from "node:fs"
import { Client } from "pg"
import { builtInGrantsToken } from "@/lib/permissions/built-in"
import { serializeAccess } from "@/lib/features/bundles"
import { UserService } from "@/lib/services/user.service"
import { ClientService } from "@/lib/services/client.service"
import { CompanyService } from "@/lib/services/company.service"
import { ProfileService } from "@/lib/services/profile.service"
import { relearnSpellings, suggestWithSpellings } from "@/lib/services/name-spelling.service"
import { suggestName } from "@/lib/names/suggest"

/**
 * What the company saves teaches it (LATER_CHANGES_PLAN.md §3.1, step 3a,
 * PR 400), against a real Postgres built from the migrations: the company's
 * spellings, behind row-level security, worked out again from its names
 * whenever one is added, changed or deleted, by where it was saved, and
 * never in the way of a save. lib/names/spellings.test.ts has how a name is
 * paired, on its own.
 */

const ADMIN_URL = process.env.ROLES_TEST_DATABASE_URL
const MIGRATIONS = readdirSync("prisma/migrations").filter(m => m !== "migration_lock.toml").sort((a, b) => (a === "0_init" ? -1 : b === "0_init" ? 1 : a.localeCompare(b)))
const sql = (name: string) => readFileSync(`prisma/migrations/${name}/migration.sql`, "utf8")

// Before the roles, so the companies get their built-in ones as they would.
const BEFORE_ROLES = `
INSERT INTO "Company"(id, name, "updatedAt") VALUES ('c1', 'El Nil Accounting', now()), ('c2', 'Delta Office', now());
INSERT INTO "User"(id, email, password, "firstName", "lastName", role, "lastDayOffResetYear", username, "companyId") VALUES
 ('a1', 'a1@x', 'p', 'Amal', 'Fathy', 'ADMIN', 2026, 'a1', 'c1'),
 ('e1', 'e1@x', 'p', 'Omar', 'Adel', 'EMPLOYEE', 2026, 'e1', 'c1'),
 ('e2', 'e2@x', 'p', 'Karim', 'Saeed', 'EMPLOYEE', 2026, 'e2', 'c1'),
 ('b1', 'b1@x', 'p', 'Mona', 'Ali', 'ADMIN', 2026, 'b1', 'c2');
`

const as = (id: string, role: "ADMIN" | "EMPLOYEE", companyId = "c1") => ({
    user: { id, role, companyId, grants: builtInGrantsToken(role), featureAccess: serializeAccess({ unrestricted: true, bundles: new Set() }) },
})
const superAdmin = { user: { id: "sa1", role: "SUPER_ADMIN", companyId: null } } as any
const hq = { name: "HQ", latitude: 30.0444, longitude: 31.2357 }

describe.skipIf(!ADMIN_URL)("a company's spellings, in Postgres", () => {
    const dbName = `name_spellings_test_${Date.now()}`
    let db: Client

    beforeAll(async () => {
        const root = new Client({ connectionString: ADMIN_URL })
        await root.connect()
        // In UTF-8, as production's and the development database are.
        await root.query(`CREATE DATABASE ${dbName} ENCODING 'UTF8' LC_COLLATE 'C' LC_CTYPE 'C' TEMPLATE template0`)
        await root.end()
        const url = new URL(ADMIN_URL!)
        url.pathname = `/${dbName}`
        db = new Client({ connectionString: url.toString() })
        await db.connect()
        for (const m of MIGRATIONS) {
            await db.query(sql(m))
            if (m === "20260920000000_team_leader") await db.query(BEFORE_ROLES)
        }
        await db.query(`INSERT INTO "SuperAdmin"(id, email, password, "firstName", "lastName", username, "isProtected", "updatedAt") VALUES ('sa1', 'sa@x', 'p', 'Sam', 'Admin', 'sa1', true, now())`)
        process.env.POSTGRES_PRISMA_URL = url.toString()
    }, 180_000)

    afterAll(async () => {
        await (await import("@/lib/prisma")).prisma.$disconnect()
        await db?.end()
        const root = new Client({ connectionString: ADMIN_URL })
        await root.connect()
        await root.query(`DROP DATABASE IF EXISTS ${dbName}`)
        await root.end()
    })

    const spellings = async (companyId: string, source: string) =>
        (await db.query(`SELECT ar, en, uses FROM "NameSpelling" WHERE "companyId" = $1 AND source = $2 ORDER BY "arKey", "enKey"`, [companyId, source])).rows
    const person = async (id: string) => (await db.query(`SELECT "firstName", "lastName", "firstNameAr", "lastNameAr" FROM "User" WHERE id = $1`, [id])).rows[0]
    const refusal = (run: Promise<unknown>) => run.then(() => "saved", (error: Error & { code?: string }) => error.code ?? error.message)

    describe("the table", () => {
        it("is behind row-level security", async () => {
            const row = (await db.query(`SELECT relrowsecurity FROM pg_class WHERE relname = 'NameSpelling'`)).rows[0]
            expect(row.relrowsecurity).toBe(true)
        })

        it("keeps only where a spelling may be saved, and only one a name uses", async () => {
            const insert = (source: string, uses: number) => db.query(`INSERT INTO "NameSpelling"(id, "companyId", source, ar, "arKey", en, "enKey", uses, "updatedAt") VALUES (gen_random_uuid()::text, 'c1', $1, 'محمد', 'محمد', 'Mohamed', 'mohamed', $2, now())`, [source, uses])
            expect(await refusal(insert("somewhere", 1))).toBe("23514")
            expect(await refusal(insert("employee", 0))).toBe("23514")
            // Once for each company and where it was saved.
            await insert("employee", 1)
            expect(await refusal(insert("employee", 1))).toBe("23505")
            await insert("owner", 1)
            await db.query(`DELETE FROM "NameSpelling"`)
        })
    })

    describe("employees' names", () => {
        it("are learned when someone is added in both languages", async () => {
            await UserService.create({ firstName: "Mostafa", lastName: "Hassan", firstNameAr: "مصطفى", lastNameAr: "حسن", email: "m@x.co", password: "a".repeat(8) } as any, as("a1", "ADMIN"))
            expect(await spellings("c1", "employee")).toEqual([
                { ar: "حسن", en: "Hassan", uses: 1 },
                { ar: "مصطفى", en: "Mostafa", uses: 1 },
            ])
        })

        it("count each name that uses a spelling", async () => {
            await UserService.update({ id: "e1", firstNameAr: "عمر", lastName: "Hassan", lastNameAr: "حسن" } as any, as("a1", "ADMIN"))
            expect(await spellings("c1", "employee")).toEqual([
                { ar: "حسن", en: "Hassan", uses: 2 },
                { ar: "عمر", en: "Omar", uses: 1 },
                { ar: "مصطفى", en: "Mostafa", uses: 1 },
            ])
        })

        it("follow a name changed, in either language", async () => {
            await UserService.update({ id: "e1", lastName: "Hasan" } as any, as("a1", "ADMIN"))
            expect(await spellings("c1", "employee")).toEqual([
                { ar: "حسن", en: "Hasan", uses: 1 },
                { ar: "حسن", en: "Hassan", uses: 1 },
                { ar: "عمر", en: "Omar", uses: 1 },
                { ar: "مصطفى", en: "Mostafa", uses: 1 },
            ])
            // Only its capitals: the same spelling, written as it's written now.
            await UserService.update({ id: "e1", lastName: "HASAN" } as any, as("a1", "ADMIN"))
            expect(await spellings("c1", "employee")).toContainEqual({ ar: "حسن", en: "HASAN", uses: 1 })
            await UserService.update({ id: "e1", lastName: "Hasan" } as any, as("a1", "ADMIN"))
        })

        it("follow each of a person's four names changed alone", async () => {
            await UserService.update({ id: "e1", firstName: "Omer" } as any, as("a1", "ADMIN"))
            expect(await spellings("c1", "employee")).toContainEqual({ ar: "عمر", en: "Omer", uses: 1 })
            await UserService.update({ id: "e1", firstNameAr: "عمرو" } as any, as("a1", "ADMIN"))
            expect(await spellings("c1", "employee")).toContainEqual({ ar: "عمرو", en: "Omer", uses: 1 })
            await UserService.update({ id: "e1", lastNameAr: "حسين" } as any, as("a1", "ADMIN"))
            expect(await spellings("c1", "employee")).toContainEqual({ ar: "حسين", en: "Hasan", uses: 1 })
            await UserService.update({ id: "e1", firstName: "Omar", firstNameAr: "عمر", lastNameAr: "حسن" } as any, as("a1", "ADMIN"))
            expect(await spellings("c1", "employee")).toContainEqual({ ar: "عمر", en: "Omar", uses: 1 })
        })

        it("are written, where two are as often, as the one saved first has it", async () => {
            // Saved in the other order to the one they were made in.
            await db.query(`INSERT INTO "User"(id, email, password, "firstName", "lastName", "firstNameAr", "lastNameAr", role, "lastDayOffResetYear", username, "companyId", "roleId")
                SELECT 'zz', 'zz@x', 'p', 'NOUR', 'Samy', 'نور', NULL, 'EMPLOYEE', 2026, 'zz', 'c1', "roleId" FROM "User" WHERE id = 'e1'`)
            await db.query(`INSERT INTO "User"(id, email, password, "firstName", "lastName", "firstNameAr", "lastNameAr", role, "lastDayOffResetYear", username, "companyId", "roleId")
                SELECT 'aa', 'aa@x', 'p', 'Nour', 'Samy', 'نور', NULL, 'EMPLOYEE', 2026, 'aa', 'c1', "roleId" FROM "User" WHERE id = 'e1'`)
            await relearnSpellings("c1", ["employee"])
            expect(await spellings("c1", "employee")).toContainEqual({ ar: "نور", en: "Nour", uses: 2 })
            await db.query(`DELETE FROM "User" WHERE id IN ('zz', 'aa')`)
            await relearnSpellings("c1", ["employee"])
        })

        it("follow a change to one's own name, approved", async () => {
            await UserService.update({ id: "e2", firstNameAr: "كريم", lastNameAr: "سعيد" } as any, as("a1", "ADMIN"))
            await db.query(`INSERT INTO "ProfileUpdateRequest"(id, "userId", "oldFirstName", "oldLastName", "newFirstName", "newLastName", status, "updatedAt") VALUES ('p1', 'e2', 'Karim', 'Saeed', 'Kareem', 'Saeed', 'PENDING', now())`)
            await ProfileService.approveRequest("p1", "", as("a1", "ADMIN"))
            const learned = await spellings("c1", "employee")
            expect(learned).toContainEqual({ ar: "كريم", en: "Kareem", uses: 1 })
            expect(learned).not.toContainEqual(expect.objectContaining({ en: "Karim" }))
        })

        it("go when someone is deleted, with their names in Arabic", async () => {
            await UserService.delete("e2", as("a1", "ADMIN"))
            expect(await person("e2")).toMatchObject({ firstNameAr: null, lastNameAr: null })
            const learned = await spellings("c1", "employee")
            expect(learned).not.toContainEqual(expect.objectContaining({ ar: "كريم" }))
            expect(learned).not.toContainEqual(expect.objectContaining({ ar: "سعيد" }))
        })

        it("aren't learned from someone deleted, however their names got there", async () => {
            await db.query(`INSERT INTO "User"(id, email, password, "firstName", "lastName", "firstNameAr", "lastNameAr", role, status, "lastDayOffResetYear", username, "companyId", "roleId")
                SELECT 'gone', 'gone@x', 'p', 'Ghost', 'User', 'هاني', 'رمزي', 'EMPLOYEE', 'DELETED', 2026, 'gone', 'c1', "roleId" FROM "User" WHERE id = 'e1'`)
            await relearnSpellings("c1", ["employee"])
            expect(await spellings("c1", "employee")).not.toContainEqual(expect.objectContaining({ en: "Ghost" }))
        })

        it("are one company's, and not another's", async () => {
            expect(await spellings("c2", "employee")).toEqual([])
            await UserService.update({ id: "b1", firstNameAr: "منى", lastNameAr: "علي" } as any, as("b1", "ADMIN", "c2"))
            expect(await spellings("c2", "employee")).toEqual([{ ar: "علي", en: "Ali", uses: 1 }, { ar: "منى", en: "Mona", uses: 1 }])
            expect(await spellings("c1", "employee")).not.toContainEqual(expect.objectContaining({ en: "Mona" }))
        })
    })

    describe("clients' names and their owners'", () => {
        let kept: string
        let deleted: string

        it("are learned when a client is added in both languages, each where it was saved", async () => {
            kept = (await ClientService.create({ name: "El Nour Trading", nameAr: "النور للتجارة", ownerName: "Mahmoud Ali", ownerNameAr: "محمود علي", mobileNumber: "01001234571", hq } as any, as("a1", "ADMIN"))).id
            deleted = (await ClientService.create({ name: "Zaytouna Foods", nameAr: "زيتونة للأغذية", ownerName: "Sara Adel", ownerNameAr: "سارة عادل", mobileNumber: "01001234572", hq } as any, as("a1", "ADMIN"))).id
            expect(await spellings("c1", "client")).toEqual([{ ar: "النور", en: "El Nour", uses: 1 }, { ar: "زيتونة", en: "Zaytouna", uses: 1 }])
            expect(await spellings("c1", "owner")).toEqual([
                { ar: "سارة", en: "Sara", uses: 1 },
                { ar: "عادل", en: "Adel", uses: 1 },
                { ar: "علي", en: "Ali", uses: 1 },
                { ar: "محمود", en: "Mahmoud", uses: 1 },
            ])
        })

        it("follow a client's names changed", async () => {
            await ClientService.update({ id: kept, ownerName: "Mahmoud Aly" } as any, as("a1", "ADMIN"))
            expect(await spellings("c1", "owner")).toContainEqual({ ar: "علي", en: "Aly", uses: 1 })
            expect(await spellings("c1", "owner")).not.toContainEqual(expect.objectContaining({ en: "Ali" }))
        })

        it("are written, where two are as often, as the one saved first has it", async () => {
            // Saved in the other order to the one they were made in. A
            // client's Arabic name is its own in the company; its owner's isn't.
            await db.query(`INSERT INTO "Client"(id, "companyId", name, "ownerName", "nameAr", "ownerNameAr", "mobileNumber", "locationName", "updatedAt") VALUES
                ('zz', 'c1', 'Baraka', 'SAMY', NULL, 'سامي', '01001234575', 'HQ', now()),
                ('aa', 'c1', 'Rahma', 'Samy', NULL, 'سامي', '01001234576', 'HQ', now())`)
            await relearnSpellings("c1", ["owner"])
            expect(await spellings("c1", "owner")).toContainEqual({ ar: "سامي", en: "Samy", uses: 2 })
            await db.query(`DELETE FROM "Client" WHERE id IN ('zz', 'aa')`)
            await relearnSpellings("c1", ["owner"])
        })

        it("stay while a client is archived, and go when it's deleted", async () => {
            await ClientService.delete(kept, as("a1", "ADMIN"), { archive: true })
            expect(await spellings("c1", "client")).toContainEqual({ ar: "النور", en: "El Nour", uses: 1 })
            await ClientService.delete(deleted, as("a1", "ADMIN"))
            expect(await spellings("c1", "client")).toEqual([{ ar: "النور", en: "El Nour", uses: 1 }])
            expect(await spellings("c1", "owner")).not.toContainEqual(expect.objectContaining({ en: "Sara" }))
        })
    })

    describe("the company's name", () => {
        it("is learned when it's changed, or a company is added, in both languages", async () => {
            await CompanyService.update({ id: "c1", nameAr: "مكتب النيل للمحاسبة" } as any, superAdmin)
            expect(await spellings("c1", "company")).toEqual([{ ar: "النيل", en: "El Nil", uses: 1 }])
            const made = await CompanyService.create({ name: "El Amal Office", nameAr: "مكتب الأمل" } as any, superAdmin)
            expect(await spellings(made.id, "company")).toEqual([{ ar: "الأمل", en: "El Amal", uses: 1 }])
        })
    })

    describe("read for a name's suggestion (step 3b, PR 401)", () => {
        beforeAll(async () => {
            // With its built-in roles, as a company is made.
            const made = await CompanyService.create({ name: "Read Office" } as any, superAdmin)
            await db.query(`UPDATE "Company" SET id = 'c9' WHERE id = $1`, [made.id])
            const person = (id: string, first: string, firstAr: string, last: string, lastAr: string | null) => db.query(
                `INSERT INTO "User"(id, email, password, "firstName", "lastName", "firstNameAr", "lastNameAr", role, "lastDayOffResetYear", username, "companyId", "roleId")
                 SELECT $1, $1 || '@x', 'p', $2, $4, $3, $5, 'EMPLOYEE', 2026, $1, 'c9', id FROM "Role" WHERE "companyId" = 'c9' AND "builtIn" = 'EMPLOYEE'`, [id, first, firstAr, last, lastAr])
            await person("r1", "Mohammed", "محمد", "Karmozika", "كرمو زيكا")
            await person("r2", "Mohammed", "محمد", "Samy", null)
            await person("r3", "Mohamed", "محمد", "Samy", null)
            await db.query(`INSERT INTO "Client"(id, "companyId", name, "ownerName", "nameAr", "ownerNameAr", "mobileNumber", "locationName", "updatedAt") VALUES
                ('r4', 'c9', 'Zaytouna Trading', 'MOHAMED', 'زيتونة للتجارة', 'محمد', '01001234577', 'HQ', now()),
                ('r5', 'c9', 'Baraka', 'MOHAMED', NULL, 'محمد', '01001234578', 'HQ', now())`)
            await relearnSpellings("c9", ["employee", "client", "owner", "company"])
        })
        const person = { to: "en", kind: "person" } as const

        it("has the company's spellings first, the most used first, then the usual one where it isn't one of them", async () => {
            const name = await suggestWithSpellings("c9", "محمد", person, ["employee"])
            expect(name?.words).toEqual([{ text: "Mohammed", from: "company", uses: 2, others: [{ text: "Mohamed", from: "company", uses: 1 }] }])
        })

        it("counts a spelling saved in two places as one, written as the place that uses it most writes it", async () => {
            const name = await suggestWithSpellings("c9", "محمد", person, ["employee", "owner"])
            expect(name?.words).toEqual([{ text: "MOHAMED", from: "company", uses: 3, others: [{ text: "Mohammed", from: "company", uses: 2 }] }])
        })

        it("learns only from where the asker may", async () => {
            const business = { to: "en", kind: "business" } as const
            expect((await suggestWithSpellings("c9", "زيتونة", business, ["company"]))?.words).toEqual([{ text: "Zitona", from: "rules" }])
            expect((await suggestWithSpellings("c9", "زيتونة", business, ["company", "client"]))?.words).toEqual([{ text: "Zaytouna", from: "company", uses: 1, others: [] }])
        })

        it("reads a spelling learned whole, of several words, and either way round", async () => {
            expect((await suggestWithSpellings("c9", "محمد كرمو زيكا", person, ["employee"]))?.text).toBe("Mohammed Karmozika")
            const back = await suggestWithSpellings("c9", "Mohammed Karmozika", { to: "ar", kind: "person" }, ["employee"])
            expect(back?.words).toEqual([{ text: "محمد", from: "company", uses: 2, others: [] }, { text: "كرمو زيكا", from: "company", uses: 1, others: [] }])
        })

        it("is one company's, and is Nizmo's alone with no company or nowhere to learn from", async () => {
            expect(await suggestWithSpellings("c1", "كرمو زيكا", person, ["employee"])).toEqual(suggestName("كرمو زيكا", person))
            expect(await suggestWithSpellings(null, "محمد", person, ["employee"])).toEqual(suggestName("محمد", person))
            expect(await suggestWithSpellings("c9", "محمد", person, [])).toEqual(suggestName("محمد", person))
            expect(await suggestWithSpellings("c9", "Mohamed", person, ["employee"])).toBeNull()
        })
    })

    describe("learning", () => {
        it("never stops a name from being saved, and is caught up by the next save", async () => {
            const said = vi.spyOn(console, "error").mockImplementation(() => {})
            await db.query(`ALTER TABLE "NameSpelling" RENAME TO "NameSpellingAway"`)
            try {
                await UserService.update({ id: "e1", firstName: "Omer" } as any, as("a1", "ADMIN"))
            } finally {
                await db.query(`ALTER TABLE "NameSpellingAway" RENAME TO "NameSpelling"`)
            }
            expect(await person("e1")).toMatchObject({ firstName: "Omer" })
            expect(said).toHaveBeenCalled()
            said.mockRestore()
            expect(await spellings("c1", "employee")).toContainEqual({ ar: "عمر", en: "Omar", uses: 1 })
            await UserService.update({ id: "a1", firstNameAr: "أمل" } as any, as("a1", "ADMIN"))
            const learned = await spellings("c1", "employee")
            expect(learned).toContainEqual({ ar: "عمر", en: "Omer", uses: 1 })
            expect(learned).not.toContainEqual(expect.objectContaining({ en: "Omar" }))
            expect(learned).toContainEqual({ ar: "أمل", en: "Amal", uses: 1 })
        })

        it("worked out several times at once, leaves the spellings as the names have them", async () => {
            const before = await spellings("c1", "employee")
            await db.query(`DELETE FROM "NameSpelling" WHERE "companyId" = 'c1'`)
            await Promise.all(Array.from({ length: 6 }, () => relearnSpellings("c1", ["employee", "client", "owner", "company"])))
            expect(await spellings("c1", "employee")).toEqual(before)
            expect(await spellings("c1", "company")).toEqual([{ ar: "النيل", en: "El Nil", uses: 1 }])
        })

        it("leaves a company's spellings to go with it", async () => {
            const made = await CompanyService.create({ name: "El Safa Office", nameAr: "مكتب الصفا" } as any, superAdmin)
            expect(await spellings(made.id, "company")).toHaveLength(1)
            await db.query(`DELETE FROM "Role" WHERE "companyId" = $1`, [made.id])
            await db.query(`DELETE FROM "Company" WHERE id = $1`, [made.id])
            expect(await spellings(made.id, "company")).toEqual([])
        })
    })
})

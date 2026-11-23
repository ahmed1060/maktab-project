import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { readFileSync, readdirSync } from "node:fs"
import { Client } from "pg"
import { builtInGrantsToken } from "@/lib/permissions/built-in"
import { serializeAccess } from "@/lib/features/bundles"
import { UserService } from "@/lib/services/user.service"
import { ClientService } from "@/lib/services/client.service"
import { CompanyService } from "@/lib/services/company.service"
import { ProfileService } from "@/lib/services/profile.service"

/**
 * English and Arabic names kept (LATER_CHANGES_PLAN.md §3, step 1, PR 398),
 * against a real Postgres built from the migrations: an Arabic column beside
 * each name, the names written in Arabic before copied into it with nothing
 * else moved, an Arabic name unique where its English one is, and the
 * services keeping the Arabic names they're given. lib/names.test.ts has
 * the rules on their own.
 */

const ADMIN_URL = process.env.ROLES_TEST_DATABASE_URL
const MIGRATIONS = readdirSync("prisma/migrations").filter(m => m !== "migration_lock.toml").sort((a, b) => (a === "0_init" ? -1 : b === "0_init" ? 1 : a.localeCompare(b)))
const sql = (name: string) => readFileSync(`prisma/migrations/${name}/migration.sql`, "utf8")
const NAMES_IN_ARABIC = "20270119000000_names_in_arabic"

// Before the roles, so the companies get their built-in ones as they would.
const BEFORE_ROLES = `
INSERT INTO "Company"(id, name, "updatedAt") VALUES ('c1', 'El Nil Accounting', now()), ('c2', 'مكتب الأمل', now());
INSERT INTO "User"(id, email, password, "firstName", "lastName", role, "lastDayOffResetYear", username, "companyId") VALUES
 ('a1', 'a1@x', 'p', 'Amal', 'Fathy', 'ADMIN', 2026, 'a1', 'c1'),
 ('e1', 'e1@x', 'p', 'هالة', 'منصور', 'EMPLOYEE', 2026, 'e1', 'c1'),
 ('e2', 'e2@x', 'p', 'Karim', 'سعيد', 'EMPLOYEE', 2026, 'e2', 'c1'),
 ('e3', 'e3@x', 'p', 'Omar', 'Adel', 'EMPLOYEE', 2026, 'e3', 'c1');
`
// Just before the Arabic columns: clients as they were saved until today.
const BEFORE_ARABIC = `
INSERT INTO "Client"(id, "companyId", name, "ownerName", "mobileNumber", "locationName", "updatedAt") VALUES
 ('k1', 'c1', 'شركة النور للتجارة', 'محمود عبد الله', '01001234567', 'HQ', now()),
 ('k2', 'c1', 'Delta Sites', 'Sara Mahmoud', '01001234568', 'HQ', now()),
 ('k3', 'c2', 'شركة النور للتجارة', 'Hassan Ali', '01001234569', 'HQ', now());
`

const as = (id: string, role: "ADMIN" | "EMPLOYEE") => ({
    user: { id, role, companyId: "c1", grants: builtInGrantsToken(role), featureAccess: serializeAccess({ unrestricted: true, bundles: new Set() }) },
})
const superAdmin = { user: { id: "sa1", role: "SUPER_ADMIN", companyId: null } } as any

describe.skipIf(!ADMIN_URL)("English and Arabic names, in Postgres", () => {
    const dbName = `names_both_languages_test_${Date.now()}`
    let db: Client

    beforeAll(async () => {
        const root = new Client({ connectionString: ADMIN_URL })
        await root.connect()
        // In UTF-8, as production's and the development database are: the
        // copy reads letters by their code points.
        await root.query(`CREATE DATABASE ${dbName} ENCODING 'UTF8' LC_COLLATE 'C' LC_CTYPE 'C' TEMPLATE template0`)
        await root.end()
        const url = new URL(ADMIN_URL!)
        url.pathname = `/${dbName}`
        db = new Client({ connectionString: url.toString() })
        await db.connect()
        for (const m of MIGRATIONS) {
            if (m === NAMES_IN_ARABIC) await db.query(BEFORE_ARABIC)
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

    const person = async (id: string) => (await db.query(`SELECT "firstName", "lastName", "firstNameAr", "lastNameAr" FROM "User" WHERE id = $1`, [id])).rows[0]
    const client = async (id: string) => (await db.query(`SELECT name, "ownerName", "nameAr", "ownerNameAr" FROM "Client" WHERE id = $1`, [id])).rows[0]
    const company = async (id: string) => (await db.query(`SELECT name, "nameAr" FROM "Company" WHERE id = $1`, [id])).rows[0]
    const refusal = (run: Promise<unknown>) => run.then(() => "saved", (error: Error & { code?: string }) => error.code ?? error.message)

    describe("the names saved before", () => {
        it("are copied into their Arabic columns where they're written in Arabic, and stay where they are", async () => {
            expect(await person("e1")).toEqual({ firstName: "هالة", lastName: "منصور", firstNameAr: "هالة", lastNameAr: "منصور" })
            // Each name on its own: an English first name has no Arabic yet.
            expect(await person("e2")).toEqual({ firstName: "Karim", lastName: "سعيد", firstNameAr: null, lastNameAr: "سعيد" })
            expect(await person("a1")).toEqual({ firstName: "Amal", lastName: "Fathy", firstNameAr: null, lastNameAr: null })
            expect(await client("k1")).toEqual({ name: "شركة النور للتجارة", ownerName: "محمود عبد الله", nameAr: "شركة النور للتجارة", ownerNameAr: "محمود عبد الله" })
            expect(await client("k2")).toEqual({ name: "Delta Sites", ownerName: "Sara Mahmoud", nameAr: null, ownerNameAr: null })
            expect(await company("c1")).toEqual({ name: "El Nil Accounting", nameAr: null })
            expect(await company("c2")).toEqual({ name: "مكتب الأمل", nameAr: "مكتب الأمل" })
        })
    })

    describe("an Arabic name, unique where its English one is", () => {
        it("is one client's in its company, as two companies' clients may share it", async () => {
            // k3, another company's, has the same Arabic name as k1.
            expect((await client("k3")).nameAr).toBe("شركة النور للتجارة")
            const write = db.query(`UPDATE "Client" SET "nameAr" = 'شركة النور للتجارة' WHERE id = 'k2'`)
            expect(await refusal(write)).toBe("23505")
            // Any number without one.
            await db.query(`INSERT INTO "Client"(id, "companyId", name, "ownerName", "mobileNumber", "locationName", "updatedAt") VALUES ('k4', 'c1', 'Nile Foods', 'Ola Samy', '01001234570', 'HQ', now())`)
            expect((await client("k4")).nameAr).toBeNull()
        })

        it("is one company's across Nizmo", async () => {
            const write = db.query(`UPDATE "Company" SET "nameAr" = 'مكتب الأمل' WHERE id = 'c1'`)
            expect(await refusal(write)).toBe("23505")
        })
    })

    describe("a person's Arabic names", () => {
        it("are kept when someone is added with them", async () => {
            const created = await UserService.create({ firstName: "Mostafa", lastName: "Hassan", firstNameAr: "مصطفى", lastNameAr: "حسن", email: "m@x.co", password: "a".repeat(8) } as any, as("a1", "ADMIN"))
            expect(await person(created.id)).toEqual({ firstName: "Mostafa", lastName: "Hassan", firstNameAr: "مصطفى", lastNameAr: "حسن" })
        })

        it("are the names themselves for someone added with names in Arabic, by a form that asks for one name only", async () => {
            const created = await UserService.create({ firstName: "سارة", lastName: "Mahmoud", email: "s@x.co", password: "a".repeat(8) } as any, as("a1", "ADMIN"))
            expect(await person(created.id)).toEqual({ firstName: "سارة", lastName: "Mahmoud", firstNameAr: "سارة", lastNameAr: null })
            const other = await UserService.create({ firstName: "Nour", lastName: "حسن", email: "n@x.co", password: "a".repeat(8) } as any, as("a1", "ADMIN"))
            expect(await person(other.id)).toEqual({ firstName: "Nour", lastName: "حسن", firstNameAr: null, lastNameAr: "حسن" })
        })

        it("are changed by whoever may edit their profile", async () => {
            await UserService.update({ id: "e3", firstNameAr: "عمر", lastNameAr: "عادل" } as any, as("a1", "ADMIN"))
            expect(await person("e3")).toEqual({ firstName: "Omar", lastName: "Adel", firstNameAr: "عمر", lastNameAr: "عادل" })
            const logged = (await db.query(`SELECT details FROM "AuditLog" WHERE "entityId" = 'e3' AND action = 'UPDATE_USER'`)).rows
            expect(logged.at(-1).details).toEqual({ firstNameAr: { old: null, new: "عمر" }, lastNameAr: { old: null, new: "عادل" } })
        })

        it("follow a name changed in Arabic by a form that asks for one name only, and stay with one changed in English", async () => {
            await UserService.update({ id: "e1", firstName: "هلا" } as any, as("a1", "ADMIN"))
            expect(await person("e1")).toMatchObject({ firstName: "هلا", firstNameAr: "هلا" })
            await UserService.update({ id: "e1", firstName: "Hala" } as any, as("a1", "ADMIN"))
            expect(await person("e1")).toMatchObject({ firstName: "Hala", firstNameAr: "هلا" })
            await UserService.update({ id: "e1", lastName: "منصور علي" } as any, as("a1", "ADMIN"))
            expect(await person("e1")).toMatchObject({ lastName: "منصور علي", lastNameAr: "منصور علي" })
        })

        it("aren't changed by an employee on their own profile, as their names aren't", async () => {
            expect(await refusal(UserService.update({ id: "e3", firstNameAr: "عمرو" } as any, as("e3", "EMPLOYEE")))).toBe("NAME_CHANGE_REQUIRES_ADMIN")
            expect(await refusal(UserService.update({ id: "e3", lastNameAr: "عادلي" } as any, as("e3", "EMPLOYEE")))).toBe("NAME_CHANGE_REQUIRES_ADMIN")
            expect(await person("e3")).toMatchObject({ firstNameAr: "عمر", lastNameAr: "عادل" })
            // The ones they have, sent back with the rest of the profile, are no change.
            await UserService.update({ id: "e3", firstNameAr: "عمر", lastNameAr: "عادل", gender: "MALE" } as any, as("e3", "EMPLOYEE"))
        })

        it("follow a change to one's own name, approved in Arabic", async () => {
            const request = await db.query(`INSERT INTO "ProfileUpdateRequest"(id, "userId", "oldFirstName", "oldLastName", "newFirstName", "newLastName", status, "updatedAt") VALUES ('p1', 'e2', 'Karim', 'سعيد', 'كريم', 'سعيد علي', 'PENDING', now()) RETURNING id`)
            await ProfileService.approveRequest(request.rows[0].id, "", as("a1", "ADMIN"))
            expect(await person("e2")).toEqual({ firstName: "كريم", lastName: "سعيد علي", firstNameAr: "كريم", lastNameAr: "سعيد علي" })
        })

        it("aren't a Super Admin's, whose name is kept once", async () => {
            await UserService.update({ id: "sa1", firstName: "Samy", firstNameAr: "سامي" } as any, superAdmin)
            const row = (await db.query(`SELECT "firstName" FROM "SuperAdmin" WHERE id = 'sa1'`)).rows[0]
            expect(row.firstName).toBe("Samy")
        })
    })

    describe("a client's and a company's Arabic names", () => {
        it("are kept when a client is added with them, or with its name in Arabic", async () => {
            const hq = { name: "HQ", latitude: 30.0444, longitude: 31.2357 }
            const one = await ClientService.create({ name: "Misr Trading", ownerName: "Ola Samy", nameAr: "مصر للتجارة", ownerNameAr: "علا سامي", mobileNumber: "01001234571", hq } as any, as("a1", "ADMIN"))
            expect(await client(one.id)).toEqual({ name: "Misr Trading", ownerName: "Ola Samy", nameAr: "مصر للتجارة", ownerNameAr: "علا سامي" })
            const two = await ClientService.create({ name: "مكتب الفاروق", ownerName: "Tarek Nabil", mobileNumber: "01001234572", hq } as any, as("a1", "ADMIN"))
            expect(await client(two.id)).toEqual({ name: "مكتب الفاروق", ownerName: "Tarek Nabil", nameAr: "مكتب الفاروق", ownerNameAr: null })
            const three = await ClientService.create({ name: "Giza Foods", ownerName: "طارق نبيل", mobileNumber: "01001234573", hq } as any, as("a1", "ADMIN"))
            expect(await client(three.id)).toEqual({ name: "Giza Foods", ownerName: "طارق نبيل", nameAr: null, ownerNameAr: "طارق نبيل" })
        })

        it("are changed with a client's details", async () => {
            await ClientService.update({ id: "k2", nameAr: "دلتا سايتس", ownerNameAr: "سارة محمود" } as any, as("a1", "ADMIN"))
            expect(await client("k2")).toEqual({ name: "Delta Sites", ownerName: "Sara Mahmoud", nameAr: "دلتا سايتس", ownerNameAr: "سارة محمود" })
            await ClientService.update({ id: "k2", ownerName: "سارة أحمد" } as any, as("a1", "ADMIN"))
            expect(await client("k2")).toMatchObject({ ownerName: "سارة أحمد", ownerNameAr: "سارة أحمد" })
            await ClientService.update({ id: "k4", name: "نايل فودز" } as any, as("a1", "ADMIN"))
            expect(await client("k4")).toMatchObject({ name: "نايل فودز", nameAr: "نايل فودز" })
        })

        it("are kept when a company is added or changed with one", async () => {
            const made = await CompanyService.create({ name: "El Amal Office", nameAr: "مكتب الآمال" } as any, superAdmin)
            expect(await company(made.id)).toEqual({ name: "El Amal Office", nameAr: "مكتب الآمال" })
            await CompanyService.update({ id: "c1", nameAr: "مكتب النيل للمحاسبة" } as any, superAdmin)
            expect(await company("c1")).toEqual({ name: "El Nil Accounting", nameAr: "مكتب النيل للمحاسبة" })
            const arabic = await CompanyService.create({ name: "مكتب الصفا" } as any, superAdmin)
            expect(await company(arabic.id)).toEqual({ name: "مكتب الصفا", nameAr: "مكتب الصفا" })
            await CompanyService.update({ id: made.id, name: "مكتب الأمل الجديد" } as any, superAdmin)
            expect(await company(made.id)).toEqual({ name: "مكتب الأمل الجديد", nameAr: "مكتب الأمل الجديد" })
        })

        it("are in the company's audit log when changed alone, as its name is (Codex review on PR 398)", async () => {
            await CompanyService.update({ id: "c1", nameAr: "مكتب النيل" } as any, superAdmin)
            const logged = (await db.query(`SELECT details FROM "AuditLog" WHERE "entityId" = 'c1' AND action = 'UPDATE_COMPANY' ORDER BY "createdAt"`)).rows
            expect(logged.at(-1).details).toEqual({ nameAr: { old: "مكتب النيل للمحاسبة", new: "مكتب النيل" } })
            // The same again is no change, and isn't logged.
            await CompanyService.update({ id: "c1", nameAr: "مكتب النيل" } as any, superAdmin)
            expect((await db.query(`SELECT count(*)::int AS n FROM "AuditLog" WHERE "entityId" = 'c1' AND action = 'UPDATE_COMPANY'`)).rows[0].n).toBe(logged.length)
        })
    })

    describe("a name saved before in Arabic, its Arabic corrected since (Codex review on PR 398)", () => {
        // مني in the column there before, as it was typed; منى its Arabic, as corrected.
        beforeAll(async () => {
            await db.query(`INSERT INTO "User"(id, email, password, "firstName", "lastName", "firstNameAr", "lastNameAr", role, "lastDayOffResetYear", username, "companyId", "roleId")
                SELECT 'e4', 'e4@x', 'p', 'مني', 'Adel', 'منى', NULL, 'EMPLOYEE', 2026, 'legacy-e4', 'c1', "roleId" FROM "User" WHERE id = 'e3'`)
            await db.query(`INSERT INTO "User"(id, email, password, "firstName", "lastName", "firstNameAr", "lastNameAr", role, "lastDayOffResetYear", username, "companyId", "roleId")
                SELECT 'e5', 'e5@x', 'p', 'سامي', 'Nabil', NULL, NULL, 'EMPLOYEE', 2026, 'legacy-e5', 'c1', "roleId" FROM "User" WHERE id = 'e3'`)
            await db.query(`INSERT INTO "Client"(id, "companyId", name, "ownerName", "nameAr", "ownerNameAr", "mobileNumber", "locationName", "updatedAt") VALUES ('k5', 'c1', 'مكتب مني', 'مني', 'مكتب منى', 'منى', '01001234574', 'HQ', now())`)
            await db.query(`INSERT INTO "Company"(id, name, "nameAr", "updatedAt") VALUES ('c3', 'مكتب مني', 'مكتب منى', now())`)
        })

        it("keeps its Arabic when the name comes back unchanged with the rest of a profile", async () => {
            await UserService.update({ id: "e4", firstName: "مني", lastName: "Adel", gender: "FEMALE" } as any, as("a1", "ADMIN"))
            expect(await person("e4")).toMatchObject({ firstName: "مني", firstNameAr: "منى" })
        })

        it("keeps it from the person's own profile too, which may not change it", async () => {
            await UserService.update({ id: "e4", firstName: "مني", lastName: "Adel" } as any, as("e4", "EMPLOYEE"))
            expect(await person("e4")).toMatchObject({ firstName: "مني", firstNameAr: "منى" })
        })

        it("gets its Arabic from the name itself where it has none yet", async () => {
            await UserService.update({ id: "e5", firstName: "سامي", lastName: "Nabil" } as any, as("e5", "EMPLOYEE"))
            expect(await person("e5")).toMatchObject({ firstName: "سامي", firstNameAr: "سامي" })
        })

        it("keeps it when a name change is approved that leaves this name as it is", async () => {
            const request = await db.query(`INSERT INTO "ProfileUpdateRequest"(id, "userId", "oldFirstName", "oldLastName", "newFirstName", "newLastName", status, "updatedAt") VALUES ('p2', 'e4', 'مني', 'Adel', 'مني', 'عادل', 'PENDING', now()) RETURNING id`)
            await ProfileService.approveRequest(request.rows[0].id, "", as("a1", "ADMIN"))
            expect(await person("e4")).toEqual({ firstName: "مني", lastName: "عادل", firstNameAr: "منى", lastNameAr: "عادل" })
        })

        it("keeps a last name's too, from a profile and from an approved change", async () => {
            await UserService.update({ id: "e4", lastNameAr: "عادلي" } as any, as("a1", "ADMIN"))
            await UserService.update({ id: "e4", firstName: "مني", lastName: "عادل" } as any, as("a1", "ADMIN"))
            expect(await person("e4")).toEqual({ firstName: "مني", lastName: "عادل", firstNameAr: "منى", lastNameAr: "عادلي" })
            const request = await db.query(`INSERT INTO "ProfileUpdateRequest"(id, "userId", "oldFirstName", "oldLastName", "newFirstName", "newLastName", status, "updatedAt") VALUES ('p3', 'e4', 'مني', 'عادل', 'منى', 'عادل', 'PENDING', now()) RETURNING id`)
            await ProfileService.approveRequest(request.rows[0].id, "", as("a1", "ADMIN"))
            expect(await person("e4")).toEqual({ firstName: "منى", lastName: "عادل", firstNameAr: "منى", lastNameAr: "عادلي" })
        })

        it("keeps a client's when its names come back unchanged", async () => {
            await ClientService.update({ id: "k5", name: "مكتب مني", ownerName: "مني" } as any, as("a1", "ADMIN"))
            expect(await client("k5")).toEqual({ name: "مكتب مني", ownerName: "مني", nameAr: "مكتب منى", ownerNameAr: "منى" })
        })

        it("keeps a company's when its name comes back unchanged", async () => {
            await CompanyService.update({ id: "c3", name: "مكتب مني" } as any, superAdmin)
            expect(await company("c3")).toEqual({ name: "مكتب مني", nameAr: "مكتب منى" })
        })
    })
})

import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { readFileSync, readdirSync } from "node:fs"
import { Client } from "pg"
import { builtInGrantsToken } from "@/lib/permissions/built-in"
import { serializeAccess, type Bundle } from "@/lib/features/bundles"
import { UserService } from "@/lib/services/user.service"

/**
 * A person's WhatsApp number, for their clients (CLIENT_PORTAL_PLAN.md §7,
 * §12 step 9a; DESIGN.md §5.5; PR 340): saved with the profile, by them or
 * by whoever may edit their profile, kept with its country code, and only
 * where the company's package has the client portal. Against a real
 * Postgres built from the migrations.
 */

const ADMIN_URL = process.env.ROLES_TEST_DATABASE_URL
const MIGRATIONS = readdirSync("prisma/migrations").filter(m => m !== "migration_lock.toml").sort((a, b) => (a === "0_init" ? -1 : b === "0_init" ? 1 : a.localeCompare(b)))
const sql = (name: string) => readFileSync(`prisma/migrations/${name}/migration.sql`, "utf8")

// Before the roles, so the companies get their built-in ones as they would.
const BEFORE_ROLES = `
INSERT INTO "Company"(id, name, "updatedAt") VALUES ('c1', 'One', now()), ('c2', 'Two', now());
INSERT INTO "User"(id, email, password, "firstName", "lastName", role, "lastDayOffResetYear", username, "companyId") VALUES
 ('a1', 'a1@x', 'p', 'Amal', 'One', 'ADMIN', 2026, 'a1', 'c1'),
 ('e1', 'e1@x', 'p', 'Ehab', 'One', 'EMPLOYEE', 2026, 'e1', 'c1'),
 ('e2', 'e2@x', 'p', 'Eman', 'One', 'EMPLOYEE', 2026, 'e2', 'c1'),
 ('x1', 'x1@x', 'p', 'Xena', 'Two', 'EMPLOYEE', 2026, 'x1', 'c2');
`

const PORTAL: Bundle[] = ["COMPANY_MANAGEMENT", "CLIENT_PORTAL"]
/** One of company c1's people, of this kind, under a package of these bundles. */
const as = (id: string, role: "ADMIN" | "EMPLOYEE", bundles: Bundle[] = PORTAL) => ({
    user: { id, role, companyId: "c1", grants: builtInGrantsToken(role), featureAccess: serializeAccess({ unrestricted: false, bundles: new Set(bundles) }) },
})

describe.skipIf(!ADMIN_URL)("a person's WhatsApp number, saved with their profile, in Postgres", () => {
    const dbName = `whatsapp_number_test_${Date.now()}`
    let db: Client

    beforeAll(async () => {
        const root = new Client({ connectionString: ADMIN_URL })
        await root.connect()
        await root.query(`CREATE DATABASE ${dbName}`)
        await root.end()
        const url = new URL(ADMIN_URL!)
        url.pathname = `/${dbName}`
        db = new Client({ connectionString: url.toString() })
        await db.connect()
        for (const m of MIGRATIONS) {
            await db.query(sql(m))
            if (m === "20260920000000_team_leader") await db.query(BEFORE_ROLES)
        }
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

    const numberOf = async (id: string) => (await db.query(`SELECT "whatsappNumber" FROM "User" WHERE id = $1`, [id])).rows[0].whatsappNumber as string | null
    const entries = async (id: string) => (await db.query(`SELECT action, "userId", details FROM "AuditLog" WHERE "entityId" = $1 AND action = 'UPDATE_USER' ORDER BY "createdAt"`, [id])).rows
    const refusal = (run: Promise<unknown>) => run.then(() => "saved", (error: Error) => error.message)

    it("starts with none", async () => {
        expect(await numberOf("e1")).toBeNull()
    })

    it("is kept with its country code, from one's own profile", async () => {
        await UserService.update({ id: "e1", whatsappNumber: "010 0123 4567" } as any, as("e1", "EMPLOYEE"))
        expect(await numberOf("e1")).toBe("+201001234567")
    })

    it("is in the audit log as a profile change, with what it was and what it became", async () => {
        const [entry] = await entries("e1")
        expect(entry).toMatchObject({ action: "UPDATE_USER", userId: "e1", details: { whatsappNumber: { old: null, new: "+201001234567" } } })
        // The same number again is no change, and isn't logged.
        await UserService.update({ id: "e1", whatsappNumber: "+201001234567" } as any, as("e1", "EMPLOYEE"))
        expect(await entries("e1")).toHaveLength(1)
    })

    it("is set by whoever may edit their profile", async () => {
        await UserService.update({ id: "e2", whatsappNumber: "+971501234567" } as any, as("a1", "ADMIN"))
        expect(await numberOf("e2")).toBe("+971501234567")
        expect((await entries("e2"))[0]).toMatchObject({ userId: "a1", details: { whatsappNumber: { old: null, new: "+971501234567" } } })
    })

    it("isn't set on someone else's profile by whoever may not edit it, nor in another company", async () => {
        expect(await refusal(UserService.update({ id: "e2", whatsappNumber: "01112345678" } as any, as("e1", "EMPLOYEE")))).toBe("FORBIDDEN")
        expect(await refusal(UserService.update({ id: "x1", whatsappNumber: "01112345678" } as any, as("a1", "ADMIN")))).toBe("CROSS_COMPANY_ACCESS_FORBIDDEN")
        expect(await numberOf("e2")).toBe("+971501234567")
        expect(await numberOf("x1")).toBeNull()
    })

    it("refuses what isn't a mobile number, and keeps the one it had", async () => {
        expect(await refusal(UserService.update({ id: "e1", whatsappNumber: "0221234567" } as any, as("e1", "EMPLOYEE")))).toBe("WHATSAPP_NUMBER_INVALID")
        expect(await numberOf("e1")).toBe("+201001234567")
    })

    it("isn't written where the company's package hasn't the client portal", async () => {
        expect(await refusal(UserService.update({ id: "e1", whatsappNumber: "01112345678" } as any, as("e1", "EMPLOYEE", ["COMPANY_MANAGEMENT", "HR"])))).toBe("NOT_IN_PACKAGE")
        expect(await numberOf("e1")).toBe("+201001234567")
    })

    it("leaves it as it is when a save doesn't send it, as the profile's form doesn't", async () => {
        await UserService.update({ id: "e1", gender: "FEMALE" } as any, as("e1", "EMPLOYEE"))
        expect(await numberOf("e1")).toBe("+201001234567")
    })

    it("is held by the database to the shape it's kept in", async () => {
        const write = (number: string) => db.query(`UPDATE "User" SET "whatsappNumber" = $1 WHERE id = 'x1'`, [number]).then(() => "written", (error: Error) => error.message)
        for (const shape of ["01001234567", "201001234567", "+0201001234567", "+20 100 123 4567", "+1234567", ""]) {
            expect(await write(shape), shape).toMatch(/User_whatsappNumber_kept/)
        }
        expect(await write("+201001234567")).toBe("written")
        await db.query(`UPDATE "User" SET "whatsappNumber" = NULL WHERE id = 'x1'`)
    })

    it("is gone when it's emptied", async () => {
        await UserService.update({ id: "e1", whatsappNumber: "" } as any, as("e1", "EMPLOYEE"))
        expect(await numberOf("e1")).toBeNull()
        await UserService.update({ id: "e2", whatsappNumber: null } as any, as("a1", "ADMIN"))
        expect(await numberOf("e2")).toBeNull()
        expect((await entries("e1")).at(-1)).toMatchObject({ details: { whatsappNumber: { old: "+201001234567", new: null } } })
    })
})

import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { readFileSync, readdirSync } from "node:fs"
import { Client } from "pg"
import { AttendancePunchService as Punches } from "@/lib/services/attendance-punch.service"
import type { Cell } from "@/lib/attendance/punch-import"

/**
 * Punches against a real Postgres built from the migration files
 * (ATTENDANCE_PLAN.md §8.6, §11, §14): an import stored once however often it
 * is sent, numbers that find their person later, nothing in an approved
 * month, and nothing edited — only withdrawn.
 *
 * Needs ROLES_TEST_DATABASE_URL, like lib/attendance-calendar.db.test.ts.
 */

const ADMIN_URL = process.env.ROLES_TEST_DATABASE_URL
const MIGRATIONS = readdirSync("prisma/migrations").filter(m => m !== "migration_lock.toml").sort((a, b) => (a === "0_init" ? -1 : b === "0_init" ? 1 : a.localeCompare(b)))
const sql = (name: string) => readFileSync(`prisma/migrations/${name}/migration.sql`, "utf8")

const BEFORE_ROLES = `
INSERT INTO "Company"(id, name, "updatedAt") VALUES ('c1', 'One', now()), ('c2', 'Two', now());
INSERT INTO "User"(id, email, password, "firstName", "lastName", role, "lastDayOffResetYear", username, "companyId", "teamLeaderId") VALUES
 ('a1', 'a1@x', 'p', 'Amal', 'One', 'ADMIN', 2026, 'a1', 'c1', NULL),
 ('e1', 'e1@x', 'p', 'Ehab', 'One', 'EMPLOYEE', 2026, 'e1', 'c1', NULL),
 ('e3', 'e3@x', 'p', 'Eman', 'Three', 'EMPLOYEE', 2026, 'e3', 'c1', NULL),
 ('e2', 'e2@x', 'p', 'Essam', 'Two', 'EMPLOYEE', 2026, 'e2', 'c2', NULL);
`

/** A terminal export: employee number, one date-and-time column, state. */
const FILE: Cell[][] = [
    ["AC-No.", "Name", "Check Time", "State"],
    ["101", "Ehab", "01/10/2026 08:05", "C/In"],
    ["101", "Ehab", "01/10/2026 17:02", "C/Out"],
    ["303", "Eman", "01/10/2026 07:58", "C/In"],
    ["101", "Ehab", "30/09/2026 08:00", "C/In"],
    ["101", "Ehab", "not a date", "C/In"],
]
const file = (rows: Cell[][] = FILE, hash = "hash-oct") => ({ name: "october.xlsx", hash, rows })

describe.skipIf(!ADMIN_URL)("punches, in Postgres", () => {
    const dbName = `punch_test_${Date.now()}`
    let db: Client

    beforeAll(async () => {
        const admin = new Client({ connectionString: ADMIN_URL })
        await admin.connect()
        await admin.query(`CREATE DATABASE ${dbName}`)
        await admin.end()
        const url = new URL(ADMIN_URL!)
        url.pathname = `/${dbName}`
        db = new Client({ connectionString: url.toString() })
        await db.connect()
        for (const m of MIGRATIONS) {
            await db.query(sql(m))
            if (m === "20260920000000_team_leader") await db.query(BEFORE_ROLES)
        }
        await db.query(`INSERT INTO "SuperAdmin"(id, email, password, "firstName", "lastName", username, "updatedAt") VALUES ('sa', 'sa@x', 'p', 'Sam', 'Admin', 'sa', now())`)
        // September 2026's payroll is approved: its attendance is settled.
        await db.query(`INSERT INTO "PayrollRun"(id, "companyId", month, year, status, "payrollDay", "updatedAt") VALUES ('run9', 'c1', 9, 2026, 'APPROVED', 25, now())`)
        process.env.POSTGRES_PRISMA_URL = url.toString()
    }, 120_000)

    afterAll(async () => {
        await (await import("@/lib/prisma")).prisma.$disconnect()
        await db?.end()
        const admin = new Client({ connectionString: ADMIN_URL })
        await admin.connect()
        await admin.query(`DROP DATABASE IF EXISTS ${dbName}`)
        await admin.end()
    })

    const refusal = (code: string) => expect.objectContaining({ message: code })
    const rows = async (where = "TRUE") => (await db.query(`SELECT * FROM "AttendancePunch" WHERE ${where} ORDER BY "punchAtLocal"`)).rows

    describe("the built-in Admin", () => {
        it("gains attendance.view_team and attendance.correct, and only the Admin does", async () => {
            const { rows: grants } = await db.query(`SELECT r."builtIn", g.permission FROM "RoleGrant" g JOIN "Role" r ON r.id = g."roleId" WHERE g.permission LIKE 'attendance.%' ORDER BY 1, 2`)
            expect(new Set(grants.map(g => g.builtIn))).toEqual(new Set(["ADMIN"]))
            expect(new Set(grants.map(g => g.permission))).toEqual(new Set(["attendance.correct", "attendance.view_team"]))
        })
    })

    describe("importing a file", () => {
        it("reports what it would do and writes nothing, until asked to", async () => {
            const report = await Punches.importRows("c1", file(), { dateOrder: "DMY" }, "a1", false)
            expect(report).toMatchObject({ rowCount: 5, ready: 3, duplicates: 0, locked: 1, problemCount: 1, from: "2026-09-30", to: "2026-10-01" })
            expect(report.problems).toEqual([{ row: 6, code: "101", error: "BAD_DATE" }])
            expect(report.codes).toEqual([{ code: "101", userId: null, name: null, rows: 3 }, { code: "303", userId: null, name: null, rows: 1 }])
            expect(await rows()).toEqual([])
        })

        it("stores every readable row in an open month, with the company's clock, waiting for a person if its number has none", async () => {
            const report = await Punches.importRows("c1", file(), { dateOrder: "DMY" }, "a1", true)
            expect(report).toMatchObject({ added: 3, locked: 1 })
            const stored = await rows()
            expect(stored.map(p => [p.hardwareUserId, p.userId, p.direction, p.sourceKey])).toEqual([
                ["303", null, "IN", "hash-oct:4"], ["101", null, "IN", "hash-oct:2"], ["101", null, "OUT", "hash-oct:3"],
            ])
            // 08:05 in Cairo on 1 October 2026 is 05:05 UTC (summer time, +03:00).
            expect(stored[1].punchAt.toISOString()).toBe("2026-10-01T05:05:00.000Z")
            expect(stored[1].resolvedWithTimeZone).toBe("Africa/Cairo")
            const { rows: [imp] } = await db.query(`SELECT * FROM "AttendanceImport"`)
            expect(imp).toMatchObject({ rowCount: 5, addedCount: 3, duplicateCount: 0, refusedCount: 2, fileName: "october.xlsx" })
        })

        it("stores a file sent twice once, and says there is nothing new", async () => {
            const again = await Punches.importRows("c1", file(), { dateOrder: "DMY" }, "a1", false)
            expect(again).toMatchObject({ ready: 3, duplicates: 3 })
            await expect(Punches.importRows("c1", file(), { dateOrder: "DMY" }, "a1", true)).rejects.toEqual(refusal("IMPORT_NOTHING_NEW"))
            expect((await rows()).length).toBe(3)
        })

        it("is held to one copy by the database too", async () => {
            await expect(db.query(`INSERT INTO "AttendancePunch"(id, "companyId", source, "sourceKey", "hardwareUserId", "punchAtLocal", "punchAt", "resolvedWithTimeZone") VALUES ('dup', 'c1', 'IMPORT', 'hash-oct:2', '101', '2026-10-01 08:05', now(), 'Africa/Cairo')`)).rejects.toThrow(/AttendancePunch_companyId_source_sourceKey_key/)
            await expect(db.query(`INSERT INTO "AttendancePunch"(id, "companyId", source, "sourceKey", "punchAtLocal", "punchAt", "resolvedWithTimeZone") VALUES ('nobody', 'c1', 'IMPORT', 'x:1', '2026-10-01 08:05', now(), 'Africa/Cairo')`)).rejects.toThrow(/AttendancePunch_has_someone/)
        })
    })

    describe("employee numbers", () => {
        it("lists the numbers seen with nobody, then gives a person their waiting punches when mapped", async () => {
            expect((await Punches.codes("c1")).unmatched).toEqual([
                { code: "101", punches: 2, from: "2026-10-01", to: "2026-10-01" },
                { code: "303", punches: 1, from: "2026-10-01", to: "2026-10-01" },
            ])
            expect(await Punches.mapCode("c1", { code: "101", userId: "e1" }, "a1")).toMatchObject({ filled: 2, leftInLockedMonths: 0 })
            expect((await rows(`"hardwareUserId" = '101'`)).map(p => p.userId)).toEqual(["e1", "e1"])
            // The next file finds the person at once.
            const next = await Punches.importRows("c1", file([FILE[0], ["101", "Ehab", "02/10/2026 08:01", "C/In"]], "hash-oct-2"), { dateOrder: "DMY" }, "a1", true)
            expect(next.codes).toEqual([{ code: "101", userId: "e1", name: "Ehab One", rows: 1 }])
            expect((await rows(`"sourceKey" = 'hash-oct-2:2'`))[0].userId).toBe("e1")
        })

        it("refuses a number taken, a person from another company, and mapping oneself", async () => {
            await expect(Punches.mapCode("c1", { code: "101", userId: "e3" }, "a1")).rejects.toEqual(refusal("CODE_TAKEN"))
            await expect(Punches.mapCode("c1", { code: "303", userId: "e2" }, "a1")).rejects.toEqual(refusal("USER_NOT_FOUND"))
            await expect(Punches.mapCode("c1", { code: "303", userId: "a1" }, "a1")).rejects.toEqual(refusal("CANNOT_CORRECT_OWN"))
        })

        it("leaves punches in an approved month with nobody, since that month was paid without them", async () => {
            await db.query(`INSERT INTO "AttendancePunch"(id, "companyId", source, "sourceKey", "hardwareUserId", "punchAtLocal", "punchAt", "resolvedWithTimeZone") VALUES ('sep303', 'c1', 'IMPORT', 'old:2', '303', '2026-09-20 08:00', now(), 'Africa/Cairo')`)
            const mapped = await Punches.mapCode("c1", { code: "303", userId: "e3" }, "a1")
            expect(mapped).toMatchObject({ filled: 1, leftInLockedMonths: 1 })
            expect((await rows(`id = 'sep303'`))[0].userId).toBeNull()
        })

        it("takes back what a wrong mapping gave, in open months, when it is removed", async () => {
            const { rows: [m] } = await db.query(`SELECT id FROM "AttendanceCode" WHERE code = '303'`)
            expect(await Punches.unmapCode(m.id, "a1")).toEqual({ unfilled: 1 })
            expect((await rows(`"hardwareUserId" = '303' AND "punchAtLocal" >= '2026-10-01'`))[0].userId).toBeNull()
            await Punches.mapCode("c1", { code: "303", userId: "e3" }, "a1")
        })
    })

    describe("by hand", () => {
        it("adds a punch for somebody else, with a reason", async () => {
            const { id } = await Punches.addManual("c1", { userId: "e3", at: "2026-10-01T17:10", direction: "OUT", note: "Forgot to punch out" }, "a1")
            const [p] = await rows(`id = '${id}'`)
            expect(p).toMatchObject({ source: "MANUAL", sourceKey: id, userId: "e3", direction: "OUT", note: "Forgot to punch out", createdById: "a1" })
            expect(p.punchAt.toISOString()).toBe("2026-10-01T14:10:00.000Z")
        })

        it("refuses one's own, no reason, a date that does not exist, and an approved month", async () => {
            await expect(Punches.addManual("c1", { userId: "a1", at: "2026-10-01T09:00", direction: "IN", note: "x" }, "a1")).rejects.toEqual(refusal("CANNOT_CORRECT_OWN"))
            await expect(Punches.addManual("c1", { userId: "e3", at: "2026-10-01T09:00", direction: "IN", note: " " }, "a1")).rejects.toEqual(refusal("REASON_REQUIRED"))
            await expect(Punches.addManual("c1", { userId: "e3", at: "2026-02-30T09:00", direction: "IN", note: "x" }, "a1")).rejects.toEqual(refusal("INVALID_DATE"))
            await expect(Punches.addManual("c1", { userId: "e3", at: "2026-09-10T09:00", direction: "IN", note: "x" }, "a1")).rejects.toEqual(refusal("PAYROLL_MONTH_LOCKED"))
            await expect(Punches.addManual("c1", { userId: "e2", at: "2026-10-01T09:00", direction: "IN", note: "x" }, "a1")).rejects.toEqual(refusal("USER_NOT_FOUND"))
        })

        it("withdraws a punch, keeping it, never twice, never in an approved month", async () => {
            const [p] = await rows(`source = 'MANUAL'`)
            await Punches.voidPunch(p.id, "Entered for the wrong day", "a1")
            expect((await rows(`id = '${p.id}'`))[0]).toMatchObject({ voidedById: "a1", voidReason: "Entered for the wrong day" })
            await expect(Punches.voidPunch(p.id, "again", "a1")).rejects.toEqual(refusal("PUNCH_ALREADY_VOIDED"))
            await expect(Punches.voidPunch("sep303", "x", "a1")).rejects.toEqual(refusal("PAYROLL_MONTH_LOCKED"))
            await expect(db.query(`UPDATE "AttendancePunch" SET "voidedAt" = now() WHERE id = 'sep303'`)).rejects.toThrow(/AttendancePunch_void_complete/)
        })
    })

    describe("a number mapped while a file goes in (review on #12)", () => {
        it("reaches the file's rows: the import reads the mappings after the mapping commits", async () => {
            // Another connection maps 555 under the numbers' lock, as mapCode does, finding nothing waiting yet.
            const other = new Client({ connectionString: process.env.POSTGRES_PRISMA_URL })
            await other.connect()
            await other.query("BEGIN")
            await other.query(`SELECT pg_advisory_xact_lock(hashtext('attendance-codes:c1'))`)
            const imported = Punches.importRows("c1", file([FILE[0], ["555", "Ehab", "05/10/2026 08:00", "C/In"]], "hash-555"), { dateOrder: "DMY" }, "a1", true)
                .then(r => r.added, (e: Error) => e.message)
            await new Promise(r => setTimeout(r, 300))
            await other.query(`INSERT INTO "AttendanceCode"(id, "companyId", code, "userId", "createdById") VALUES ('m555', 'c1', '555', 'e1', 'a1')`)
            await other.query("COMMIT")
            await other.end()
            expect(await imported).toBe(1)
            expect((await rows(`"hardwareUserId" = '555'`))[0].userId).toBe("e1")
        })
    })

    describe("payroll approval and a punch at the same moment (review on #12)", () => {
        it("makes the punch wait for the approval, then refuses it", async () => {
            // Another connection approves November while holding the month's lock, as approval does.
            const other = new Client({ connectionString: process.env.POSTGRES_PRISMA_URL })
            await other.connect()
            await other.query("BEGIN")
            await other.query(`SELECT pg_advisory_xact_lock(hashtext('attendance-month:c1:2026-11'))`)
            const punch = Punches.addManual("c1", { userId: "e3", at: "2026-11-02T09:00", direction: "IN", note: "During approval" }, "a1")
                .then(() => "added", (e: Error) => e.message)
            await new Promise(r => setTimeout(r, 300))
            await other.query(`INSERT INTO "PayrollRun"(id, "companyId", month, year, status, "payrollDay", "updatedAt") VALUES ('run11', 'c1', 11, 2026, 'APPROVED', 25, now())`)
            await other.query("COMMIT")
            await other.end()
            expect(await punch).toBe("PAYROLL_MONTH_LOCKED")
        })
    })

    describe("seeing punches", () => {
        it("shows the company's, one's own, and the ones waiting for a person separately", async () => {
            const all = await Punches.list("c1", { from: "2026-10-01", to: "2026-10-31" }, { kind: "COMPANY" })
            expect(new Set(all.map(p => p.userId))).toEqual(new Set(["e1", "e3"]))
            expect(all.find(p => p.userId === "e1")).toMatchObject({ name: "Ehab One", source: "IMPORT" })
            const own = await Punches.list("c1", { from: "2026-10-01", to: "2026-10-31" }, { kind: "OWN", userId: "e3" })
            expect(new Set(own.map(p => p.userId))).toEqual(new Set(["e3"]))
            const waiting = await Punches.list("c1", { from: "2026-09-01", to: "2026-09-30", unmatched: true }, { kind: "COMPANY" })
            expect(waiting.map(p => p.id)).toEqual(["sep303"])
            expect(await Punches.list("c1", { from: "2026-09-01", to: "2026-09-30", unmatched: true }, { kind: "OWN", userId: "e3" })).toEqual([])
            // Another company's are not there.
            expect(await Punches.list("c2", { from: "2026-10-01", to: "2026-10-31" }, { kind: "COMPANY" })).toEqual([])
        })

        it("shows a team leader their team and themselves", async () => {
            await db.query(`UPDATE "User" SET "teamLeaderId" = 'e1' WHERE id = 'e3'`)
            const team = await Punches.list("c1", { from: "2026-10-01", to: "2026-10-31" }, { kind: "TEAM", leaderId: "e1" })
            expect(new Set(team.map(p => p.userId))).toEqual(new Set(["e1", "e3"]))
            expect(await Punches.list("c1", { from: "2026-10-01", to: "2026-10-31" }, { kind: "TEAM", leaderId: "e3" })).toEqual(
                expect.arrayContaining([expect.objectContaining({ userId: "e3" })]),
            )
            expect((await Punches.list("c1", { from: "2026-10-01", to: "2026-10-31" }, { kind: "TEAM", leaderId: "e3" })).some(p => p.userId === "e1")).toBe(false)
        })
    })

    describe("withdrawing a whole import", () => {
        it("withdraws every punch it brought, unless one is in an approved month", async () => {
            const { rows: [imp] } = await db.query(`SELECT id FROM "AttendanceImport" WHERE "fileHash" = 'hash-oct'`)
            expect(await Punches.voidImport(imp.id, "Wrong branch's file", "a1")).toEqual({ voided: 3 })
            expect((await rows(`"importId" = '${imp.id}' AND "voidedAt" IS NULL`)).length).toBe(0)
            await expect(Punches.voidImport(imp.id, "again", "a1")).rejects.toEqual(refusal("IMPORT_ALREADY_VOIDED"))
            await db.query(`INSERT INTO "AttendanceImport"(id, "companyId", "fileName", "fileHash", "rowCount", "addedCount", "duplicateCount", "refusedCount", "createdById") VALUES ('sepimp', 'c1', 'sept.csv', 'h', 1, 1, 0, 0, 'a1')`)
            await db.query(`UPDATE "AttendancePunch" SET "importId" = 'sepimp' WHERE id = 'sep303'`)
            await expect(Punches.voidImport("sepimp", "x", "a1")).rejects.toEqual(refusal("PAYROLL_MONTH_LOCKED"))
        })
    })

    it("lets a person with punches added by hand be deleted permanently, taking their punches (review on #12)", async () => {
        await db.query(`INSERT INTO "User"(id, email, password, "firstName", "lastName", role, "lastDayOffResetYear", username, "companyId", "roleId") SELECT 'gone', 'gone@x', 'p', 'Gone', 'Soon', 'EMPLOYEE', 2026, 'gone', 'c1', id FROM "Role" WHERE "companyId" = 'c1' AND "builtIn" = 'EMPLOYEE'`)
        await db.query(`INSERT INTO "AttendancePunch"(id, "companyId", "userId", source, "sourceKey", "punchAtLocal", "punchAt", "resolvedWithTimeZone") VALUES ('byhand', 'c1', 'gone', 'MANUAL', 'byhand', '2026-10-02 09:00', now(), 'Africa/Cairo')`)
        await db.query(`DELETE FROM "User" WHERE id = 'gone'`)
        expect(await rows(`id = 'byhand'`)).toEqual([])
    })

    it("writes every change to the audit log, as the person who made it", async () => {
        const { rows: log } = await db.query(`SELECT action, "entityType", "userId" FROM "AuditLog" WHERE "entityType" LIKE 'ATTENDANCE_%' AND "entityType" NOT IN ('ATTENDANCE_CALENDAR', 'ATTENDANCE_POLICY') ORDER BY "createdAt"`)
        expect(log.map(l => l.action)).toEqual([
            "IMPORT_ATTENDANCE_PUNCHES", "MAP_ATTENDANCE_CODE", "IMPORT_ATTENDANCE_PUNCHES", "MAP_ATTENDANCE_CODE",
            "UNMAP_ATTENDANCE_CODE", "MAP_ATTENDANCE_CODE", "ADD_ATTENDANCE_PUNCH", "VOID_ATTENDANCE_PUNCH", "IMPORT_ATTENDANCE_PUNCHES",
            "VOID_ATTENDANCE_IMPORT",
        ])
        expect(new Set(log.map(l => l.userId))).toEqual(new Set(["a1"]))
    })
})

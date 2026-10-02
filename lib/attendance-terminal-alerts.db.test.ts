import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { readFileSync, readdirSync } from "node:fs"
import { Client } from "pg"
import { AttendanceAgentService as Agents } from "@/lib/services/attendance-agent.service"
import { TerminalAlerts } from "@/lib/services/attendance-terminal-alerts"
import { NotificationService } from "@/lib/services/notification.service"

/**
 * A terminal nobody hears from in working hours raises a CRITICAL notice,
 * once, to whoever can open the company's terminals, and the notice goes by
 * itself when the terminal is heard again (ATTENDANCE_PLAN.md §13.4).
 * Against a real Postgres built from the migrations.
 */

const ADMIN_URL = process.env.ROLES_TEST_DATABASE_URL
const MIGRATIONS = readdirSync("prisma/migrations").filter(m => m !== "migration_lock.toml").sort((a, b) => (a === "0_init" ? -1 : b === "0_init" ? 1 : a.localeCompare(b)))
const sql = (name: string) => readFileSync(`prisma/migrations/${name}/migration.sql`, "utf8")

const BEFORE_ROLES = `
INSERT INTO "Company"(id, name, "updatedAt") VALUES ('c1', 'One', now()), ('c2', 'Two', now());
INSERT INTO "User"(id, email, password, "firstName", "lastName", role, "lastDayOffResetYear", username, "companyId", "teamLeaderId") VALUES
 ('a1', 'a1@x', 'p', 'Amal', 'One', 'ADMIN', 2026, 'a1', 'c1', NULL),
 ('e1', 'e1@x', 'p', 'Ehab', 'One', 'EMPLOYEE', 2026, 'e1', 'c1', NULL),
 ('a2', 'a2@x', 'p', 'Adel', 'Two', 'ADMIN', 2026, 'a2', 'c2', NULL);
`

// Sunday 4 October 2026: 11:00 in Cairo (UTC+3), a working day; and 23:00.
const WORKING = new Date("2026-10-04T08:00:00Z")
const NIGHT = new Date("2026-10-04T20:00:00Z")
const minutesBefore = (at: Date, m: number) => new Date(at.getTime() - m * 60_000)

describe.skipIf(!ADMIN_URL)("silent terminal alerts, in Postgres", () => {
    const dbName = `terminal_alerts_test_${Date.now()}`
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
        // c1 shows its people the Attendance tab; c2 leaves it to the Super Admin.
        await db.query(`UPDATE "Company" SET "adminSettingsEnabled" = true, "adminSettingsTabs" = ARRAY['attendance'] WHERE id = 'c1'`)
        await db.query(`INSERT INTO "SuperAdmin"(id, email, username, password, "firstName", "lastName", "updatedAt") VALUES ('sa1', 'sa@x', 'sa1', 'p', 'Sara', 'Admin', now())`)
        process.env.POSTGRES_PRISMA_URL = url.toString()
    }, 180_000)

    afterAll(async () => {
        await (await import("@/lib/prisma")).prisma.$disconnect()
        await db?.end()
        const admin = new Client({ connectionString: ADMIN_URL })
        await admin.connect()
        await admin.query(`DROP DATABASE IF EXISTS ${dbName}`)
        await admin.end()
    })

    /** An enrolled agent, last heard from at this time. */
    async function agentHeardAt(companyId: string, name: string, at: Date | null) {
        const { agent, code } = await Agents.create(companyId, name, companyId === "c1" ? "a1" : "a2")
        await Agents.enrol(code, {})
        await db.query(`UPDATE "AttendanceAgent" SET "lastSeenAt" = $2, "enrolledAt" = $3 WHERE id = $1`, [agent.id, at, minutesBefore(WORKING, 24 * 60)])
        return agent.id
    }
    const heard = (table: "AttendanceAgent" | "AttendanceDevice", id: string, at: Date) => db.query(`UPDATE "${table}" SET "lastSeenAt" = $2 WHERE id = $1`, [id, at])
    async function terminal(companyId: string, agentId: string, name: string, at: Date) {
        const id = `dev-${name}`
        await db.query(
            `INSERT INTO "AttendanceDevice"(id, "companyId", "agentId", "serialNumber", name, "firstSeenAt", "lastSeenAt", "updatedAt") VALUES ($1, $2, $3, $1, $4, $5, $5, now())`,
            [id, companyId, agentId, name, minutesBefore(WORKING, 24 * 60)],
        )
        await heard("AttendanceDevice", id, at)
        return id
    }
    const notices = async (subjectId: string) =>
        (await db.query(`SELECT * FROM "Notification" WHERE "relatedId" LIKE $1 ORDER BY "createdAt"`, [`%highlight=${subjectId}`])).rows

    it("tells the company's settings holders once that an agent has gone silent in working hours", async () => {
        const id = await agentHeardAt("c1", "Head office", minutesBefore(WORKING, 40))
        await TerminalAlerts.check({ companyId: "c1" }, WORKING)
        await TerminalAlerts.check({ companyId: "c1" }, WORKING)

        const rows = await notices(id)
        // The Admin holds settings.view; the employee does not.
        expect(rows.map(r => r.userId)).toEqual(["a1"])
        expect(rows[0]).toMatchObject({ type: "ATTENDANCE_TERMINAL", priority: "CRITICAL", read: false, relatedId: `/dashboard/settings?tab=attendance&highlight=${id}` })
        expect(rows[0].message).toBe("Nothing has been heard from the attendance agent “Head office” since 10:20 on " + new Date("2026-10-04").toLocaleDateString() + ", so scans from its terminals aren't arriving. Check that its PC is on and connected.")
    })

    it("raises one notice when two bells ask at the same moment", async () => {
        const id = await agentHeardAt("c1", "Racing", minutesBefore(WORKING, 40))
        await Promise.all([TerminalAlerts.check({ companyId: "c1" }, WORKING), TerminalAlerts.check("ALL", WORKING), TerminalAlerts.check({ companyId: "c1" }, WORKING)])
        expect(await notices(id)).toHaveLength(1)
    })

    it("says nothing about silence at night, or about an agent heard a few minutes ago", async () => {
        const night = await agentHeardAt("c1", "Night", minutesBefore(NIGHT, 120))
        await TerminalAlerts.check({ companyId: "c1" }, NIGHT)
        expect(await notices(night)).toEqual([])
        const fresh = await agentHeardAt("c1", "Fresh", minutesBefore(WORKING, 5))
        await TerminalAlerts.check({ companyId: "c1" }, WORKING)
        expect(await notices(fresh)).toEqual([])
    })

    it("clears the notice when the agent is heard again, and raises a new one if it falls silent again", async () => {
        const id = await agentHeardAt("c1", "Flaky", minutesBefore(WORKING, 40))
        await TerminalAlerts.check({ companyId: "c1" }, WORKING)
        await heard("AttendanceAgent", id, WORKING)
        await TerminalAlerts.check({ companyId: "c1" }, WORKING)
        expect((await notices(id)).map(r => r.read)).toEqual([true])
        expect((await db.query(`SELECT "alertedAt" FROM "AttendanceAgent" WHERE id = $1`, [id])).rows[0].alertedAt).toBeNull()

        const later = new Date(WORKING.getTime() + 60 * 60_000)
        await TerminalAlerts.check({ companyId: "c1" }, later)
        expect((await notices(id)).map(r => r.read)).toEqual([true, false])
    })

    it("clears the notice of an agent that is revoked", async () => {
        const id = await agentHeardAt("c1", "Closing", minutesBefore(WORKING, 40))
        await TerminalAlerts.check({ companyId: "c1" }, WORKING)
        await Agents.revoke(id, "a1")
        await TerminalAlerts.check({ companyId: "c1" }, WORKING)
        expect((await notices(id)).map(r => r.read)).toEqual([true])
    })

    it("names a terminal that stops answering while its agent is heard, but not the terminals of a silent agent", async () => {
        const working = await agentHeardAt("c1", "Branch", minutesBefore(WORKING, 1))
        const unplugged = await terminal("c1", working, "Back gate", minutesBefore(WORKING, 30))
        const fine = await terminal("c1", working, "Front door", minutesBefore(WORKING, 1))
        const silent = await agentHeardAt("c1", "Warehouse", minutesBefore(WORKING, 30))
        const behindIt = await terminal("c1", silent, "Loading bay", minutesBefore(WORKING, 30))
        await TerminalAlerts.check({ companyId: "c1" }, WORKING)

        const [row] = await notices(unplugged)
        expect(row).toMatchObject({ userId: "a1", priority: "CRITICAL", messageKey: "notice_att_terminal_silent" })
        expect(row.messageParams).toMatchObject({ terminal: "Back gate", agent: "Branch", time: "10:30" })
        expect(await notices(fine)).toEqual([])
        expect(await notices(behindIt)).toEqual([])
        expect(await notices(silent)).toHaveLength(1)

        // Answering again clears it.
        await heard("AttendanceDevice", unplugged, WORKING)
        await TerminalAlerts.check({ companyId: "c1" }, WORKING)
        expect((await notices(unplugged)).map(r => r.read)).toEqual([true])
    })

    it("tells the Super Admin, naming the company, when the company's people can't open its terminals", async () => {
        const id = await agentHeardAt("c2", "Their office", minutesBefore(WORKING, 40))
        await TerminalAlerts.check({ companyId: "c2" }, WORKING)
        const rows = await notices(id)
        expect(rows.map(r => r.superAdminId)).toEqual(["sa1"])
        expect(rows[0]).toMatchObject({ userId: null, relatedId: `/dashboard/companies/c2/settings?tab=attendance&highlight=${id}`, messageKey: "notice_att_in_company" })
        expect(rows[0].message).toMatch(/^Two: Nothing has been heard from the attendance agent “Their office”/)
    })

    it("keeps a CRITICAL notice unread and on top when everything else is marked read", async () => {
        await NotificationService.notify("a1", "TASK", { key: "notice_att_day_absent", params: { date: { date: "2026-10-04" } } })
        await NotificationService.markAllAsRead("a1")
        const mine = await NotificationService.getByUser("a1")
        const firstRead = mine.findIndex(n => n.read)
        expect(firstRead).toBeGreaterThan(0)
        expect(mine.slice(0, firstRead).every(n => n.priority === "CRITICAL")).toBe(true)
        expect(mine.slice(firstRead).every(n => n.read)).toBe(true)
        expect(mine.find(n => n.type === "TASK")).toMatchObject({ read: true })
    })
})

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest"
import { readFileSync, readdirSync } from "node:fs"
import { Client } from "pg"
import { PushService, type Sender } from "@/lib/services/push.service"
import { NotificationService } from "@/lib/services/notification.service"

/**
 * The push outbox (lib/services/push.service.ts, ATTENDANCE_PLAN.md §13.4):
 * which notices go to which phone, in whose language, once; what happens
 * when the push service says a token is dead or just fails. A real Postgres
 * built from the migrations; the sender is a stand-in that records.
 */

const ADMIN_URL = process.env.ROLES_TEST_DATABASE_URL
const MIGRATIONS = readdirSync("prisma/migrations").filter(m => m !== "migration_lock.toml").sort((a, b) => (a === "0_init" ? -1 : b === "0_init" ? 1 : a.localeCompare(b)))
const sql = (name: string) => readFileSync(`prisma/migrations/${name}/migration.sql`, "utf8")
const BEFORE_ROLES = `
INSERT INTO "Company"(id, name, "updatedAt") VALUES ('c1', 'One', now());
INSERT INTO "User"(id, email, password, "firstName", "lastName", role, "lastDayOffResetYear", username, "companyId", "teamLeaderId", language) VALUES
 ('e1', 'e1@x', 'p', 'Ehab', 'One', 'EMPLOYEE', 2026, 'e1', 'c1', NULL, 'ar'),
 ('e2', 'e2@x', 'p', 'Eman', 'Two', 'EMPLOYEE', 2026, 'e2', 'c1', NULL, 'en'),
 ('e3', 'e3@x', 'p', 'Essam', 'Three', 'EMPLOYEE', 2026, 'e3', 'c1', NULL, 'en');
`

describe.skipIf(!ADMIN_URL)("the push outbox, in Postgres", () => {
    const dbName = `push_test_${Date.now()}`
    let db: Client
    let sent: { platform: string; token: string; title: string; body: string; link: string | null }[]
    let outcome: Awaited<ReturnType<Sender>>
    const sender: Sender = async (platform, token, message) => { sent.push({ platform, token, ...message }); return outcome }

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
        process.env.POSTGRES_PRISMA_URL = url.toString()
        // Ehab's phone in use, with a token; Eman's waiting, with one; Essam's revoked, with one.
        await db.query(`INSERT INTO "CheckInPhone"(id, "companyId", "userId", "publicKey", "keyFingerprint", platform, status, "pushToken") VALUES
            ('p1', 'c1', 'e1', 'k', 'f1', 'ANDROID', 'ACTIVE', 'tok-e1'),
            ('p2', 'c1', 'e2', 'k', 'f2', 'IOS', 'PENDING', 'tok-e2'),
            ('p3', 'c1', 'e3', 'k', 'f3', 'ANDROID', 'REVOKED', 'tok-e3')`)
    }, 180_000)

    afterAll(async () => {
        await (await import("@/lib/prisma")).prisma.$disconnect()
        await db?.end()
        const admin = new Client({ connectionString: ADMIN_URL })
        await admin.connect()
        await admin.query(`DROP DATABASE IF EXISTS ${dbName}`)
        await admin.end()
    })

    beforeEach(async () => {
        sent = []
        outcome = "SENT"
        await db.query(`DELETE FROM "Notification"`)
    })

    const accepted = { key: "notice_att_checkin_accepted" as const, params: { date: { date: "2026-10-01" }, time: "09:40", reason: "" } }

    it("pushes the person's own attendance notices to their phone, in their language, once", async () => {
        await NotificationService.notify("e1", "ATTENDANCE_CHECK_IN", accepted, "/dashboard/attendance?tab=punches")
        await NotificationService.notify("e2", "ATTENDANCE_CHECK_IN", accepted, "/dashboard/attendance?tab=punches")
        expect(await PushService.flush(new Date(), sender)).toMatchObject({ sent: 2 })
        const toEhab = sent.find(s => s.token === "tok-e1")!
        expect(toEhab).toMatchObject({ platform: "ANDROID", title: "Nizmo", link: "/dashboard/attendance?tab=punches" })
        // Ehab reads Arabic: the same words as his bell.
        expect(toEhab.body).toMatch(/[؀-ۿ]/)
        expect(sent.find(s => s.token === "tok-e2")).toMatchObject({ platform: "IOS" })
        // Eman reads English.
        expect(sent.find(s => s.token === "tok-e2")!.body).toMatch(/^Your check-in at 09:40/)
        sent = []
        expect(await PushService.flush(new Date(), sender)).toMatchObject({ sent: 0 })
        expect(sent).toEqual([])
    })

    it("pushes nothing that isn't about their attendance, nothing stale, and nothing to a revoked phone", async () => {
        await NotificationService.notify("e1", "TASK", { key: "notice_att_checkin_accepted", params: accepted.params })
        await NotificationService.notify("e3", "ATTENDANCE_CHECK_IN", accepted)
        await NotificationService.notify("e1", "ATTENDANCE_CHECK_IN", accepted)
        await db.query(`UPDATE "Notification" SET "createdAt" = now() - interval '2 hours' WHERE "userId" = 'e1' AND type = 'ATTENDANCE_CHECK_IN'`)
        await PushService.flush(new Date(), sender)
        expect(sent).toEqual([])
    })

    it("opens where the bell opens: decided permission hours on the Requests page, picked out (UI_PLAN.md §2.3, part 3c), and overtime on the Attendance page", async () => {
        await NotificationService.notify("e2", "ATTENDANCE_REQUEST", { key: "notice_att_permission_approved", params: { date: { date: "2026-10-01" }, start: "09:00", end: "09:30" } }, "5d1c0f0e-2b52-4f6a-9c1e-1f2a3b4c5d6e")
        await NotificationService.notify("e2", "ATTENDANCE_REQUEST", { key: "notice_att_overtime_approved", params: { date: { date: "2026-10-01" }, minutes: 60 } }, "0a7e6d5c-4b3a-4291-8f7e-6d5c4b3a2918")
        await PushService.flush(new Date(), sender)
        expect(sent.map(s => s.link).sort()).toEqual(["/dashboard/attendance", "/dashboard/requests?kind=permission&highlight=5d1c0f0e-2b52-4f6a-9c1e-1f2a3b4c5d6e"])
    })

    it("pushes nothing about someone else: a new phone waiting for the reader's approval", async () => {
        await NotificationService.notify("e2", "ATTENDANCE_PHONE", { key: "notice_att_phone_requested", params: { name: "Ehab One", model: "Pixel 9" } })
        await PushService.flush(new Date(), sender)
        expect(sent).toEqual([])
    })

    it("sends once when two runs overlap", async () => {
        await NotificationService.notify("e1", "ATTENDANCE_REQUEST", accepted)
        await Promise.all([PushService.flush(new Date(), sender), PushService.flush(new Date(), sender)])
        expect(sent).toHaveLength(1)
    })

    it("sends a notice whose run died mid-send once its claim lapses, and not while it is fresh", async () => {
        await NotificationService.notify("e2", "ATTENDANCE_CHECK_IN", accepted)
        const now = new Date()
        // A run took it thirty seconds ago and may still be sending: left alone.
        await db.query(`UPDATE "Notification" SET "pushClaimedAt" = $1`, [new Date(now.getTime() - 30_000)])
        await PushService.flush(now, sender)
        expect(sent).toEqual([])
        // That run died five minutes ago, before the answer: sent now.
        await db.query(`UPDATE "Notification" SET "pushClaimedAt" = $1`, [new Date(now.getTime() - 5 * 60_000)])
        await PushService.flush(now, sender)
        expect(sent.map(s => s.token)).toEqual(["tok-e2"])
        expect((await db.query(`SELECT "pushedAt" FROM "Notification"`)).rows[0].pushedAt).not.toBeNull()
    })

    it("claims a notice when it takes it, not when its run began, so a run started meanwhile leaves it (review on #25)", async () => {
        await NotificationService.notify("e2", "ATTENDANCE_CHECK_IN", accepted)
        // A run that began three minutes ago (reminders first, then a long batch) and only now reaches this notice.
        const began = new Date(Date.now() - 3 * 60_000)
        const meanwhile: Sender = async (...args) => {
            // While it sends, another run starts.
            await PushService.flush(new Date(), sender)
            return sender(...args)
        }
        await PushService.flush(began, meanwhile)
        expect(sent.map(s => s.token)).toEqual(["tok-e2"])
    })

    it("forgets a token the push service says is dead, and tries again later after a plain failure", async () => {
        outcome = "FAILED"
        await NotificationService.notify("e2", "ATTENDANCE_PHONE", accepted)
        expect(await PushService.flush(new Date(), sender)).toMatchObject({ failed: 1 })
        outcome = "SENT"
        expect(await PushService.flush(new Date(), sender)).toMatchObject({ sent: 1 })

        outcome = "INVALID_TOKEN"
        await NotificationService.notify("e1", "ATTENDANCE_DAY", accepted)
        expect(await PushService.flush(new Date(), sender)).toMatchObject({ forgotten: 1 })
        expect((await db.query(`SELECT "pushToken" FROM "CheckInPhone" WHERE id = 'p1'`)).rows[0].pushToken).toBeNull()
    })

    it("pushes only to the new phone while it waits, not the one it replaces", async () => {
        // Ehab asks for a new phone: from then on the old one can't check in, and may be lost.
        await db.query(`UPDATE "CheckInPhone" SET "pushToken" = 'tok-e1' WHERE id = 'p1'`)
        await db.query(`INSERT INTO "CheckInPhone"(id, "companyId", "userId", "publicKey", "keyFingerprint", platform, status) VALUES ('p1new', 'c1', 'e1', 'k', 'f1new', 'IOS', 'PENDING')`)
        await NotificationService.notify("e1", "ATTENDANCE_DAY", accepted)
        // The new phone has no token yet: nothing goes to the old one meanwhile, and the notice waits for
        // the new one's token, not marked sent with nothing sent (review on #25).
        expect(await PushService.flush(new Date(), sender)).toMatchObject({ sent: 0, failed: 0 })
        expect(sent).toEqual([])
        expect((await db.query(`SELECT "pushedAt", "pushClaimedAt" FROM "Notification"`)).rows).toEqual([{ pushedAt: null, pushClaimedAt: null }])
        await db.query(`UPDATE "CheckInPhone" SET "pushToken" = 'tok-e1-new' WHERE id = 'p1new'`)
        await PushService.flush(new Date(), sender)
        expect(sent.map(s => s.token)).toEqual(["tok-e1-new"])
        await db.query(`DELETE FROM "CheckInPhone" WHERE id = 'p1new'`)
    })

    it("leaves notices waiting for a new phone's token out of the batch, so they never hold up newer ones (review on #49)", async () => {
        await db.query(`INSERT INTO "CheckInPhone"(id, "companyId", "userId", "publicKey", "keyFingerprint", platform, status) VALUES ('p1wait', 'c1', 'e1', 'k', 'f1wait', 'IOS', 'PENDING')`)
        // More waiting for Ehab's new phone than a run takes, all older than Eman's.
        await NotificationService.notify("e1", "ATTENDANCE_DAY", accepted)
        await db.query(`INSERT INTO "Notification"(id, "userId", type, message, "messageKey", "messageParams", "createdAt")
            SELECT gen_random_uuid()::text, "userId", type, message, "messageKey", "messageParams", "createdAt" - g * interval '1 second'
            FROM "Notification", generate_series(1, 200) g`)
        await NotificationService.notify("e2", "ATTENDANCE_CHECK_IN", accepted)
        await PushService.flush(new Date(), sender)
        expect(sent.map(s => s.token)).toEqual(["tok-e2"])
        // Ehab's are untouched, still waiting for the token.
        expect((await db.query(`SELECT count(*)::int AS n FROM "Notification" WHERE "userId" = 'e1' AND "pushedAt" IS NULL AND "pushClaimedAt" IS NULL`)).rows[0].n).toBe(201)
        await db.query(`DELETE FROM "CheckInPhone" WHERE id = 'p1wait'`)
    })

    it("stops once the company no longer has the Mobile App add-on", async () => {
        await db.query(`INSERT INTO "Package"(id, name, "hasHR", "updatedAt") VALUES ('hr', 'HR only', true, now())`)
        await db.query(`UPDATE "Company" SET "packageId" = 'hr' WHERE id = 'c1'`)
        await NotificationService.notify("e2", "ATTENDANCE_CHECK_IN", accepted)
        await PushService.flush(new Date(), sender)
        expect(sent).toEqual([])
        await db.query(`UPDATE "Company" SET "packageId" = NULL WHERE id = 'c1'`)
    })

    it("sends nothing, and says so, when no push service is set up", async () => {
        await NotificationService.notify("e2", "ATTENDANCE_CHECK_IN", accepted)
        expect(await PushService.flush(new Date(), null)).toEqual({ sent: 0, skipped: "NOT_CONFIGURED" })
    })
})

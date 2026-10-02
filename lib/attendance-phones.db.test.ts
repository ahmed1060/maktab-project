import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest"
import { readFileSync, readdirSync } from "node:fs"
import { Client } from "pg"
import { AttendancePhoneService as Phones } from "@/lib/services/attendance-phone.service"
import { AttendanceChallengeService as Challenges } from "@/lib/services/attendance-challenge.service"
import { parsePhoneKey, signedText } from "@/lib/attendance/phone-keys"
import { phoneKeyPair } from "@/lib/attendance/test-phone"
import { UserService } from "@/lib/services/user.service"

/**
 * The one phone each person checks in from (ATTENDANCE_PLAN.md §9.2, §9.3):
 * registering with a signed one-time number, approval with the cutover, held
 * check-ins released or discarded, and a lost phone revoked. Against a real
 * Postgres built from the migrations.
 */

const ADMIN_URL = process.env.ROLES_TEST_DATABASE_URL
const MIGRATIONS = readdirSync("prisma/migrations").filter(m => m !== "migration_lock.toml").sort((a, b) => (a === "0_init" ? -1 : b === "0_init" ? 1 : a.localeCompare(b)))
const sql = (name: string) => readFileSync(`prisma/migrations/${name}/migration.sql`, "utf8")

const BEFORE_ROLES = `
INSERT INTO "Company"(id, name, "updatedAt") VALUES ('c1', 'One', now()), ('c2', 'Two', now());
INSERT INTO "User"(id, email, password, "firstName", "lastName", role, "lastDayOffResetYear", username, "companyId", "teamLeaderId") VALUES
 ('a1', 'a1@x', 'p', 'Amal', 'One', 'ADMIN', 2026, 'a1', 'c1', NULL),
 ('t1', 't1@x', 'p', 'Tarek', 'Lead', 'TEAM_LEADER', 2026, 't1', 'c1', NULL),
 ('e1', 'e1@x', 'p', 'Ehab', 'One', 'EMPLOYEE', 2026, 'e1', 'c1', 't1'),
 ('e2', 'e2@x', 'p', 'Eman', 'Two', 'EMPLOYEE', 2026, 'e2', 'c1', NULL),
 ('e3', 'e3@x', 'p', 'Essam', 'Three', 'EMPLOYEE', 2026, 'e3', 'c1', NULL),
 ('e4', 'e4@x', 'p', 'Enas', 'Four', 'EMPLOYEE', 2026, 'e4', 'c1', NULL),
 ('e5', 'e5@x', 'p', 'Ezz', 'Five', 'EMPLOYEE', 2026, 'e5', 'c1', NULL),
 ('m1', 'm1@x', 'p', 'Mona', 'Moved', 'EMPLOYEE', 2026, 'm1', 'c1', NULL);
`

describe.skipIf(!ADMIN_URL)("check-in phones, in Postgres", () => {
    const dbName = `phones_test_${Date.now()}`
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
        await db.query(`INSERT INTO "SuperAdmin"(id, email, username, password, "firstName", "lastName", "updatedAt") VALUES ('sa', 'sa@x', 'sa', 'p', 'Sara', 'Admin', now())`)
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

    afterEach(() => { delete process.env.ATTENDANCE_ATTESTATION })

    /** What the app does: ask for a number, sign it with the new key, send both. */
    async function register(userId: string, phone = phoneKeyPair(), overrides: Record<string, any> = {}) {
        const { nonce } = await Challenges.issue(userId, "REGISTER")
        const fingerprint = parsePhoneKey(phone.publicBase64)!.fingerprint
        const signature = phone.sign(signedText("REGISTER", nonce, [fingerprint, "ANDROID"]))
        const registered = await Phones.register("c1", userId, { nonce, publicKey: phone.publicBase64, signature, platform: "ANDROID", model: "Pixel 8", appVersion: "1.0.0", ...overrides })
        return { ...registered, key: phone }
    }
    const status = async (id: string) => (await db.query(`SELECT status FROM "CheckInPhone" WHERE id = $1`, [id])).rows[0].status
    let punchN = 0
    async function held(userId: string, phoneId: string, at = "2026-10-04 08:55:00") {
        const id = `p${++punchN}`
        await db.query(
            `INSERT INTO "AttendancePunch"(id, "companyId", "userId", source, "sourceKey", "punchAtLocal", "punchAt", "resolvedWithTimeZone", status, "phoneId") VALUES ($1, 'c1', $2, 'MOBILE', $1, $3, $3::timestamp - interval '3 hours', 'Africa/Cairo', 'PENDING_DEVICE', $4)`,
            [id, userId, at, phoneId],
        )
        return id
    }
    const punchStatus = async (id: string) => (await db.query(`SELECT status, "phoneId" FROM "AttendancePunch" WHERE id = $1`, [id])).rows[0]
    const notices = async (userId: string) => (await db.query(`SELECT "messageKey" FROM "Notification" WHERE "userId" = $1 AND type = 'ATTENDANCE_PHONE' ORDER BY "createdAt"`, [userId])).rows.map(r => r.messageKey)

    it("registers a phone that signed its one-time number, waiting for approval, and tells whoever approves", async () => {
        const phone = await register("e1")
        expect(phone).toMatchObject({ status: "PENDING", platform: "ANDROID", model: "Pixel 8", attested: false })
        // The company's Admin (COMPANY scope) is told; the person themselves is not.
        expect(await notices("a1")).toEqual(["notice_att_phone_requested"])
        expect(await notices("e1")).toEqual([])
        const { rows: [audit] } = await db.query(`SELECT action, details FROM "AuditLog" WHERE "entityId" = $1`, [phone.id])
        expect(audit).toMatchObject({ action: "REGISTER_CHECK_IN_PHONE", details: { userId: "e1", attested: false } })
        expect(await Phones.mine("e1")).toMatchObject({ active: null, pending: { id: phone.id } })
    })

    it("refuses a number used twice, expired, someone else's or for another purpose, and a signature that isn't the key's", async () => {
        const phone = phoneKeyPair(), fingerprint = parsePhoneKey(phone.publicBase64)!.fingerprint
        const send = (nonce: string, signature: string, userId = "e2") => Phones.register("c1", userId, { nonce, publicKey: phone.publicBase64, signature, platform: "ANDROID" })
        const ok = async (userId = "e2", purpose: "REGISTER" | "CHECK_IN" = "REGISTER") => {
            const { nonce } = await Challenges.issue(userId, purpose)
            return { nonce, signature: phone.sign(signedText("REGISTER", nonce, [fingerprint, "ANDROID"])) }
        }
        // Signed by another key, or over another text.
        const a = await ok()
        await expect(send(a.nonce, phoneKeyPair().sign(signedText("REGISTER", a.nonce, [fingerprint, "ANDROID"])))).rejects.toThrow("PHONE_SIGNATURE_INVALID")
        await expect(send(a.nonce, phone.sign(signedText("REGISTER", a.nonce, [fingerprint, "IOS"])))).rejects.toThrow("PHONE_SIGNATURE_INVALID")
        // Someone else's number, or one for checking in.
        const b = await ok("e3")
        await expect(send(b.nonce, b.signature)).rejects.toThrow("PHONE_CHALLENGE_INVALID")
        const c = await ok("e2", "CHECK_IN")
        await expect(send(c.nonce, c.signature)).rejects.toThrow("PHONE_CHALLENGE_INVALID")
        // Expired.
        const d = await ok()
        await db.query(`UPDATE "AttendanceChallenge" SET "expiresAt" = now() - interval '1 second' WHERE "usedAt" IS NULL AND "userId" = 'e2'`)
        await expect(send(d.nonce, d.signature)).rejects.toThrow("PHONE_CHALLENGE_INVALID")
        // Used once, then not again.
        const e = await ok()
        await send(e.nonce, e.signature)
        await expect(send(e.nonce, e.signature)).rejects.toThrow("PHONE_CHALLENGE_INVALID")
        // A key that isn't a P-256 key.
        await expect(Phones.register("c1", "e2", { nonce: e.nonce, publicKey: "AAAA", signature: e.signature, platform: "ANDROID" })).rejects.toThrow("PHONE_KEY_INVALID")
    })

    it("refuses an unverified phone once attestation is required, and takes it while it is in testing", async () => {
        process.env.ATTENDANCE_ATTESTATION = "required"
        await expect(register("e3")).rejects.toThrow("PHONE_ATTESTATION_FAILED")
        delete process.env.ATTENDANCE_ATTESTATION
        expect((await register("e3")).attested).toBe(false)
    })

    it("answers the same phone asking twice the same, and refuses a key another person registered", async () => {
        const key = phoneKeyPair()
        const first = await register("e4", key)
        const again = await register("e4", key)
        expect(again.id).toBe(first.id)
        await expect(register("e5", key)).rejects.toThrow("PHONE_KEY_IN_USE")
    })

    it("approves a first phone: its held check-ins count, and its owner hears", async () => {
        const phone = await register("e5")
        const punch = await held("e5", phone.id)
        await Phones.decide(phone.id, { approve: true }, "a1")
        expect(await status(phone.id)).toBe("ACTIVE")
        expect(await punchStatus(punch)).toMatchObject({ status: "ACCEPTED" })
        expect(await notices("e5")).toEqual(["notice_att_phone_approved"])
        await expect(Phones.decide(phone.id, { approve: true }, "a1")).rejects.toThrow("PHONE_NOT_PENDING")
    })

    it("changes phone at the moment of asking: approval revokes the old one, rejection keeps it and discards the new one's check-ins", async () => {
        const old = await register("e1")
        await Phones.decide(old.id, { approve: true }, "a1")

        const rejected = await register("e1")
        const discarded = await held("e1", rejected.id)
        await Phones.decide(rejected.id, { approve: false, reason: "Not a company phone" }, "a1")
        expect(await status(rejected.id)).toBe("REJECTED")
        expect(await status(old.id)).toBe("ACTIVE")
        expect(await punchStatus(discarded)).toMatchObject({ status: "REJECTED" })

        const next = await register("e1")
        const counted = await held("e1", next.id)
        await Phones.decide(next.id, { approve: true }, "a1")
        expect(await status(old.id)).toBe("REVOKED")
        expect(await status(next.id)).toBe("ACTIVE")
        expect(await punchStatus(counted)).toMatchObject({ status: "ACCEPTED" })
        expect(await notices("e1")).toEqual(["notice_att_phone_approved", "notice_att_phone_rejected", "notice_att_phone_approved"])
    })

    it("asking again while waiting replaces the request, and what it held waits for the new one", async () => {
        const first = await register("e2")
        const punch = await held("e2", first.id)
        const second = await register("e2")
        expect(await status(first.id)).toBe("WITHDRAWN")
        expect(await punchStatus(punch)).toMatchObject({ status: "PENDING_DEVICE", phoneId: second.id })
        // Withdrawing it discards what it held.
        await Phones.withdraw("e2")
        expect(await status(second.id)).toBe("WITHDRAWN")
        expect(await punchStatus(punch)).toMatchObject({ status: "REJECTED" })
        await expect(Phones.withdraw("e2")).rejects.toThrow("PHONE_NOTHING_PENDING")
    })

    it("lets nobody decide their own phone, and settles a withdrawal and an approval at once as one of them", async () => {
        const mine = await register("a1")
        await expect(Phones.decide(mine.id, { approve: true }, "a1")).rejects.toThrow("CANNOT_DECIDE_OWN")
        await Phones.withdraw("a1")

        const contested = await register("t1")
        const outcomes = await Promise.allSettled([Phones.decide(contested.id, { approve: true }, "a1"), Phones.withdraw("t1")])
        expect(outcomes.filter(o => o.status === "fulfilled")).toHaveLength(1)
        expect(["ACTIVE", "WITHDRAWN"]).toContain(await status(contested.id))
    })

    it("revokes a lost phone, telling its owner; only a phone in use", async () => {
        const phone = await register("e3", phoneKeyPair())
        await expect(Phones.revoke(phone.id, "a1")).rejects.toThrow("PHONE_NOT_ACTIVE")
        await Phones.decide(phone.id, { approve: true }, "a1")
        await Phones.revoke(phone.id, "a1", "Lost on the bus")
        expect(await status(phone.id)).toBe("REVOKED")
        expect((await notices("e3")).at(-1)).toBe("notice_att_phone_revoked")
        expect((await db.query(`SELECT action FROM "AuditLog" WHERE "entityId" = $1 ORDER BY "createdAt"`, [phone.id])).rows.map(r => r.action))
            .toEqual(["REGISTER_CHECK_IN_PHONE", "APPROVE_CHECK_IN_PHONE", "REVOKE_CHECK_IN_PHONE"])
    })

    it("ends a person's phones, and discards what a new one held, when the Super Admin moves them to another company", async () => {
        const inUse = await register("m1")
        await Phones.decide(inUse.id, { approve: true }, "a1")
        const waiting = await register("m1")
        const punch = await held("m1", waiting.id)
        await UserService.update({ id: "m1", companyId: "c2" } as any, { user: { id: "sa", role: "SUPER_ADMIN" } })
        expect(await status(inUse.id)).toBe("REVOKED")
        expect(await status(waiting.id)).toBe("REVOKED")
        expect(await punchStatus(punch)).toMatchObject({ status: "REJECTED" })
        // The old company no longer sees them, nor can decide them.
        expect((await Phones.list("c1", { kind: "COMPANY" })).map(p => p.userId)).not.toContain("m1")
        await expect(Phones.decide(waiting.id, { approve: true }, "a1")).rejects.toThrow("PHONE_NOT_PENDING")
    })

    it("keeps one unused number per person and purpose: asking again replaces the last", async () => {
        const first = await Challenges.issue("e4", "CHECK_IN")
        await Challenges.issue("e4", "CHECK_IN")
        await Challenges.issue("e4", "CHECK_IN")
        await Challenges.issue("e4", "REGISTER")
        const { rows } = await db.query(`SELECT purpose, count(*)::int AS n FROM "AttendanceChallenge" WHERE "userId" = 'e4' AND "usedAt" IS NULL GROUP BY purpose ORDER BY purpose`)
        expect(rows).toEqual([{ purpose: "CHECK_IN", n: 1 }, { purpose: "REGISTER", n: 1 }])
        const { prisma } = await import("@/lib/prisma")
        expect(await prisma.$transaction(tx => Challenges.consume(tx, "e4", "CHECK_IN", first.nonce))).toBe(false)
    })

    it("holds at most one phone in use and one waiting per person, in the database too", async () => {
        await expect(db.query(`INSERT INTO "CheckInPhone"(id, "companyId", "userId", "publicKey", "keyFingerprint", platform, status) VALUES ('dup', 'c1', 'e1', 'x', 'dup', 'ANDROID', 'ACTIVE')`))
            .rejects.toThrow(/CheckInPhone_one_active/)
    })

    it("lists waiting and in-use phones to the company's deciders, and a team leader's team's to them", async () => {
        const company = await Phones.list("c1", { kind: "COMPANY" })
        expect(company.map(p => p.userId)).toEqual(expect.arrayContaining(["e1", "e5"]))
        const team = await Phones.list("c1", { kind: "TEAM", leaderId: "t1" })
        expect(team.map(p => p.userId)).toEqual(["e1"])
        expect(team[0]).toMatchObject({ name: "Ehab One", status: "ACTIVE", held: 0 })
    })
})

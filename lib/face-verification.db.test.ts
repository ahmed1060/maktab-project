import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { readFileSync, readdirSync } from "node:fs"
import { Client } from "pg"
import { FaceVerificationService as Face, FACE_CONSENT_VERSION } from "@/lib/services/face-verification.service"
import { AttendancePolicyService as Policy } from "@/lib/services/attendance-policy.service"
import { STANDARD_OFFICE } from "@/lib/attendance/policy"
import { can } from "@/lib/permissions/can"

/**
 * Face verification's switches and consent (lib/services/face-verification.service.ts,
 * ATTENDANCE_PLAN.md §9.5, §10.4), against a real Postgres: it is in use for a
 * person only when the system, the company, its policy, the person and their
 * consent all say so, and only the protected Super Admin moves the system switch.
 */

const ADMIN_URL = process.env.ROLES_TEST_DATABASE_URL
const MIGRATIONS = readdirSync("prisma/migrations").filter(m => m !== "migration_lock.toml").sort((a, b) => (a === "0_init" ? -1 : b === "0_init" ? 1 : a.localeCompare(b)))
const sql = (name: string) => readFileSync(`prisma/migrations/${name}/migration.sql`, "utf8")
const BEFORE_ROLES = `
INSERT INTO "Company"(id, name, "updatedAt") VALUES ('c1', 'One', now());
INSERT INTO "User"(id, email, password, "firstName", "lastName", role, "lastDayOffResetYear", username, "companyId", "teamLeaderId") VALUES
 ('a1', 'a1@x', 'p', 'Amal', 'One', 'ADMIN', 2026, 'a1', 'c1', NULL),
 ('e1', 'e1@x', 'p', 'Ehab', 'One', 'EMPLOYEE', 2026, 'e1', 'c1', NULL);
`

const protectedSA = (over: Record<string, unknown> = {}) => ({ user: { id: "sa1", role: "SUPER_ADMIN", isProtected: true, mfaEnabled: true, stepUpAt: Date.now(), ...over } })
const reason = async (p: Promise<unknown>) => { try { await p; return "OK" } catch (e) { return (e as Error).message } }

describe.skipIf(!ADMIN_URL)("face verification switches and consent, in Postgres", () => {
    const dbName = `face_test_${Date.now()}`
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
        await db.query(`UPDATE "Company" SET timezone = 'Africa/Cairo'`)
        await db.query(`INSERT INTO "SuperAdmin"(id, email, password, "firstName", "lastName", username, "isProtected", "updatedAt") VALUES ('sa1', 'sa@x', 'p', 'Sam', 'Admin', 'sa1', true, now())`)
        process.env.POSTGRES_PRISMA_URL = url.toString()
        await Policy.saveVersion("c1", { effectiveFrom: "2026-01-01", body: STANDARD_OFFICE }, "a1")
    }, 180_000)

    afterAll(async () => {
        await (await import("@/lib/prisma")).prisma.$disconnect()
        await db?.end()
        const admin = new Client({ connectionString: ADMIN_URL })
        await admin.connect()
        await admin.query(`DROP DATABASE IF EXISTS ${dbName}`)
        await admin.end()
    })

    it("starts off: nothing offered, nothing asked", async () => {
        expect(await Face.systemState()).toBe("OFF")
        expect(await Face.companyStatus("c1")).toMatchObject({ allowed: false, reason: "SYSTEM_OFF" })
        expect(await reason(Policy.saveVersion("c1", { effectiveFrom: "2026-02-01", body: { ...STANDARD_OFFICE, faceVerificationAvailable: true } }, "a1"))).toBe("FACE_NOT_ALLOWED")
        expect(await reason(Face.setRequired("c1", "e1", true, "a1", false))).toBe("FACE_NOT_AVAILABLE")
    })

    it("only the protected Super Admin, with a fresh code, switches the system", async () => {
        expect(await reason(Face.setSystemState(protectedSA({ isProtected: false }), "ON"))).toBe("FACE_PROTECTED_ONLY")
        expect(await reason(Face.setSystemState({ user: { id: "a1", role: "ADMIN", isProtected: true } }, "ON"))).toBe("FACE_PROTECTED_ONLY")
        expect(await reason(Face.setSystemState(protectedSA({ mfaEnabled: false }), "ON"))).toBe("MFA_ENROL_REQUIRED")
        expect(await reason(Face.setSystemState(protectedSA({ stepUpAt: Date.now() - 2 * 3_600_000 }), "ON"))).toBe("STEP_UP_REQUIRED")
        expect(await reason(Face.setSystemState(protectedSA(), "PAUSED"))).toBe("FACE_STATE_MOVE")
        expect(await Face.setSystemState(protectedSA(), "ON")).toEqual({ state: "ON" })
        // Off again is pause and purge, not a plain switch.
        expect(await reason(Face.setSystemState(protectedSA(), "OFF" as never))).toBe("FACE_STATE_MOVE")
        const { rows } = await db.query(`SELECT action, details FROM "AuditLog" WHERE action = 'SET_FACE_VERIFICATION'`)
        expect(rows).toEqual([{ action: "SET_FACE_VERIFICATION", details: { faceVerification: { old: "OFF", new: "ON" } } }])
    })

    it("then the company must confirm its legal readiness before its policy can offer it", async () => {
        expect(await Face.companyStatus("c1")).toMatchObject({ allowed: false, reason: "LEGAL_NOT_CONFIRMED" })
        expect(await reason(Policy.saveVersion("c1", { effectiveFrom: "2026-02-01", body: { ...STANDARD_OFFICE, faceVerificationAvailable: true } }, "a1"))).toBe("FACE_NOT_ALLOWED")
        await Face.setLegalConfirmed("c1", true, "a1", false)
        expect(await Face.companyStatus("c1")).toMatchObject({ allowed: false, reason: "POLICY_OFF" })
        await Policy.saveVersion("c1", { effectiveFrom: "2026-02-01", body: { ...STANDARD_OFFICE, faceVerificationAvailable: true, faceReverifyMonths: 6 } }, "a1")
        expect(await Face.companyStatus("c1")).toEqual({ allowed: true, reason: null, reverifyMonths: 6 })
    })

    it("is asked of a person by someone else, and in use once they consent to the current text", async () => {
        // Never one's own: approving your own face is the whole fraud.
        const holder = { id: "a1", role: "ADMIN", companyId: "c1", grants: { "attendance.approve_face": "COMPANY" } }
        expect(can(holder as never, "attendance.approve_face", { companyId: "c1", userId: "a1", teamLeaderId: null })).toBe(false)
        await Face.setRequired("c1", "e1", true, "a1", false)
        expect(await Face.statusFor("e1")).toMatchObject({ required: true, active: false, consent: null, consentVersion: FACE_CONSENT_VERSION })
        expect(await reason(Face.acceptConsent("c1", "e1", "2020-01-01"))).toBe("FACE_CONSENT_OUTDATED")
        const consent = await Face.acceptConsent("c1", "e1", FACE_CONSENT_VERSION)
        // Accepting twice is the same acceptance.
        expect(await Face.acceptConsent("c1", "e1", FACE_CONSENT_VERSION)).toEqual(consent)
        // In use once the phone's verification photo is approved too (part 2, lib/face-review.db.test.ts).
        expect(await Face.statusFor("e1")).toMatchObject({ required: true, active: false, consent: { textVersion: FACE_CONSENT_VERSION } })
    })

    it("stops at once when consent is withdrawn, the company withdraws its confirmation, or the system is paused", async () => {
        await Face.withdrawConsent("e1")
        expect(await Face.statusFor("e1")).toMatchObject({ required: true, active: false, consent: null })
        await Face.acceptConsent("c1", "e1", FACE_CONSENT_VERSION)
        expect((await db.query(`SELECT count(*)::int AS n FROM "BiometricConsent" WHERE "userId" = 'e1'`)).rows[0].n).toBe(2)

        await Face.setSystemState(protectedSA(), "PAUSED")
        expect(await Face.statusFor("e1")).toMatchObject({ active: false, company: { reason: "SYSTEM_PAUSED" } })
        // Paused keeps enrolments: the policy may still be saved with it on.
        await Policy.saveVersion("c1", { effectiveFrom: "2026-03-01", body: { ...STANDARD_OFFICE, faceVerificationAvailable: true } }, "a1")
        await Face.setSystemState(protectedSA(), "ON")
        expect(await Face.statusFor("e1")).toMatchObject({ required: true, company: { allowed: true } })

        await Face.setLegalConfirmed("c1", false, "a1", false)
        expect(await Face.statusFor("e1")).toMatchObject({ active: false, company: { reason: "LEGAL_NOT_CONFIRMED" } })
        const { rows } = await db.query(`SELECT action FROM "AuditLog" WHERE action LIKE '%FACE%' ORDER BY "createdAt"`)
        expect(rows.map(r => r.action)).toEqual([
            "SET_FACE_VERIFICATION", "CONFIRM_FACE_LEGAL", "REQUIRE_FACE_VERIFICATION", "ACCEPT_FACE_CONSENT", "WITHDRAW_FACE_CONSENT",
            "ACCEPT_FACE_CONSENT", "SET_FACE_VERIFICATION", "SET_FACE_VERIFICATION", "WITHDRAW_FACE_LEGAL",
        ])
    })

    it("needs the Mobile App add-on: a terminals-only company can't offer it (review on #27)", async () => {
        await Face.setLegalConfirmed("c1", true, "a1", false)
        expect(await Face.statusFor("e1")).toMatchObject({ company: { allowed: true } })
        await db.query(`INSERT INTO "Package"(id, name, "hasHR", "hasAttendanceTerminals", "hasAttendanceMobile", "updatedAt") VALUES ('terms', 'Terminals only', true, true, false, now())`)
        await db.query(`UPDATE "Company" SET "packageId" = 'terms' WHERE id = 'c1'`)
        expect(await Face.statusFor("e1")).toMatchObject({ active: false, required: false, company: { allowed: false, reason: "NO_MOBILE_APP" } })
        expect(await reason(Policy.saveVersion("c1", { effectiveFrom: "2026-04-01", body: { ...STANDARD_OFFICE, faceVerificationAvailable: true } }, "a1"))).toBe("FACE_NOT_ALLOWED")
        expect(await reason(Face.setRequired("c1", "e1", true, "a1", false))).toBe("FACE_NOT_AVAILABLE")
        await db.query(`UPDATE "Company" SET "packageId" = NULL WHERE id = 'c1'`)
    })

    it("puts a re-verification asked for and not done in three working days on the exceptions screen", async () => {
        await db.query(`INSERT INTO "CheckInPhone"(id, "companyId", "userId", "publicKey", "keyFingerprint", platform, status, "faceStatus") VALUES ('p-ov', 'c1', 'e1', 'k', $1, 'ANDROID', 'ACTIVE', 'APPROVED')`, ["e".repeat(64)])
        await db.query(`UPDATE "User" SET "faceReverifyRequestedAt" = now() - interval '1 hour' WHERE id = 'e1'`)
        expect(await Face.overdueReverifications("c1")).toEqual([])
        await db.query(`UPDATE "User" SET "faceReverifyRequestedAt" = now() - interval '20 days' WHERE id = 'e1'`)
        expect(await Face.overdueReverifications("c1")).toMatchObject([{ userId: "e1", name: "Ehab One" }])
        // Once a new photo waits, it is the reviewer's turn, not overdue.
        await db.query(`INSERT INTO "FaceReview"(id, "companyId", "userId", "phoneId", purpose, status, photo, "modelVersion") VALUES ('r-ov', 'c1', 'e1', 'p-ov', 'REVERIFY', 'PENDING', '\\xffd8ff', 'm1')`)
        expect(await Face.overdueReverifications("c1")).toEqual([])
    })
})

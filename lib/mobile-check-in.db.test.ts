import { describe, it, expect, beforeAll, afterAll, vi } from "vitest"
import { readFileSync, readdirSync } from "node:fs"
import { generateKeyPairSync, sign } from "node:crypto"
import { Client } from "pg"
import { registerPhone, checkIn, deviceFingerprint, type Post } from "@/lib/mobile/check-in-flow"
import type { CheckInDevice, Fix } from "@/lib/mobile/native"
import { parsePhoneKey } from "@/lib/attendance/phone-keys"
import { checkInSchema, challengeSchema, registerPhoneSchema } from "@/lib/validations/attendance-phone.schema"
import { AttendanceChallengeService as Challenges } from "@/lib/services/attendance-challenge.service"
import { AttendancePhoneService as Phones } from "@/lib/services/attendance-phone.service"
import { AttendanceCheckInService as CheckIns } from "@/lib/services/attendance-check-in.service"
import { AttendanceLocationService as Locations } from "@/lib/services/attendance-location.service"

/**
 * The check-in screen's two flows (lib/mobile/check-in-flow.ts) against the
 * real server: what the app would send, validated by the routes' own schemas
 * and handed to the real services in a real Postgres. A stand-in phone holds
 * a real P-256 key, as the secure hardware would. If the screen and the
 * server ever disagree on what is signed, these fail.
 */

vi.mock("@/lib/attendance/attestation", () => ({
    attestationMode: () => "testing",
    verifyAttestation: async () => ({ verified: false, reason: "NOT_CONFIGURED" }),
}))

const ADMIN_URL = process.env.ROLES_TEST_DATABASE_URL
const MIGRATIONS = readdirSync("prisma/migrations").filter(m => m !== "migration_lock.toml").sort((a, b) => (a === "0_init" ? -1 : b === "0_init" ? 1 : a.localeCompare(b)))
const sql = (name: string) => readFileSync(`prisma/migrations/${name}/migration.sql`, "utf8")
const BEFORE_ROLES = `
INSERT INTO "Company"(id, name, "updatedAt") VALUES ('c1', 'One', now());
INSERT INTO "User"(id, email, password, "firstName", "lastName", role, "lastDayOffResetYear", username, "companyId", "teamLeaderId") VALUES
 ('a1', 'a1@x', 'p', 'Amal', 'One', 'ADMIN', 2026, 'a1', 'c1', NULL),
 ('e1', 'e1@x', 'p', 'Ehab', 'One', 'EMPLOYEE', 2026, 'e1', 'c1', NULL);
`

/** A phone as the plugin presents it, holding a real key; it records what it is asked, in order. */
function standInPhone(fix: Fix): CheckInDevice & { asked: string[]; keysMade: number } {
    let privateKey: ReturnType<typeof generateKeyPairSync>["privateKey"] | null = null
    let publicKey: string | null = null
    const phone = {
        platform: "ANDROID" as const, asked: [] as string[], keysMade: 0,
        info: async () => ({ model: "Pixel 8", appVersion: "1.0.0" }),
        publicKey: async () => publicKey,
        createKey: async () => {
            const pair = generateKeyPairSync("ec", { namedCurve: "prime256v1" })
            privateKey = pair.privateKey
            publicKey = pair.publicKey.export({ format: "der", type: "spki" }).toString("base64")
            phone.keysMade++
            return publicKey
        },
        sign: async (text: string) => { phone.asked.push("sign"); return sign("sha256", Buffer.from(text), { key: privateKey!, dsaEncoding: "der" }).toString("base64") },
        location: async () => { phone.asked.push("location"); return fix },
        attestation: async () => null,
    }
    return phone
}

/** What the routes do with the body, without HTTP: the same schemas, then the same services. */
function serverFor(userId: string): Post & { sent: string[] } {
    const sent: string[] = []
    const post = async (url: string, body: unknown) => {
        sent.push(url)
        if (url === "/api/attendance/phone/challenge") return Challenges.issue(userId, challengeSchema.parse(body).purpose)
        if (url === "/api/attendance/phone/register") return Phones.register("c1", userId, registerPhoneSchema.parse(body))
        if (url === "/api/attendance/check-in") return CheckIns.checkIn("c1", userId, checkInSchema.parse(body), null)
        throw new Error(`unexpected ${url}`)
    }
    return Object.assign(post, { sent })
}

describe.skipIf(!ADMIN_URL)("the check-in screen's flows, against the server", () => {
    const dbName = `mobile_flow_test_${Date.now()}`
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
        process.env.POSTGRES_PRISMA_URL = url.toString()
        const office = await Locations.create("c1", { name: "Head office", latitude: 30.0444, longitude: 31.2357, radiusMeters: 100 }, "a1")
        await Locations.setPeople(office.id, ["e1"], "a1")
    }, 180_000)

    afterAll(async () => {
        await (await import("@/lib/prisma")).prisma.$disconnect()
        await db?.end()
        const admin = new Client({ connectionString: ADMIN_URL })
        await admin.connect()
        await admin.query(`DROP DATABASE IF EXISTS ${dbName}`)
        await admin.end()
    })

    const phone = standInPhone({ latitude: 30.0445, longitude: 31.2357, accuracyMeters: 12, mocked: false })

    it("registers the phone with a new key the server accepts, and knows it by the server's fingerprint", async () => {
        const registered = await registerPhone(phone, serverFor("e1"))
        expect(registered).toMatchObject({ status: "PENDING", platform: "ANDROID", model: "Pixel 8" })
        const { rows: [row] } = await db.query(`SELECT "keyFingerprint", "appVersion" FROM "CheckInPhone" WHERE id = $1`, [registered.id])
        expect(await deviceFingerprint(phone)).toBe(row.keyFingerprint)
        expect(row.keyFingerprint).toBe(parsePhoneKey((await phone.publicKey())!)!.fingerprint)
        expect(row.appVersion).toBe("1.0.0")
        expect(phone.keysMade).toBe(1)
    })

    it("checks in, held while the phone waits, then counted from the approved phone; the fix comes before the number", async () => {
        const server = serverFor("e1")
        phone.asked.length = 0
        expect(await checkIn(phone, server, "IN")).toMatchObject({ outcome: "HELD", place: { name: "Head office" }, distanceMeters: 11, late: null })
        expect(phone.asked).toEqual(["location", "sign"])
        expect(server.sent).toEqual(["/api/attendance/phone/challenge", "/api/attendance/check-in"])
        const { rows: [p] } = await db.query(`SELECT id FROM "CheckInPhone" WHERE "userId" = 'e1' AND status = 'PENDING'`)
        await Phones.decide(p.id, { approve: true }, "a1")
        // Attestation is in testing: counted once the Super Admin decides it.
        expect(await checkIn(phone, serverFor("e1"), "OUT")).toMatchObject({ outcome: "FLAGGED", reasons: ["ATTESTATION_UNVERIFIED"] })
        const { rows } = await db.query(`SELECT direction FROM "AttendancePunch" WHERE "userId" = 'e1' ORDER BY "receivedAt"`)
        expect(rows.map(r => r.direction)).toEqual(["IN", "OUT"])
    })

    it("says a simulated location is refused, as the server answers it", async () => {
        const faker = standInPhone({ latitude: 30.0445, longitude: 31.2357, accuracyMeters: 5, mocked: true })
        await expect(checkIn(faker, serverFor("e1"), null)).rejects.toThrow("NO_PHONE_KEY")
        // Same key as the approved phone, a mocked fix.
        Object.assign(faker, { publicKey: phone.publicKey, sign: phone.sign })
        expect(await checkIn(faker, serverFor("e1"), null)).toEqual({ outcome: "REFUSED", reason: "MOCK_LOCATION" })
    })
})

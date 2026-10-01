import { describe, it, expect, beforeAll, afterAll, vi } from "vitest"
import { readFileSync, readdirSync } from "node:fs"
import { Client } from "pg"
import { AttendanceAgentService as Agents } from "@/lib/services/attendance-agent.service"

/**
 * Local Sync Agents against a real Postgres built from the migrations
 * (ATTENDANCE_PLAN.md §17, Phase 2): enrolment with a one-time code, the
 * token that follows, its rotation, and revocation.
 */

const ADMIN_URL = process.env.ROLES_TEST_DATABASE_URL
const MIGRATIONS = readdirSync("prisma/migrations").filter(m => m !== "migration_lock.toml").sort((a, b) => (a === "0_init" ? -1 : b === "0_init" ? 1 : a.localeCompare(b)))
const sql = (name: string) => readFileSync(`prisma/migrations/${name}/migration.sql`, "utf8")

const BEFORE_ROLES = `
INSERT INTO "Company"(id, name, "updatedAt") VALUES ('c1', 'One', now()), ('c2', 'Two', now());
INSERT INTO "User"(id, email, password, "firstName", "lastName", role, "lastDayOffResetYear", username, "companyId", "teamLeaderId") VALUES
 ('a1', 'a1@x', 'p', 'Amal', 'One', 'ADMIN', 2026, 'a1', 'c1', NULL);
`

describe.skipIf(!ADMIN_URL)("attendance agents, in Postgres", () => {
    const dbName = `agents_test_${Date.now()}`
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
        process.env.POSTGRES_PRISMA_URL = url.toString()
    }, 180_000)

    afterAll(async () => {
        vi.useRealTimers()
        await (await import("@/lib/prisma")).prisma.$disconnect()
        await db?.end()
        const admin = new Client({ connectionString: ADMIN_URL })
        await admin.connect()
        await admin.query(`DROP DATABASE IF EXISTS ${dbName}`)
        await admin.end()
    })

    const row = async (id: string) => (await db.query(`SELECT * FROM "AttendanceAgent" WHERE id = $1`, [id])).rows[0]

    it("adds an agent with a one-time code, kept only as a hash, and enrols it once", async () => {
        const { agent, code } = await Agents.create("c1", "  Head office ", "a1")
        expect(agent).toMatchObject({ name: "Head office", status: "PENDING" })
        expect(code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/)
        const stored = await row(agent.id)
        expect(JSON.stringify(stored)).not.toContain(code)
        expect(stored.codeHash).toMatch(/^[0-9a-f]{64}$/)

        const enrolled = await Agents.enrol(code.toLowerCase().replace("-", " "), { hostname: "OFFICE-PC", agentVersion: "1.0.0" })
        expect(enrolled).toMatchObject({ agentId: agent.id, name: "Head office", company: "One" })
        expect(enrolled.token).toMatch(/^mka_/)
        const after = await row(agent.id)
        expect(after).toMatchObject({ status: "ACTIVE", codeHash: null, hostname: "OFFICE-PC", agentVersion: "1.0.0" })
        expect(JSON.stringify(after)).not.toContain(enrolled.token)
        // Once only.
        await expect(Agents.enrol(code, {})).rejects.toThrow("ENROLMENT_CODE_INVALID")
        expect(await Agents.authenticate(enrolled.token)).toEqual({ id: agent.id, companyId: "c1", name: "Head office", timeZone: expect.any(String) })
    })

    it("refuses a code that has run out, or never was, the same way", async () => {
        const { agent, code } = await Agents.create("c1", "Branch", "a1")
        await db.query(`UPDATE "AttendanceAgent" SET "codeExpiresAt" = now() - interval '1 minute' WHERE id = $1`, [agent.id])
        await expect(Agents.enrol(code, {})).rejects.toThrow("ENROLMENT_CODE_INVALID")
        await expect(Agents.enrol("AAAA-AAAA", {})).rejects.toThrow("ENROLMENT_CODE_INVALID")
        await expect(Agents.enrol("not a code", {})).rejects.toThrow("ENROLMENT_CODE_INVALID")
        // A new code works.
        const { code: again } = await Agents.reissueCode(agent.id, "a1")
        expect((await Agents.enrol(again, {})).agentId).toBe(agent.id)
    })

    it("lets one of two agents racing with the same code enrol", async () => {
        const { code } = await Agents.create("c1", "Race", "a1")
        const outcomes = await Promise.allSettled([Agents.enrol(code, { hostname: "A" }), Agents.enrol(code, { hostname: "B" })])
        expect(outcomes.map(o => o.status).sort()).toEqual(["fulfilled", "rejected"])
    })

    it("rotates a token without locking the agent out: the old one works until the new one is used", async () => {
        const { agent, code } = await Agents.create("c1", "Rotating", "a1")
        const { token: first } = await Agents.enrol(code, {})
        const me = await Agents.authenticate(first)
        if ("refused" in me) throw new Error("refused")
        const { token: second } = await Agents.rotate(me)
        // The reply could have been lost: the first still works.
        expect(await Agents.authenticate(first)).toMatchObject({ id: agent.id })
        expect(await Agents.authenticate(second)).toMatchObject({ id: agent.id })
        // Once the new one is used, the old one is gone.
        expect(await Agents.authenticate(first)).toEqual({ refused: "UNAUTHENTICATED" })
        expect(await Agents.authenticate(second)).toMatchObject({ id: agent.id })
    })

    it("moves an agent to a new PC with a new code: the old PC stops at once", async () => {
        const { agent, code } = await Agents.create("c1", "Moving", "a1")
        const { token: oldPc } = await Agents.enrol(code, { hostname: "OLD" })
        const { code: fresh } = await Agents.reissueCode(agent.id, "a1")
        // Until the new PC enrols, the old one carries on.
        expect(await Agents.authenticate(oldPc)).toMatchObject({ id: agent.id })
        const { token: newPc } = await Agents.enrol(fresh, { hostname: "NEW" })
        expect(await Agents.authenticate(oldPc)).toEqual({ refused: "UNAUTHENTICATED" })
        expect(await Agents.authenticate(newPc)).toMatchObject({ id: agent.id })
    })

    it("revokes: the token and any outstanding code stop working, and the agent stays listed", async () => {
        const { agent, code } = await Agents.create("c1", "Closing", "a1")
        const { token } = await Agents.enrol(code, {})
        const { code: pending } = await Agents.reissueCode(agent.id, "a1")
        await Agents.revoke(agent.id, "a1")
        expect(await Agents.authenticate(token)).toEqual({ refused: "UNAUTHENTICATED" })
        await expect(Agents.enrol(pending, {})).rejects.toThrow("ENROLMENT_CODE_INVALID")
        await expect(Agents.revoke(agent.id, "a1")).rejects.toThrow("AGENT_REVOKED")
        await expect(Agents.reissueCode(agent.id, "a1")).rejects.toThrow("AGENT_REVOKED")
        expect((await Agents.list("c1")).find(a => a.id === agent.id)).toMatchObject({ status: "REVOKED" })
        const { rows: audit } = await db.query(`SELECT action FROM "AuditLog" WHERE "entityId" = $1 ORDER BY "createdAt"`, [agent.id])
        expect(audit.map(a => a.action)).toEqual(["CREATE_ATTENDANCE_AGENT", "ENROL_ATTENDANCE_AGENT", "REISSUE_ATTENDANCE_AGENT_CODE", "REVOKE_ATTENDANCE_AGENT"])
    })

    it("refuses an agent whose company is banned, or no longer holds the Terminals add-on", async () => {
        const { code } = await Agents.create("c2", "Theirs", "a1")
        const { token } = await Agents.enrol(code, {})
        expect(await Agents.authenticate(token)).toMatchObject({ companyId: "c2" })
        await db.query(`INSERT INTO "Package"(id, name, "hasHR", "hasAttendanceMobile", "updatedAt") VALUES ('mobile', 'Mobile only', true, true, now())`)
        await db.query(`UPDATE "Company" SET "packageId" = 'mobile' WHERE id = 'c2'`)
        expect(await Agents.authenticate(token)).toEqual({ refused: "TERMINALS_NOT_INCLUDED" })
        await db.query(`UPDATE "Company" SET "packageId" = NULL, "isBanned" = true WHERE id = 'c2'`)
        expect(await Agents.authenticate(token)).toEqual({ refused: "COMPANY_BANNED" })
    })

    it("keeps a revoked agent from holding anything that works, at the database", async () => {
        const { agent } = await Agents.create("c1", "Checked", "a1")
        await expect(db.query(`UPDATE "AttendanceAgent" SET status = 'REVOKED', "revokedAt" = now() WHERE id = $1`, [agent.id])).rejects.toThrow(/AttendanceAgent_revoked/)
    })
})

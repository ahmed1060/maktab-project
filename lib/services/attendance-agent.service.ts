import { prisma } from "@/lib/prisma"
import { Prisma } from "@prisma/client"
import { AuditLogService } from "./audit-log.service"
import { ENROLMENT_CODE_MINUTES, hashSecret, newAgentToken, newEnrolmentCode, normaliseEnrolmentCode } from "@/lib/attendance/agent-credentials"
import { hasBundle, resolveBundles } from "@/lib/features/bundles"

/**
 * Local Sync Agents (ATTENDANCE_PLAN.md §17): the programs on office PCs that
 * read a company's fingerprint terminals and send their punches here.
 *
 * An admin adds one and is shown a one-time code; the agent exchanges the
 * code for a token and sends that on every request. The company is the
 * agent's own — nothing an agent sends can name another. Revoking an agent
 * makes its token worthless at once; its terminals and their punches stay.
 */

function fail(code: string): never {
    throw new Error(code)
}

async function actorOf(tx: Prisma.TransactionClient, actorId: string) {
    const superAdmin = await tx.superAdmin.findUnique({ where: { id: actorId }, select: { id: true } })
    return superAdmin ? { superAdminId: actorId } : { userId: actorId }
}

const codeExpiry = () => new Date(Date.now() + ENROLMENT_CODE_MINUTES * 60_000)

/** What an agent's request carries once its token is checked. */
export type AuthenticatedAgent = { id: string; companyId: string; name: string; timeZone: string }

const SHOWN = {
    id: true, name: true, status: true, codeExpiresAt: true, hostname: true, agentVersion: true,
    enrolledAt: true, lastSeenAt: true, lastSyncAt: true, queueDepth: true, clockDriftSeconds: true,
    createdAt: true, revokedAt: true,
} as const

export class AttendanceAgentService {
    static async list(companyId: string) {
        return prisma.attendanceAgent.findMany({ where: { companyId }, orderBy: [{ revokedAt: { sort: "desc", nulls: "first" } }, { createdAt: "asc" }], select: SHOWN })
    }

    static async agentOf(id: string) {
        return prisma.attendanceAgent.findUnique({ where: { id }, select: { id: true, companyId: true, status: true } })
    }

    /** A new agent, waiting for its code. The code is returned once and never again. */
    static async create(companyId: string, name: string, actorId: string) {
        const trimmed = name.trim()
        if (!trimmed) fail("AGENT_NAME_REQUIRED")
        const code = newEnrolmentCode()
        const agent = await prisma.$transaction(async tx => {
            const created = await tx.attendanceAgent.create({
                data: { companyId, name: trimmed, codeHash: hashSecret(code), codeExpiresAt: codeExpiry(), createdById: actorId },
                select: SHOWN,
            })
            await AuditLogService.log("CREATE_ATTENDANCE_AGENT", "ATTENDANCE_AGENT", created.id, {
                tx, ...(await actorOf(tx, actorId)), details: { companyId, name: trimmed },
            })
            return created
        })
        return { agent, code }
    }

    /**
     * A fresh code for an agent: one whose first code ran out, or one moving
     * to a new PC. Enrolling with it replaces the agent's token, so the old
     * PC stops working the moment the new one starts.
     */
    static async reissueCode(id: string, actorId: string) {
        const code = newEnrolmentCode()
        const agent = await prisma.$transaction(async tx => {
            const current = await tx.attendanceAgent.findUnique({ where: { id }, select: { companyId: true, status: true, name: true } }) ?? fail("AGENT_NOT_FOUND")
            if (current.status === "REVOKED") fail("AGENT_REVOKED")
            const updated = await tx.attendanceAgent.update({ where: { id }, data: { codeHash: hashSecret(code), codeExpiresAt: codeExpiry() }, select: SHOWN })
            await AuditLogService.log("REISSUE_ATTENDANCE_AGENT_CODE", "ATTENDANCE_AGENT", id, {
                tx, ...(await actorOf(tx, actorId)), details: { companyId: current.companyId, name: current.name },
            })
            return updated
        })
        return { agent, code }
    }

    /** Revoked: its token and any code stop working now. Its terminals keep their history. */
    static async revoke(id: string, actorId: string) {
        await prisma.$transaction(async tx => {
            const current = await tx.attendanceAgent.findUnique({ where: { id }, select: { companyId: true, status: true, name: true } }) ?? fail("AGENT_NOT_FOUND")
            if (current.status === "REVOKED") fail("AGENT_REVOKED")
            await tx.attendanceAgent.update({
                where: { id },
                data: { status: "REVOKED", revokedAt: new Date(), revokedById: actorId, codeHash: null, codeExpiresAt: null, tokenHash: null, nextTokenHash: null },
            })
            await AuditLogService.log("REVOKE_ATTENDANCE_AGENT", "ATTENDANCE_AGENT", id, {
                tx, ...(await actorOf(tx, actorId)), details: { companyId: current.companyId, name: current.name },
            })
        })
    }

    // --- the agent's side -------------------------------------------------------

    /**
     * Exchanges a one-time code for a token. Every way a code can be wrong —
     * unknown, used, expired, revoked — is the same answer, so a guess learns
     * nothing. Conditional on the code still being there, so two agents
     * racing with one code cannot both enrol.
     */
    static async enrol(typed: string, about: { hostname?: string | null; agentVersion?: string | null }) {
        const code = normaliseEnrolmentCode(typed)
        if (!code) fail("ENROLMENT_CODE_INVALID")
        const codeHash = hashSecret(code)
        const token = newAgentToken()
        const now = new Date()
        return prisma.$transaction(async tx => {
            const agent = await tx.attendanceAgent.findUnique({
                where: { codeHash },
                select: { id: true, companyId: true, name: true, status: true, codeExpiresAt: true, company: { select: { name: true, timezone: true } } },
            })
            if (!agent || agent.status === "REVOKED" || !agent.codeExpiresAt || agent.codeExpiresAt <= now) fail("ENROLMENT_CODE_INVALID")
            const { count } = await tx.attendanceAgent.updateMany({
                where: { id: agent.id, codeHash },
                data: {
                    status: "ACTIVE", codeHash: null, codeExpiresAt: null, tokenHash: hashSecret(token), nextTokenHash: null, tokenIssuedAt: now,
                    enrolledAt: now, hostname: about.hostname?.slice(0, 200) || null, agentVersion: about.agentVersion?.slice(0, 50) || null,
                },
            })
            if (count === 0) fail("ENROLMENT_CODE_INVALID")
            await AuditLogService.log("ENROL_ATTENDANCE_AGENT", "ATTENDANCE_AGENT", agent.id, {
                tx, details: { companyId: agent.companyId, name: agent.name, hostname: about.hostname ?? null, agentVersion: about.agentVersion ?? null },
            })
            return { token, agentId: agent.id, name: agent.name, company: agent.company.name, timeZone: agent.company.timezone }
        })
    }

    /**
     * The agent a token belongs to, if it may act now: enrolled, not revoked,
     * its company not banned and still holding the Terminals add-on (§16 —
     * removing it stops new punches from terminals). A token issued by
     * rotation becomes the agent's only token the first time it is used.
     */
    static async authenticate(token: string): Promise<AuthenticatedAgent | { refused: "UNAUTHENTICATED" | "COMPANY_BANNED" | "TERMINALS_NOT_INCLUDED" }> {
        const tokenHash = hashSecret(token)
        const agent = await prisma.attendanceAgent.findFirst({
            where: { status: "ACTIVE", OR: [{ tokenHash }, { nextTokenHash: tokenHash }] },
            select: {
                id: true, companyId: true, name: true, nextTokenHash: true,
                company: { select: { isBanned: true, timezone: true, package: { select: { hasCompanyManagement: true, hasHR: true, hasAttendanceTerminals: true, hasAttendanceMobile: true } } } },
            },
        })
        if (!agent) return { refused: "UNAUTHENTICATED" }
        if (agent.company.isBanned) return { refused: "COMPANY_BANNED" }
        if (!hasBundle(resolveBundles(agent.company.package), "ATTENDANCE_TERMINALS")) return { refused: "TERMINALS_NOT_INCLUDED" }
        if (agent.nextTokenHash === tokenHash) {
            await prisma.attendanceAgent.updateMany({ where: { id: agent.id, nextTokenHash: tokenHash }, data: { tokenHash, nextTokenHash: null, tokenIssuedAt: new Date() } })
        }
        return { id: agent.id, companyId: agent.companyId, name: agent.name, timeZone: agent.company.timezone }
    }

    /**
     * A new token. The current one keeps working until the agent first uses
     * the new one: a reply lost on the way, or a PC that crashes before
     * saving it, must not lock the office's terminals out.
     */
    static async rotate(agent: AuthenticatedAgent) {
        const token = newAgentToken()
        await prisma.attendanceAgent.update({ where: { id: agent.id }, data: { nextTokenHash: hashSecret(token) } })
        return { token }
    }
}

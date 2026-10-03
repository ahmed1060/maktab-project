import { NextResponse } from "next/server"
import { knownRefusal } from "@/lib/api-errors"
import { RateLimiter, getClientIp } from "@/lib/api-utils"
import { AuditLogService } from "@/lib/services/audit-log.service"
import { AttendanceAgentService, type AuthenticatedAgent } from "@/lib/services/attendance-agent.service"
import { isNextInternalError } from "@/lib/next-internal-error"
import { bearerToken } from "./agent-credentials"

/**
 * The agent's side of the API (ATTENDANCE_PLAN.md §17): `/api/agent/*`.
 * There is no session here — an agent is a program on an office PC — so
 * this stands in for withStandardHandler: the token, not a cookie, says who
 * is calling, and the company comes from the token alone.
 *
 * Answers are JSON with a stable `code` beside the message, since the
 * reader is a program deciding whether to retry, re-enrol or give up.
 */

/** The largest body an agent may send: a batch of punches is a few hundred kilobytes. */
export const AGENT_BODY_LIMIT = 2 * 1024 * 1024

/** Generous for a well-behaved agent (one batch or heartbeat every few seconds), tight for a loop. */
const PER_MINUTE = 120

const refuse = (status: number, code: string, error: string) => NextResponse.json({ success: false, code, error }, { status })

/** The body as JSON, refused if too large or not an object. */
async function readBody(req: Request): Promise<{ body: Record<string, unknown> } | { refused: NextResponse }> {
    const declared = Number(req.headers.get("content-length") ?? 0)
    if (declared > AGENT_BODY_LIMIT) return { refused: refuse(413, "BODY_TOO_LARGE", "The request is too large. Send fewer punches at once.") }
    const text = await req.text().catch(() => "")
    if (text.length > AGENT_BODY_LIMIT) return { refused: refuse(413, "BODY_TOO_LARGE", "The request is too large. Send fewer punches at once.") }
    if (!text.trim()) return { body: {} }
    try {
        const body = JSON.parse(text)
        if (body === null || typeof body !== "object" || Array.isArray(body)) return { refused: refuse(400, "INVALID_BODY", "The request body must be a JSON object.") }
        return { body }
    } catch {
        return { refused: refuse(400, "INVALID_BODY", "The request body isn't valid JSON.") }
    }
}

async function failed(req: Request, error: unknown, agentId: string | null) {
    if (isNextInternalError(error)) throw error
    const refusal = knownRefusal(error)
    if (refusal) return refuse(refusal.status, (error as Error).message, refusal.message)
    console.error("Agent API error:", error)
    const ref = await AuditLogService.logSystemError({ error, route: new URL(req.url).pathname, method: req.method, extra: { agentId } })
    return refuse(500, "SERVER_ERROR", AuditLogService.friendlyErrorMessage(ref))
}

const REFUSED = {
    UNAUTHENTICATED: [401, "This agent isn't enrolled, or has been revoked. Enrol it again with a new code."],
    COMPANY_BANNED: [403, "This company's account is suspended."],
    TERMINALS_NOT_INCLUDED: [403, "Attendance terminals aren't included in this company's package."],
} as const

/** A route an enrolled agent calls with its token. */
export function withAgentHandler(handler: (req: Request, agent: AuthenticatedAgent, body: Record<string, unknown>) => Promise<NextResponse>) {
    return async (req: Request) => {
        let agentId: string | null = null
        try {
            const token = bearerToken(req.headers.get("authorization"))
            if (!token) return refuse(401, "UNAUTHENTICATED", REFUSED.UNAUTHENTICATED[1])
            const agent = await AttendanceAgentService.authenticate(token)
            if ("refused" in agent) return refuse(REFUSED[agent.refused][0], agent.refused, REFUSED[agent.refused][1])
            agentId = agent.id
            const { limited } = await RateLimiter.getLimitData(`agent:${agent.id}`, PER_MINUTE, 60_000)
            if (limited) return refuse(429, "RATE_LIMITED", "Too many requests from this agent. Wait a minute and try again.")
            const read = await readBody(req)
            if ("refused" in read) return read.refused
            return await handler(req, agent, read.body)
        } catch (error) {
            return failed(req, error, agentId)
        }
    }
}

/** Enrolment: the one agent route with no token yet. Limited by address, since a code is short. */
export function withEnrolmentHandler(handler: (req: Request, body: Record<string, unknown>) => Promise<NextResponse>) {
    return async (req: Request) => {
        try {
            const { limited } = await RateLimiter.getLimitData(`agent-enrol:${getClientIp(req.headers)}`, 10, 15 * 60_000)
            if (limited) return refuse(429, "RATE_LIMITED", "Too many enrolment attempts from this address. Wait fifteen minutes and try again.")
            const read = await readBody(req)
            if ("refused" in read) return read.refused
            return await handler(req, read.body)
        } catch (error) {
            return failed(req, error, null)
        }
    }
}

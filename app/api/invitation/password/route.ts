import { NextRequest } from "next/server"
import { ApiResponse } from "@/lib/api-response"
import { knownRefusal } from "@/lib/api-errors"
import { resetHeldBack } from "@/lib/password-reset"
import { RateLimiter, getClientIp } from "@/lib/api-utils"
import { setInvitationPassword } from "@/lib/services/client-invitation.service"
import { AuditLogService } from "@/lib/services/audit-log.service"
import { isNextInternalError } from "@/lib/next-internal-error"

/**
 * Setting a password from an invitation (CLIENT_PORTAL_PLAN.md §5.2, step
 * 6b-1): once, for 72 hours. Open to anyone with the link, so each place's
 * tries are counted, with reading a link's (../route.ts): 10 in 15 minutes.
 */
export async function POST(req: NextRequest) {
    try {
        const ip = getClientIp(req.headers)
        const { limited, resetAt } = await RateLimiter.getLimitData(`invitation:${ip}`, 10, 15 * 60 * 1000)
        if (limited) return resetHeldBack(resetAt)
        const body = await req.json().catch(() => null)
        return ApiResponse.success(await setInvitationPassword(body))
    } catch (error) {
        if (isNextInternalError(error)) throw error
        const refusal = knownRefusal(error)
        if (refusal) return ApiResponse.refused(refusal.status, refusal.message, (error as Error).message)
        console.error("Invitation password error:", error)
        const ref = await AuditLogService.logSystemError({ error, route: "/api/invitation/password", method: "POST" })
        return ApiResponse.error(AuditLogService.friendlyErrorMessage(ref))
    }
}

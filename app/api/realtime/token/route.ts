import { cookies } from "next/headers"
import { withStandardHandler } from "@/lib/api-utils"
import { ApiResponse } from "@/lib/api-response"
import { SCOPED_COMPANY_COOKIE, scopedCompanyId } from "@/lib/company-scope"
import { liveTopics } from "@/lib/live-updates"
import { realtimeClaims, signRealtimeToken } from "@/lib/realtime-token"

/**
 * The token a browser listens to its live-update channels with, and which
 * channels those are (REALTIME_PLAN.md): its company's tasks, or the company
 * in view's for the Super Admin, and its own notifications.
 *
 * Through the standard checks, so a person suspended, archived or banned, or
 * in maintenance, is given none. The token lets them only listen: the
 * signals say that something changed, never what.
 *
 * Off until the project's JWT secret is in Vercel: every screen goes on as
 * today, asking on its own schedule.
 */
export const GET = withStandardHandler(async (req, session) => {
    const secret = process.env.SUPABASE_JWT_SECRET
    if (!secret) return ApiResponse.success({ off: true })
    const cookieStore = await cookies()
    const claims = realtimeClaims(session.user, Math.floor(Date.now() / 1000))
    return ApiResponse.success({
        token: signRealtimeToken(claims, secret),
        expiresAt: claims.exp * 1000,
        topics: liveTopics(session.user, scopedCompanyId(session.user.role, cookieStore.get(SCOPED_COMPANY_COOKIE)?.value)),
    })
})

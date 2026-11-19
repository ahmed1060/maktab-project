import { RateLimiter, withStandardHandler } from "@/lib/api-utils"
import { ApiResponse } from "@/lib/api-response"
import { appOrigin } from "@/lib/app-origin"
import { resetHeldBack } from "@/lib/password-reset"
import { assertStepUp } from "@/lib/step-up"
import { resendClientInvitation } from "@/lib/services/client-account.service"

// Stops within a minute, so the email is sent or given up well before the
// person's invitation can be sent again (RESEND_GAP_MINUTES in
// lib/client-invitation.ts; PR 325).
export const maxDuration = 60

/**
 * Resend invitation (CLIENT_PORTAL_PLAN.md §5.2, step 6b-2; PR 325): a new
 * link for one of a client's people still invited, and the earlier one stops
 * working. It emails someone outside the company a way in, so it asks for
 * the step-up confirmation first, as adding them does (§9); and each
 * person's invitation goes again at most 5 times an hour, so nobody's inbox
 * fills with them. The link is to Nizmo's own address (lib/app-origin.ts).
 */
export const POST = withStandardHandler(async (req, session, _json, { params }) => {
    await assertStepUp(session, "client_accounts.manage")
    const { limited, resetAt } = await RateLimiter.getLimitData(`invitation-resend:${params.id}`, 5, 60 * 60 * 1000)
    if (limited) return resetHeldBack(resetAt)
    return ApiResponse.success(await resendClientInvitation(session.user as any, params.id, new Date(), appOrigin(req.url)))
}, { permission: "client_accounts.manage" })

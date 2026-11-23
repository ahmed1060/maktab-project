import { withStandardHandler } from "@/lib/api-utils"
import { ApiResponse } from "@/lib/api-response"
import { assertStepUp } from "@/lib/step-up"
import { appOrigin } from "@/lib/app-origin"
import { addClientPerson, clientPeople } from "@/lib/services/client-account.service"

// Stops within a minute, so the invitation's email is sent or given up well
// before it can be sent again (RESEND_GAP_MINUTES in
// lib/client-invitation.ts; PR 325).
export const maxDuration = 60

/**
 * A client's people who sign in to the client portal (CLIENT_PORTAL_PLAN.md
 * §5.2), in a company whose package has the client portal: the path is the
 * tax position's module's in lib/features/routes.ts. Listing them is
 * client_accounts.view's, adding one client_accounts.invite's (split from
 * client_accounts.manage, LATER_CHANGES_PLAN.md §2, PR 381).
 *
 * GET lists a client's people, and asks for no code: it changes nothing.
 * POST adds one, as invited: it's what lets someone from outside the
 * company in, so it asks for the step-up confirmation first (§9). Their
 * invitation is emailed to them, its link to Nizmo's own address, never one
 * the request names (lib/app-origin.ts; PR 325).
 */
export const GET = withStandardHandler(async (req, session) => {
    return ApiResponse.success(await clientPeople(session.user as any, new URL(req.url).searchParams.get("clientId")))
}, { permission: "client_accounts.view" })

export const POST = withStandardHandler(async (req, session, body) => {
    await assertStepUp(session, "client_accounts.invite")
    return ApiResponse.success(await addClientPerson(session.user as any, body, new Date(), appOrigin(req.url)), 201)
}, { permission: "client_accounts.invite" })

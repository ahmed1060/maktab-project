import { withStandardHandler } from "@/lib/api-utils"
import { ApiResponse } from "@/lib/api-response"
import { assertStepUp } from "@/lib/step-up"
import { addClientPerson, clientPeople } from "@/lib/services/client-account.service"

/**
 * A client's people who sign in to the client portal (CLIENT_PORTAL_PLAN.md
 * §5.2), for whoever may manage them, in a company whose package has the
 * client portal: the path is the tax position's module's in
 * lib/features/routes.ts.
 *
 * GET lists a client's people, and asks for no code: it changes nothing.
 * POST adds one, as invited: it's what lets someone from outside the
 * company in, so it asks for the step-up confirmation first (§9).
 */
export const GET = withStandardHandler(async (req, session) => {
    return ApiResponse.success(await clientPeople(session.user as any, new URL(req.url).searchParams.get("clientId")))
}, { permission: "client_accounts.manage" })

export const POST = withStandardHandler(async (_req, session, body) => {
    await assertStepUp(session, "client_accounts.manage")
    return ApiResponse.success(await addClientPerson(session.user as any, body), 201)
}, { permission: "client_accounts.manage" })

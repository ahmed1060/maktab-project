import { withStandardHandler } from "@/lib/api-utils"
import { ApiResponse } from "@/lib/api-response"
import { assertStepUp } from "@/lib/step-up"
import { removeClientPerson } from "@/lib/services/client-account.service"

/**
 * Removing one of a client's people (CLIENT_PORTAL_PLAN.md §5.2): their
 * account goes, and with it their sign-in. It asks for the step-up
 * confirmation first, as every use of a high-risk permission that changes
 * something does (§9).
 */
export const DELETE = withStandardHandler(async (_req, session, _json, { params }) => {
    await assertStepUp(session, "client_accounts.manage")
    return ApiResponse.success(await removeClientPerson(session.user as any, params.id))
}, { permission: "client_accounts.manage" })

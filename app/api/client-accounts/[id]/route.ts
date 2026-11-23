import { withStandardHandler } from "@/lib/api-utils"
import { ApiResponse } from "@/lib/api-response"
import { removeClientPerson } from "@/lib/services/client-account.service"

/**
 * Removing one of a client's people (CLIENT_PORTAL_PLAN.md §5.2): their
 * account goes, and with it their sign-in. client_accounts.remove's (PR 381),
 * which isn't high-risk, as it takes access away: it asks for no step-up
 * confirmation, as inviting does (LATER_CHANGES_PLAN.md §2).
 */
export const DELETE = withStandardHandler(async (_req, session, _json, { params }) => {
    return ApiResponse.success(await removeClientPerson(session.user as any, params.id))
}, { permission: "client_accounts.remove" })

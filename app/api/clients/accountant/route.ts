import { withStandardHandler } from "@/lib/api-utils"
import { ApiResponse } from "@/lib/api-response"
import { accountantCandidates, setClientAccountant } from "@/lib/services/client-accountant.service"

/**
 * A client's responsible accountant (CLIENT_PORTAL_PLAN.md §7, §12 step 9b;
 * PR 343), for whoever may edit clients, in a company whose package has
 * the client portal: the path is the tax position's module's in
 * lib/features/routes.ts.
 *
 * GET lists the client's company's people who may be picked. PUT picks one,
 * `{ clientId, userId }`, or no one with `userId: null`, and says who the
 * client's people can write to now. Its refusals are lib/api-errors.ts's.
 */
export const GET = withStandardHandler(async (req, session) => {
    return ApiResponse.success(await accountantCandidates(session.user as any, new URL(req.url).searchParams.get("clientId")))
}, { permission: "clients.edit" })

export const PUT = withStandardHandler(async (req, session, body) => {
    return ApiResponse.success(await setClientAccountant(session.user as any, body))
}, { permission: "clients.edit" })

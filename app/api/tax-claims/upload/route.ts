import { withStandardHandler } from "@/lib/api-utils"
import { ApiResponse } from "@/lib/api-response"
import { appOrigin } from "@/lib/app-origin"
import { saveTaxFile, taxClaimsNow } from "@/lib/services/tax-claim.service"

// Stops within a minute, the update email sent or given up by then
// (CLIENT_PORTAL_PLAN.md §4.4, PR 351), as the invitation's routes do.
export const maxDuration = 60

/**
 * Uploading the tax portal's export for a client (CLIENT_PORTAL_PLAN.md
 * §4.1), for whoever may update clients' tax position, in a company whose
 * package has the client portal: the path is under the tax position's in
 * lib/features/routes.ts.
 *
 * GET gives what an upload is checked against before anything is saved: the
 * client's claims as they are, and how many uploads it has had. POST saves
 * the claims the browser read, which the server checks again, in place of
 * the client's last, and emails the client's people where the company has
 * turned that on, its sign-in link to Nizmo's own address, never one the
 * request names (lib/app-origin.ts; PR 351).
 */
export const GET = withStandardHandler(async (req, session) => {
    return ApiResponse.success(await taxClaimsNow(session.user as any, new URL(req.url).searchParams.get("clientId")))
}, { permission: "tax.manage" })

export const POST = withStandardHandler(async (req, session, body) => {
    return ApiResponse.success(await saveTaxFile(session.user as any, body, new Date(), appOrigin(req.url)))
}, { permission: "tax.manage" })

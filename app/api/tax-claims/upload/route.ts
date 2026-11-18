import { withStandardHandler } from "@/lib/api-utils"
import { ApiResponse } from "@/lib/api-response"
import { saveTaxFile, taxClaimsNow } from "@/lib/services/tax-claim.service"

/**
 * Uploading the tax portal's export for a client (CLIENT_PORTAL_PLAN.md
 * §4.1), for whoever may update clients' tax position, in a company whose
 * package has the client portal: the path is under the tax position's in
 * lib/features/routes.ts.
 *
 * GET gives what an upload is checked against before anything is saved: the
 * client's claims as they are, and how many uploads it has had. POST saves
 * the claims the browser read, which the server checks again, in place of
 * the client's last.
 */
export const GET = withStandardHandler(async (req, session) => {
    return ApiResponse.success(await taxClaimsNow(session.user as any, new URL(req.url).searchParams.get("clientId")))
}, { permission: "tax.manage" })

export const POST = withStandardHandler(async (req, session, body) => {
    return ApiResponse.success(await saveTaxFile(session.user as any, body))
}, { permission: "tax.manage" })

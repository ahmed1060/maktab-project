import { withStandardHandler } from "@/lib/api-utils"
import { ApiResponse } from "@/lib/api-response"
import { parsePaging } from "@/lib/pagination"
import { taxPositionOf } from "@/lib/services/tax-claim.service"
import { TAX_PAGE, TAX_PREVIEW } from "@/lib/tax-claims"

/**
 * A client's tax position, for the Tax position section on its page
 * (CLIENT_PORTAL_PLAN.md §3.5): the day its figures are from, what its open
 * claims come to, and a page of them. For whoever may see tax positions, in a
 * company whose package has the client portal: the path is the tax
 * position's in lib/features/routes.ts.
 */
export const GET = withStandardHandler(async (req, session) => {
    const searchParams = new URL(req.url).searchParams
    return ApiResponse.success(await taxPositionOf(session.user as any, searchParams.get("clientId"), parsePaging(searchParams, TAX_PREVIEW, TAX_PAGE)))
}, { permission: "tax.view" })

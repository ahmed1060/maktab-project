export const dynamic = 'force-dynamic'

import { cookies } from "next/headers"
import { withStandardHandler } from "@/lib/api-utils"
import { ApiResponse } from "@/lib/api-response"
import { SCOPED_COMPANY_COOKIE, scopedCompanyId } from "@/lib/company-scope"
import { waitingForReview, type Viewer } from "@/lib/requests/feed"

/**
 * How many wait on the signed-in person under the Requests page's To review
 * tab, for the count on Requests in the side bar (DESIGN.md §5.1): read by
 * the feed the page reads, through each kind's own rule of who sees what.
 * The Super Admin's is the company they're looking at, from the cookie the
 * dashboard layout reads for the side bar's mark; scopedCompanyId ignores it
 * for anyone else.
 */
export const GET = withStandardHandler(async (_req, session) => {
    const companyId = scopedCompanyId(session.user.role, (await cookies()).get(SCOPED_COMPANY_COOKIE)?.value)
    return ApiResponse.success({ count: await waitingForReview(session.user as unknown as Viewer, companyId) })
})

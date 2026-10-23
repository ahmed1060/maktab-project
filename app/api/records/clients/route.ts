import { withStandardHandler } from "@/lib/api-utils"
import { ApiResponse } from "@/lib/api-response"
import { RecordService } from "@/lib/services/record.service"

/**
 * The clients a record can be added to, by name (CLIENTS_PLAN.md §0.2), for
 * the Records page's Add record: the first ones, or those a search by name
 * finds, and whether there are more. RecordService decides whose.
 */
export const GET = withStandardHandler(async (req, session) => {
    const params = new URL(req.url).searchParams
    return ApiResponse.success(await RecordService.clients(session, params.get("companyId"), params.get("search")?.slice(0, 100)))
}, { permission: "records.contribute" })

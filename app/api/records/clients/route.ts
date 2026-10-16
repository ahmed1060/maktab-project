import { withStandardHandler } from "@/lib/api-utils"
import { ApiResponse } from "@/lib/api-response"
import { RecordService } from "@/lib/services/record.service"

/**
 * The clients a record can be added to, by name (CLIENTS_PLAN.md §0.2), for
 * the Records page's Add record. RecordService decides whose.
 */
export const GET = withStandardHandler(async (req, session) => {
    const companyId = new URL(req.url).searchParams.get("companyId")
    return ApiResponse.success(await RecordService.clients(session, companyId))
}, { permission: "records.contribute" })

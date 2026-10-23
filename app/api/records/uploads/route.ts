import { withStandardHandler } from "@/lib/api-utils"
import { ApiResponse } from "@/lib/api-response"
import { discardUploadsSchema } from "@/lib/validations/record.schema"
import { RecordService } from "@/lib/services/record.service"

/**
 * Files uploaded for a record that was never saved with them (RecordForm):
 * removed again, so a closed form or an abandoned save leaves nothing behind.
 * RecordService decides which may go.
 */
export const DELETE = withStandardHandler(async (_req, session, json) => {
    const validation = discardUploadsSchema.safeParse(json)
    if (!validation.success) return ApiResponse.badRequest("Validation Error", validation.error.format())
    return ApiResponse.success(await RecordService.discardUploads(session, validation.data.urls))
}, { permission: "records.contribute" })

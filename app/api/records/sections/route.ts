import { withStandardHandler } from "@/lib/api-utils"
import { ApiResponse } from "@/lib/api-response"
import { can } from "@/lib/permissions/can"
import { assertStepUp } from "@/lib/step-up"
import { createSectionSchema, renameSectionSchema } from "@/lib/validations/record.schema"
import { RecordService } from "@/lib/services/record.service"

/** A client's sections of records (CLIENTS_PLAN.md §0.2). Each check is RecordService's. */
export const GET = withStandardHandler(async (req, session) => {
    const vendorId = new URL(req.url).searchParams.get("vendorId")
    if (!vendorId) return ApiResponse.badRequest("Say whose sections to list.")
    return ApiResponse.success(await RecordService.sectionsOf(session, vendorId))
}, { permission: "records.view" })

export const POST = withStandardHandler(async (_req, session, json) => {
    const validation = createSectionSchema.safeParse(json)
    if (!validation.success) return ApiResponse.badRequest("Validation Error", validation.error.format())
    return ApiResponse.success(await RecordService.createSection(session, validation.data), 201)
}, { permission: "records.contribute" })

export const PUT = withStandardHandler(async (_req, session, json) => {
    const validation = renameSectionSchema.safeParse(json)
    if (!validation.success) return ApiResponse.badRequest("Validation Error", validation.error.format())
    return ApiResponse.success(await RecordService.renameSection(session, validation.data))
}, { permission: "records.edit" })

export const DELETE = withStandardHandler(async (req, session) => {
    const id = new URL(req.url).searchParams.get("id")
    if (!id) return ApiResponse.badRequest("Say which section to delete.")
    if (!can(session.user, "records.delete")) return ApiResponse.forbidden()
    // A high-risk action: confirmed with a code within the hour (ROLES_PLAN.md §6.15).
    await assertStepUp(session, "records.delete")
    return ApiResponse.success(await RecordService.deleteSection(session, id))
})

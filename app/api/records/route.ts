import { withStandardHandler } from "@/lib/api-utils"
import { ApiResponse } from "@/lib/api-response"
import { can } from "@/lib/permissions/can"
import { assertStepUp } from "@/lib/step-up"
import { parsePaging } from "@/lib/pagination"
import { createRecordSchema, updateRecordSchema } from "@/lib/validations/record.schema"
import { RecordService } from "@/lib/services/record.service"

/**
 * A client's records (CLIENTS_PLAN.md §0.2): the Records page across every
 * client, and the records on one client's page (?clientId=). Each check is
 * RecordService's, against the record's company; the permission here only
 * turns away someone who holds none at all.
 */
export const GET = withStandardHandler(async (req, session) => {
    const { searchParams } = new URL(req.url)
    // One record, for the link in its reminder.
    const id = searchParams.get("id")
    if (id) return ApiResponse.success(await RecordService.get(session, id))

    const { page, limit } = parsePaging(searchParams, 20, 100)
    const expiry = searchParams.get("expiry") || null
    if (expiry !== null && expiry !== "soon" && expiry !== "expired") return ApiResponse.badRequest("Filter by expiry with soon or expired.")

    const result = await RecordService.list(session, {
        companyId: searchParams.get("companyId"),
        clientId: searchParams.get("clientId"),
        sectionId: searchParams.get("sectionId"),
        search: searchParams.get("search"),
        expiry,
        page,
        limit,
    })
    return ApiResponse.success({ data: result.data, total: result.total, page, totalPages: Math.ceil(result.total / limit), today: result.today, dayEndsAt: result.dayEndsAt })
}, { permission: "records.view" })

export const POST = withStandardHandler(async (_req, session, json) => {
    const validation = createRecordSchema.safeParse(json)
    if (!validation.success) return ApiResponse.badRequest("Validation Error", validation.error.format())
    return ApiResponse.success(await RecordService.create(session, validation.data), 201)
}, { permission: "records.contribute" })

export const PUT = withStandardHandler(async (_req, session, json) => {
    const validation = updateRecordSchema.safeParse(json)
    if (!validation.success) return ApiResponse.badRequest("Validation Error", validation.error.format())
    return ApiResponse.success(await RecordService.update(session, validation.data))
}, { permission: "records.contribute" })

export const DELETE = withStandardHandler(async (req, session) => {
    const id = new URL(req.url).searchParams.get("id")
    if (!id) return ApiResponse.badRequest("Say which record to delete.")
    if (!can(session.user, "records.delete")) return ApiResponse.forbidden()
    // A high-risk action: confirmed with a code within the hour (ROLES_PLAN.md §6.15).
    await assertStepUp(session, "records.delete")
    return ApiResponse.success(await RecordService.delete(session, id))
})

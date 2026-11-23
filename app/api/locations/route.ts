import { withStandardHandler } from "@/lib/api-utils"
import { ApiResponse } from "@/lib/api-response"
import { parsePaging } from "@/lib/pagination"
import { createLocationSchema, updateLocationSchema } from "@/lib/validations/location.schema"
import { LocationService } from "@/lib/services/location.service"
import { can } from "@/lib/permissions/can"

/**
 * The places tasks happen at (CLIENTS_PLAN.md §2): the Locations page, and
 * one client's on its page (?clientId=), or the shared ones
 * (?clientId=shared); what a task's picker offers (?pick=1); and what the
 * Tasks and Costs pages' location filter offers (?pick=filters). Each check
 * is LocationService's, against the location's company; the permission here
 * only turns away someone who holds none at all.
 */
export const GET = withStandardHandler(async (req, session) => {
    const { searchParams } = new URL(req.url)
    const id = searchParams.get("id")
    if (id) return ApiResponse.success(await LocationService.get(session, id))
    // What a task's location picker offers (CLIENTS_PLAN.md §2.3).
    // And every one in use, with its client, for the bulk upload's review (§2.7).
    if (searchParams.get("pick") === "all") {
        return ApiResponse.success(await LocationService.pickableAll(session, { companyId: searchParams.get("companyId") }))
    }
    // Every one, archived ones too, for the Tasks and Costs pages' location filter (§3).
    if (searchParams.get("pick") === "filters") {
        return ApiResponse.success(await LocationService.forFilters(session, { companyId: searchParams.get("companyId") }))
    }
    if (searchParams.get("pick") === "1") {
        return ApiResponse.success(await LocationService.pickable(session, { companyId: searchParams.get("companyId"), clientId: searchParams.get("clientId") }))
    }

    const { page, limit } = parsePaging(searchParams, 20, 100)
    const result = await LocationService.list(session, {
        companyId: searchParams.get("companyId"),
        clientId: searchParams.get("clientId"),
        search: searchParams.get("search"),
        archived: searchParams.get("archived") === "1",
        page,
        limit,
    })
    return ApiResponse.success({ data: result.data, total: result.total, page, totalPages: Math.ceil(result.total / limit) })
}, { permission: "locations.view" })

export const POST = withStandardHandler(async (_req, session, json) => {
    const validation = createLocationSchema.safeParse(json)
    if (!validation.success) return ApiResponse.badRequest("Validation Error", validation.error.format())
    return ApiResponse.success(await LocationService.create(session, validation.data), 201)
}, { permission: "locations.create" })

/**
 * Changing a location: its details and which is its client's HQ are
 * locations.edit's, archiving and restoring it locations.archive's
 * (LATER_CHANGES_PLAN.md §2, PR 377). Whoever holds neither is refused before
 * the change is read; LocationService asks each part of it its own.
 */
export const PUT = withStandardHandler(async (_req, session, json) => {
    if (!can(session.user, "locations.edit") && !can(session.user, "locations.archive")) return ApiResponse.forbidden()
    const validation = updateLocationSchema.safeParse(json)
    if (!validation.success) return ApiResponse.badRequest("Validation Error", validation.error.format())
    return ApiResponse.success(await LocationService.update(session, validation.data))
})

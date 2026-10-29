import { withStandardHandler } from "@/lib/api-utils"
import { ApiResponse } from "@/lib/api-response"
import { parsePaging } from "@/lib/pagination"
import { createLocationSchema, updateLocationSchema } from "@/lib/validations/location.schema"
import { LocationService } from "@/lib/services/location.service"

/**
 * The places tasks happen at (CLIENTS_PLAN.md §2): the Locations page, and
 * one client's on its page (?clientId=), or the shared ones
 * (?clientId=shared); and what a task's picker offers (?pick=1). Each check
 * is LocationService's, against the location's company; the permission here
 * only turns away someone who holds none at all.
 */
export const GET = withStandardHandler(async (req, session) => {
    const { searchParams } = new URL(req.url)
    const id = searchParams.get("id")
    if (id) return ApiResponse.success(await LocationService.get(session, id))
    // What a task's location picker offers (CLIENTS_PLAN.md §2.3).
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
}, { permission: "locations.add" })

export const PUT = withStandardHandler(async (_req, session, json) => {
    const validation = updateLocationSchema.safeParse(json)
    if (!validation.success) return ApiResponse.badRequest("Validation Error", validation.error.format())
    return ApiResponse.success(await LocationService.update(session, validation.data))
}, { permission: "locations.manage" })

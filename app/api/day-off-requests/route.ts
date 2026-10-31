import { withStandardHandler } from "@/lib/api-utils"
import { ApiResponse } from "@/lib/api-response"
import { createDayOffSchema } from "@/lib/validations/day-off.schema"
import { DayOffService } from "@/lib/services/day-off.service"
import { parsePaging } from "@/lib/pagination"
import { dayOffListFilters } from "@/lib/services/day-off-query"
import { can } from "@/lib/permissions/can"

export const GET = withStandardHandler(async (req, session) => {
    const { searchParams } = new URL(req.url)
    const { page, limit, skip } = parsePaging(searchParams, 10)

    try {
        const { requests, total } = await DayOffService.getMany(session.user.id, skip, limit, dayOffListFilters(searchParams))
        return ApiResponse.success({
            data: requests,
            total,
            page,
            totalPages: Math.ceil(total / limit)
        })
    } catch (error: any) {
        throw error
    }
})

export const POST = withStandardHandler(async (req, session, json) => {
    // Asking for leave is a role's to give (UI_PLAN.md §2.3, part 2b): the
    // built-in Employee and Team Leader hold it, and whoever a company gives it.
    if (!can(session.user, "dayoff.request")) return ApiResponse.forbidden("Your role doesn't ask for leave")

    // 1. Validation
    const validation = createDayOffSchema.safeParse(json)
    if (!validation.success) {
        return ApiResponse.badRequest("Validation Error", validation.error.format())
    }

    try {
        // 2. Service
        const result = await DayOffService.create(validation.data, session)
        return ApiResponse.success(result, 201)
    } catch (error: any) {
        if (error.message === 'END_DATE_BEFORE_START') {
            return ApiResponse.badRequest("End date cannot be before start date")
        }
        throw error
    }
}, {
    audit: {
        action: 'CREATE_DAY_OFF',
        entityType: 'DAY_OFF_REQUEST',
        getEntityId: (res) => res.id
    }
})

import { withStandardHandler } from "@/lib/api-utils"
import { ApiResponse } from "@/lib/api-response"
import { PublicHolidayService } from "@/lib/services/public-holiday.service"
import { publicHolidaySchema } from "@/lib/validations/attendance-calendar.schema"
import { calendarYear } from "@/lib/time"

/**
 * The central calendar of public holidays (ATTENDANCE_PLAN.md §7.2). The Super
 * Admin's: companies read it through their own attendance calendar.
 */
export const GET = withStandardHandler(async (req, session) => {
    if (session.user.role !== "SUPER_ADMIN") return ApiResponse.forbidden()
    const asked = Number(new URL(req.url).searchParams.get("year"))
    const year = Number.isInteger(asked) && asked >= 2000 && asked <= 2100 ? asked : calendarYear(new Date())
    return ApiResponse.success({ year, holidays: await PublicHolidayService.list(year) })
})

export const POST = withStandardHandler(async (_req, session, json) => {
    if (session.user.role !== "SUPER_ADMIN") return ApiResponse.forbidden()
    const validation = publicHolidaySchema.safeParse(json)
    if (!validation.success) return ApiResponse.badRequest("Validation Error", validation.error.format())
    return ApiResponse.success(await PublicHolidayService.create(validation.data, session.user.id), 201)
})

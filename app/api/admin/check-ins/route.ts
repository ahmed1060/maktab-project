import { withStandardHandler } from "@/lib/api-utils"
import { ApiResponse } from "@/lib/api-response"
import { AttendanceFlagService } from "@/lib/services/attendance-flag.service"

/**
 * The Super Admin's check-in review (ATTENDANCE_PLAN.md §9.6, §13.7): the
 * check-ins waiting for them — those our app couldn't prove, while
 * attestation is in testing — and, across every company, what was refused
 * and flagged over the last 30 days.
 */
export const GET = withStandardHandler(async (_req, session) => {
    if (session.user.role !== "SUPER_ADMIN") return ApiResponse.forbidden()
    const [queue, integrity] = await Promise.all([AttendanceFlagService.list("PLATFORM", "ALL"), AttendanceFlagService.integrity()])
    return ApiResponse.success({ queue, integrity, days: 30 })
})

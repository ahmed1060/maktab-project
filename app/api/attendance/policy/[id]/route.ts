import { withStandardHandler } from "@/lib/api-utils"
import { ApiResponse } from "@/lib/api-response"
import { AttendancePolicyService } from "@/lib/services/attendance-policy.service"
import { denyAttendanceSettings } from "@/lib/attendance/settings-access"

/** Withdraw a policy version, while payroll has not locked its month. */
export const DELETE = withStandardHandler(async (_req, session, _json, context) => {
    const version = await AttendancePolicyService.versionOf(context.params.id)
    if (!version) return ApiResponse.notFound("Policy version not found")
    const denied = await denyAttendanceSettings(session, version.companyId, "edit")
    if (denied) return denied
    await AttendancePolicyService.deleteVersion(version.id, session.user.id)
    return ApiResponse.success({ deleted: true })
})

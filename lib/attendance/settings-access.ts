import { ApiResponse } from "@/lib/api-response"
import { CompanyService } from "@/lib/services/company.service"
import { maySettings } from "@/lib/company-settings-access"

/**
 * The attendance calendar is the company's Attendance settings tab
 * (ATTENDANCE_PLAN.md §5, §7), so every route under it asks the tab's
 * question: the company holds attendance, and this person may see — or save —
 * that tab of its settings (lib/company-settings-access.ts).
 */

/** Which company: the one asked for, for the Super Admin; one's own for anyone else. */
export function attendanceCompanyFor(session: any, asked: unknown): string | null {
    if (session.user.role === "SUPER_ADMIN") return typeof asked === "string" && asked ? asked : null
    return session.user.companyId ?? null
}

/**
 * Null when this person may do this to this company's calendar; otherwise the
 * response to send. A company the person cannot see answers 404, as if absent.
 */
export async function denyAttendanceSettings(session: any, companyId: string | null, need: "view" | "edit") {
    if (!companyId) return ApiResponse.badRequest("companyId is required")
    const exposure = await CompanyService.settingsExposure(companyId)
    if (!exposure) return ApiResponse.notFound("Company not found")
    if (!maySettings(session.user, exposure, "attendance", "view")) return ApiResponse.notFound()
    if (need === "edit" && !maySettings(session.user, exposure, "attendance", "edit")) return ApiResponse.forbidden()
    return null
}

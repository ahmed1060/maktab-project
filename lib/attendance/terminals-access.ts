import { ApiResponse } from "@/lib/api-response"
import { CompanyService } from "@/lib/services/company.service"
import { hasBundle, resolveBundles } from "@/lib/features/bundles"
import { denyAttendanceSettings } from "./settings-access"

/**
 * Terminals and agents are part of the Attendance settings tab, shown only to
 * a company holding the Terminals add-on (ATTENDANCE_PLAN.md §16): the tab's
 * own question, then the add-on. Null when allowed; otherwise the response.
 */
export async function denyTerminals(session: any, companyId: string | null, need: "view" | "edit") {
    const denied = await denyAttendanceSettings(session, companyId, need)
    if (denied) return denied
    const company = await CompanyService.settingsExposure(companyId!)
    if (!hasBundle(resolveBundles(company!.package), "ATTENDANCE_TERMINALS")) {
        return ApiResponse.forbidden("Attendance terminals aren't included in this company's package.")
    }
    return null
}

import type { NextResponse } from "next/server"
import { ApiResponse } from "@/lib/api-response"
import { AttendanceLocationService } from "@/lib/services/attendance-location.service"
import { CompanyService } from "@/lib/services/company.service"
import { hasBundle, resolveBundles } from "@/lib/features/bundles"
import { denyAttendanceSettings } from "./settings-access"

/**
 * Work locations and check-in phones are part of the Attendance settings
 * tab, shown only to a company holding the Mobile App add-on
 * (ATTENDANCE_PLAN.md §16): the tab's own question, then the add-on. Null
 * when allowed; otherwise the response.
 */
export async function denyMobile(session: any, companyId: string | null, need: "view" | "edit") {
    const denied = await denyAttendanceSettings(session, companyId, need)
    if (denied) return denied
    const company = await CompanyService.settingsExposure(companyId!)
    if (!hasBundle(resolveBundles(company!.package), "ATTENDANCE_MOBILE")) {
        return ApiResponse.forbidden("The attendance mobile app isn't included in this company's package.")
    }
    return null
}

/** A work location, and whether this person may change it: a place they can't see answers 404. */
export async function locationFor(session: any, id: string): Promise<{ denied: NextResponse } | { location: { id: string; companyId: string } }> {
    const location = await AttendanceLocationService.locationOf(id)
    if (!location) return { denied: ApiResponse.notFound("Place not found") }
    const denied = await denyMobile(session, location.companyId, "edit")
    return denied ? { denied } : { location }
}

import type { NextResponse } from "next/server"
import { ApiResponse } from "@/lib/api-response"
import { AttendancePhoneService } from "@/lib/services/attendance-phone.service"
import { punchCompany, decidesPerson } from "./punch-access"

/**
 * A phone, and whether this person may decide or revoke it: someone with
 * attendance.approve_devices over its owner, never its owner (§9.3). One
 * they can't see answers 404.
 */
export async function phoneToDecide(session: any, id: string): Promise<{ denied: NextResponse } | { phone: { id: string } }> {
    const phone = await AttendancePhoneService.phoneOf(id)
    if (!phone) return { denied: ApiResponse.notFound("Phone not found") }
    const access = await punchCompany(session, phone.companyId)
    if ("denied" in access || access.companyId !== phone.companyId) return { denied: ApiResponse.notFound("Phone not found") }
    if (!decidesPerson(session, "attendance.approve_devices", { companyId: phone.companyId, userId: phone.userId, teamLeaderId: phone.user.teamLeaderId })) {
        return { denied: ApiResponse.forbidden() }
    }
    return { phone }
}

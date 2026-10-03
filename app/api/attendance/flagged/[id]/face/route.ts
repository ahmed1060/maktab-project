import { NextResponse } from "next/server"
import { withStandardHandler } from "@/lib/api-utils"
import { ApiResponse } from "@/lib/api-response"
import { can } from "@/lib/permissions/can"
import { AttendanceFlagService } from "@/lib/services/attendance-flag.service"
import { FaceReviewService } from "@/lib/services/face-review.service"
import { punchCompany } from "@/lib/attendance/punch-access"
import { reviewer } from "@/lib/attendance/face-access"

/**
 * A flagged check-in's failed face frame, or the person's reference photo
 * beside it (ATTENDANCE_PLAN.md §13.8). Seen by the same people as the
 * verification photo: attendance.approve_face in the company, or the Super
 * Admin. Only while the flag is open, not cached, every view audited.
 */
export const GET = withStandardHandler(async (req, session, _json, { params }) => {
    const { id } = await params
    const punch = await AttendanceFlagService.flaggedOf(id)
    if (!punch || !punch.userId) return ApiResponse.notFound("Check-in not found.")
    if (session.user.role !== "SUPER_ADMIN") {
        const access = await punchCompany(session, punch.companyId)
        if ("denied" in access || access.companyId !== punch.companyId) return ApiResponse.notFound("Check-in not found.")
        if (!can(session.user, "attendance.approve_face", { companyId: punch.companyId, userId: punch.userId, teamLeaderId: punch.user?.teamLeaderId ?? null })) return ApiResponse.forbidden()
    }
    const which = new URL(req.url).searchParams.get("which") === "reference" ? "reference" : "frame"
    const photo = await FaceReviewService.flaggedPhoto(id, which, reviewer(session))
    return new NextResponse(new Uint8Array(photo), {
        status: 200,
        headers: { "Content-Type": "image/jpeg", "Cache-Control": "no-store, private, max-age=0", "Content-Disposition": "inline", "X-Content-Type-Options": "nosniff" },
    })
})

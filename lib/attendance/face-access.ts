import type { NextResponse } from "next/server"
import { ApiResponse } from "@/lib/api-response"
import { can, canCompanyWide } from "@/lib/permissions/can"
import { FaceReviewService } from "@/lib/services/face-review.service"
import { punchCompany } from "./punch-access"

/**
 * Who decides face verification (ATTENDANCE_PLAN.md §9.5): attendance.approve_face
 * in the person's company, or the Super Admin. Never one's own. One they
 * can't see answers 404.
 */
export async function reviewToDecide(session: any, id: string): Promise<{ denied: NextResponse } | { review: { id: string; companyId: string; userId: string } }> {
    const review = await FaceReviewService.reviewOf(id)
    if (!review) return { denied: ApiResponse.notFound("Review not found") }
    const access = await punchCompany(session, review.companyId)
    if ("denied" in access || access.companyId !== review.companyId) return { denied: ApiResponse.notFound("Review not found") }
    if (!can(session.user, "attendance.approve_face", { companyId: review.companyId, userId: review.userId, teamLeaderId: review.user.teamLeaderId })) return { denied: ApiResponse.forbidden() }
    return { review }
}

/** A company whose face reviews this person decides, or the response to send. */
export async function faceCompany(session: any, asked: unknown): Promise<{ denied: NextResponse } | { companyId: string }> {
    const access = await punchCompany(session, asked)
    if ("denied" in access) return access
    if (!canCompanyWide(session.user, "attendance.approve_face") || !can(session.user, "attendance.approve_face", { companyId: access.companyId })) return { denied: ApiResponse.forbidden() }
    return access
}

export const reviewer = (session: any) => ({ id: session.user.id as string, isSuperAdmin: session.user.role === "SUPER_ADMIN" })

import { z } from "zod"
import { withStandardHandler } from "@/lib/api-utils"
import { ApiResponse } from "@/lib/api-response"
import { prisma } from "@/lib/prisma"
import { FaceVerificationService } from "@/lib/services/face-verification.service"
import { attendanceCompanyFor, denyAttendanceSettings } from "@/lib/attendance/settings-access"

/**
 * The company's confirmation that it holds whatever licence biometric
 * processing needs (ATTENDANCE_PLAN.md §10.4), on its Attendance settings tab.
 * Without it the policy can't offer face verification.
 */
export const GET = withStandardHandler(async (req, session) => {
    const companyId = attendanceCompanyFor(session, new URL(req.url).searchParams.get("companyId"))
    const denied = await denyAttendanceSettings(session, companyId, "view")
    if (denied) return denied
    const [company, system, mobileApp] = await Promise.all([
        prisma.company.findUnique({ where: { id: companyId! }, select: { faceLegalConfirmedAt: true } }),
        FaceVerificationService.systemState(),
        FaceVerificationService.hasMobileApp(companyId!),
    ])
    return ApiResponse.success({ system, mobileApp, legalConfirmedAt: company?.faceLegalConfirmedAt ?? null })
})

const schema = z.object({ companyId: z.string().optional(), confirmed: z.boolean() })

export const PUT = withStandardHandler(async (_req, session, json) => {
    const validation = schema.safeParse(json)
    if (!validation.success) return ApiResponse.badRequest("Validation Error", validation.error.format())
    const companyId = attendanceCompanyFor(session, validation.data.companyId)
    const denied = await denyAttendanceSettings(session, companyId, "edit")
    if (denied) return denied
    await FaceVerificationService.setLegalConfirmed(companyId!, validation.data.confirmed, session.user.id, session.user.role === "SUPER_ADMIN")
    return ApiResponse.success({ confirmed: validation.data.confirmed })
})

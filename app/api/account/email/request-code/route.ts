import { withStandardHandler } from "@/lib/api-utils"
import { ApiResponse } from "@/lib/api-response"
import { prisma } from "@/lib/prisma"
import { requestEmailCodeSchema } from "@/lib/validations/email-verification.schema"
import { VerificationCodeService } from "@/lib/services/verification-code.service"

// F-27: the merged email-verify/change flow (see the remediation log for
// why these share one screen). Sends a code to the submitted email —
// EMAIL_VERIFY if it matches the account's current email (confirming an
// address that's never been verified), EMAIL_CHANGE otherwise. A
// protected SuperAdmin can only ever request VERIFY for their own current
// email; requesting a change is a 403 here, independent of the matching
// guard in SuperAdminService.update, since that's a different endpoint.
export const POST = withStandardHandler(async (req, session, json) => {
    const validation = requestEmailCodeSchema.safeParse(json)
    if (!validation.success) {
        return ApiResponse.badRequest("Validation Error", validation.error.format())
    }

    const { email } = validation.data
    const isSuperAdmin = session.user.role === 'SUPER_ADMIN'
    const actorId = session.user.id

    const actor = isSuperAdmin
        ? await prisma.superAdmin.findUnique({ where: { id: actorId } })
        : await prisma.user.findUnique({ where: { id: actorId } })

    if (!actor) return ApiResponse.notFound("Account not found")

    const isChange = email.toLowerCase() !== actor.email.toLowerCase()

    if (isChange && isSuperAdmin && (actor as any).isProtected) {
        return ApiResponse.forbidden("This account's email is protected and cannot be changed")
    }

    // Early, friendly uniqueness check — the DB unique constraint at
    // confirm time is the real backstop, this just avoids sending a code
    // to an address that could never actually be applied.
    if (isChange) {
        const [existingUser, existingSuperAdmin] = await Promise.all([
            prisma.user.findUnique({ where: { email } }),
            prisma.superAdmin.findUnique({ where: { email } }),
        ])
        if ((existingUser && existingUser.id !== actorId) || (existingSuperAdmin && existingSuperAdmin.id !== actorId)) {
            return ApiResponse.badRequest("Email already in use")
        }
    }

    try {
        await VerificationCodeService.issue(
            email,
            isChange ? 'EMAIL_CHANGE' : 'EMAIL_VERIFY',
            isSuperAdmin ? { superAdminId: actorId } : { userId: actorId }
        )
    } catch (error: any) {
        if (error.message === 'RATE_LIMITED') return ApiResponse.error("Too many code requests — try again later", 429)
        if (error.message === 'EMAIL_NOT_CONFIGURED') return ApiResponse.error("Email sending is not configured", 500)
        throw error
    }

    return ApiResponse.success({ sent: true })
})

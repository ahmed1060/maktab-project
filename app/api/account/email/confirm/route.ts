import { withStandardHandler } from "@/lib/api-utils"
import { ApiResponse } from "@/lib/api-response"
import { prisma } from "@/lib/prisma"
import { confirmEmailCodeSchema } from "@/lib/validations/email-verification.schema"
import { VerificationCodeService } from "@/lib/services/verification-code.service"

export const POST = withStandardHandler(async (req, session, json) => {
    const validation = confirmEmailCodeSchema.safeParse(json)
    if (!validation.success) {
        return ApiResponse.badRequest("Validation Error", validation.error.format())
    }

    const { email, code } = validation.data
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

    const ok = await VerificationCodeService.verify(email, isChange ? 'EMAIL_CHANGE' : 'EMAIL_VERIFY', code)
    if (!ok) return ApiResponse.badRequest("Invalid or expired code")

    const data: any = { emailVerifiedAt: new Date() }
    if (isChange) data.email = email

    try {
        if (isSuperAdmin) {
            await prisma.superAdmin.update({ where: { id: actorId }, data })
        } else {
            await prisma.user.update({ where: { id: actorId }, data })
        }
    } catch (e: any) {
        // Re-checked here (not just at request-code time) to close the race
        // where someone else claims the same email in between.
        if (e.code === 'P2002') return ApiResponse.badRequest("Email already in use")
        throw e
    }

    const { AuditLogService } = await import("@/lib/services/audit-log.service")
    await AuditLogService.log(isChange ? 'CHANGE_EMAIL' : 'VERIFY_EMAIL', isSuperAdmin ? 'SUPER_ADMIN' : 'USER', actorId, {
        userId: !isSuperAdmin ? actorId : null,
        superAdminId: isSuperAdmin ? actorId : null,
        details: isChange ? { email: { old: actor.email, new: email } } : { email }
    })

    return ApiResponse.success({ email: isChange ? email : actor.email, emailVerified: true })
})

import { NextRequest } from "next/server"
import bcrypt from "bcryptjs"
import { prisma } from "@/lib/prisma"
import { ApiResponse } from "@/lib/api-response"
import { RateLimiter, getClientIp } from "@/lib/api-utils"
import { forgotPasswordConfirmSchema } from "@/lib/validations/forgot-password.schema"
import { VerificationCodeService } from "@/lib/services/verification-code.service"
import { AuditLogService } from "@/lib/services/audit-log.service"

// F-27, Phase 3.5. Applies to any account, including the protected
// SuperAdmin — resetting a forgotten password doesn't touch the
// delete/edit protections that account gets elsewhere; those are about
// the account's identity and existence, not proving you know its current
// password. Bonus side effect: receiving the code already proves control
// of the inbox, so this also satisfies a pending mustChangePassword and
// marks the email verified if it wasn't already — no reason to make
// someone go through a second, separate verification right after this.
export async function POST(req: NextRequest) {
    try {
        const json = await req.json().catch(() => null)
        const validation = forgotPasswordConfirmSchema.safeParse(json)
        if (!validation.success) {
            return ApiResponse.badRequest("Validation Error", validation.error.format())
        }

        const { email, code, newPassword } = validation.data
        const ip = getClientIp(req.headers)

        const { limited, resetAt } = await RateLimiter.getLimitData(`password-reset:${ip}`, 5, 15 * 60 * 1000)
        if (limited) {
            const timeStr = new Date(resetAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
            return ApiResponse.error(`Too many attempts. Please try again at ${timeStr}.`, 429)
        }

        const ok = await VerificationCodeService.verify(email, 'PASSWORD_RESET', code)
        if (!ok) return ApiResponse.badRequest("Invalid or expired code")

        const superAdmin = await prisma.superAdmin.findUnique({ where: { email } })
        const user = superAdmin ? null : await prisma.user.findUnique({ where: { email } })
        const account = superAdmin || user
        // Not reachable in practice: verify() above can only return true for
        // an email that actually had a code issued, which request/route.ts
        // only ever does for an email that matched an account. Kept as a
        // defensive check, not a real branch.
        if (!account) return ApiResponse.notFound("Account not found")

        // F-16/F-02: SuperAdmin and User hash at different bcrypt cost
        // factors elsewhere in this app (12 vs 10) — matched here rather than
        // picking one arbitrarily.
        const hashed = await bcrypt.hash(newPassword, superAdmin ? 12 : 10)
        const emailVerifiedAt = (account as any).emailVerifiedAt ?? new Date()

        if (superAdmin) {
            await prisma.superAdmin.update({
                where: { id: account.id },
                data: { password: hashed, mustChangePassword: false, emailVerifiedAt },
            })
        } else {
            await prisma.user.update({
                where: { id: account.id },
                data: { password: hashed, mustChangePassword: false, emailVerifiedAt },
            })
        }

        await AuditLogService.log('PASSWORD_RESET', superAdmin ? 'SUPER_ADMIN' : 'USER', account.id, {
            userId: user ? account.id : null,
            superAdminId: superAdmin ? account.id : null,
            details: { email },
        })

        return ApiResponse.success({ reset: true })
    } catch (error: any) {
        // Unauthenticated route — same reasoning as request/route.ts.
        console.error('Forgot-password confirm error:', error)
        const ref = await AuditLogService.logSystemError({ error, route: '/api/auth/forgot-password/confirm', method: 'POST' })
        return ApiResponse.error(AuditLogService.friendlyErrorMessage(ref))
    }
}

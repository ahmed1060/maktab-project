import { NextRequest } from "next/server"
import { z } from "zod"
import bcrypt from "bcryptjs"
import { prisma } from "@/lib/prisma"
import { ApiResponse } from "@/lib/api-response"
import { RateLimiter, getClientIp } from "@/lib/api-utils"
import { DUMMY_PASSWORD_HASH } from "@/lib/auth"
import { VerificationCodeService } from "@/lib/services/verification-code.service"
import { AuditLogService } from "@/lib/services/audit-log.service"
import { isNextInternalError } from "@/lib/next-internal-error"

// F-27, Phase 5: "email me a code instead", the MFA fallback for someone
// who can't reach their authenticator app. Unauthenticated by necessity —
// there's no session yet, this *is* part of completing login — so it
// can't go through withStandardHandler (which requires one). Re-checks
// the password itself for the same reason F-17 does in authorize(): proof
// of the password is what makes this safe to expose without a session,
// same constant-time-ish comparison against DUMMY_PASSWORD_HASH for an
// unknown email.
const schema = z.object({
    email: z.string().email().max(254),
    password: z.string().min(1),
})

export async function POST(req: NextRequest) {
    try {
        const json = await req.json().catch(() => null)
        const validation = schema.safeParse(json)
        if (!validation.success) {
            return ApiResponse.badRequest("Validation Error")
        }

        const { email, password } = validation.data

        // Shares the same login:${ip} bucket as authorize() itself — this is
        // a second password-checking surface, and without this it would be an
        // unthrottled one alongside the real login rate limit.
        const ip = getClientIp(req.headers)
        const { limited, resetAt } = await RateLimiter.getLimitData(`login:${ip}`, 5, 15 * 60 * 1000)
        if (limited) {
            const timeStr = new Date(resetAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
            return ApiResponse.error(`Too many attempts. Please try again at ${timeStr}.`, 429)
        }

        const superAdmin = await prisma.superAdmin.findUnique({ where: { email } })
        const user = superAdmin ? null : await prisma.user.findUnique({ where: { email } })
        const account = superAdmin || user

        const passwordHash = superAdmin?.password || user?.password || DUMMY_PASSWORD_HASH
        const isValid = await bcrypt.compare(password, passwordHash)

        if (!isValid || !account) {
            return ApiResponse.forbidden("Invalid credentials")
        }

        if (!(account as any).mfaEnabled || !(account as any).emailVerifiedAt) {
            // Reachable in practice only if MFA got enabled before email
            // verification existed — Phase 2+3 forces verification before any
            // dashboard access, including reaching MFA settings to enroll, so
            // every real account hits this already verified.
            return ApiResponse.forbidden("MFA recovery is not available for this account")
        }

        try {
            await VerificationCodeService.issue(
                account.email,
                'MFA_RECOVERY',
                superAdmin ? { superAdminId: account.id } : { userId: account.id }
            )
        } catch (error: any) {
            if (error.message === 'RATE_LIMITED') return ApiResponse.error("Too many code requests — try again later", 429)
            throw error
        }

        return ApiResponse.success({ sent: true })
    } catch (error: any) {
        // Unauthenticated route — same reasoning as forgot-password's.
        if (isNextInternalError(error)) throw error
        console.error('MFA recovery request error:', error)
        const ref = await AuditLogService.logSystemError({ error, route: '/api/auth/mfa-recovery/request', method: 'POST' })
        return ApiResponse.error(AuditLogService.friendlyErrorMessage(ref))
    }
}

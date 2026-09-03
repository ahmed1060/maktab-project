import { NextRequest } from "next/server"
import { prisma } from "@/lib/prisma"
import { ApiResponse } from "@/lib/api-response"
import { RateLimiter, getClientIp } from "@/lib/api-utils"
import { forgotPasswordRequestSchema } from "@/lib/validations/forgot-password.schema"
import { VerificationCodeService } from "@/lib/services/verification-code.service"
import { AuditLogService } from "@/lib/services/audit-log.service"

// F-27, Phase 3.5: unauthenticated by necessity — this is how someone
// gets back in when they don't have a password to prove. Unlike
// mfa-recovery/request, no credential is required at all here, so this
// gets its own rate-limit bucket rather than sharing login:${ip} — an
// anonymous caller spamming this against arbitrary emails from a shared
// IP (an office NAT, say) would otherwise exhaust real users' login
// budget on that IP for free.
export async function POST(req: NextRequest) {
    try {
        const json = await req.json().catch(() => null)
        const validation = forgotPasswordRequestSchema.safeParse(json)
        if (!validation.success) {
            return ApiResponse.badRequest("Validation Error", validation.error.format())
        }

        const { email } = validation.data
        const ip = getClientIp(req.headers)

        const { limited, resetAt } = await RateLimiter.getLimitData(`password-reset:${ip}`, 5, 15 * 60 * 1000)
        if (limited) {
            const timeStr = new Date(resetAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
            return ApiResponse.error(`Too many attempts. Please try again at ${timeStr}.`, 429)
        }

        const superAdmin = await prisma.superAdmin.findUnique({ where: { email } })
        const user = superAdmin ? null : await prisma.user.findUnique({ where: { email } })
        const account = superAdmin || user

        // F-27: the response is identical whether or not this email matched
        // anything — same anti-enumeration reasoning as F-17/F-18 already
        // applied to login itself. A different response here (or surfacing a
        // rate-limit specifically on the code-issuing step below) would let
        // this endpoint be used to find out which emails have real accounts.
        if (account) {
            try {
                await VerificationCodeService.issue(
                    account.email,
                    'PASSWORD_RESET',
                    superAdmin ? { superAdminId: account.id } : { userId: account.id }
                )
            } catch (error: any) {
                if (error.message !== 'RATE_LIMITED') throw error
                // Swallowed deliberately — see the comment above.
            }
        }

        return ApiResponse.success({ sent: true })
    } catch (error: any) {
        // This route is unauthenticated by design (see comment above), so
        // an unhandled failure here previously bubbled straight out as a
        // raw Next.js 500 with no logging at all — the worst of both
        // worlds. Log it (userId: null — no session to attribute to) and
        // return the same safe, ref-coded message every other surface does.
        console.error('Forgot-password request error:', error)
        const ref = await AuditLogService.logSystemError({ error, route: '/api/auth/forgot-password/request', method: 'POST' })
        return ApiResponse.error(AuditLogService.friendlyErrorMessage(ref))
    }
}

import { NextRequest } from "next/server"
import { z } from "zod"
import bcrypt from "bcryptjs"
import { prisma } from "@/lib/prisma"
import { ApiResponse } from "@/lib/api-response"
import { countSignIn, giveBackSignIn, holdMessage, lockKeyFor, markWrongSignIn } from "@/lib/sign-in-lock"
import { DUMMY_PASSWORD_HASH } from "@/lib/auth"
import { VerificationCodeService } from "@/lib/services/verification-code.service"
import { AuditLogService } from "@/lib/services/audit-log.service"
import { isNextInternalError } from "@/lib/next-internal-error"
import { signInWhere } from "@/lib/sign-in-account"

// F-27, Phase 5: "email me a code instead", the MFA fallback for someone
// who can't reach their authenticator app. Unauthenticated by necessity —
// there's no session yet, this *is* part of completing login — so it
// can't go through withStandardHandler (which requires one). Re-checks
// the password itself for the same reason F-17 does in authorize(): proof
// of the password is what makes this safe to expose without a session,
// same constant-time-ish comparison against DUMMY_PASSWORD_HASH for an
// unknown email.
// `email` is what was typed to sign in: an email or a username
// (lib/sign-in-account.ts), as authorize() takes it.
const schema = z.object({
    email: z.string().min(1).max(254),
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

        const where = await signInWhere(email)
        const superAdmin = where.superAdmin ? await prisma.superAdmin.findUnique({ where: where.superAdmin }) : null
        const user = superAdmin || !where.user ? null : await prisma.user.findUnique({ where: where.user })
        const account = superAdmin || user

        // Shares the account's count with authorize() itself
        // (lib/sign-in-lock.ts) — this is a second password-checking surface,
        // and without this it would be an unthrottled one beside sign-in. An
        // email nobody has is counted alike, so a lock says nothing of who's
        // registered.
        const key = lockKeyFor(account, email)
        const tried = await countSignIn(key)
        // Said as sign-in says it, so the page counts it down the same way.
        if (tried.kind !== 'counted') return ApiResponse.error(holdMessage(tried), 429)

        const passwordHash = superAdmin?.password || user?.password || DUMMY_PASSWORD_HASH
        const isValid = await bcrypt.compare(password, passwordHash)

        // Each refusal carries its code, so the sign-in page says it in the
        // reader's language (lib/sign-in-form.ts): it came in English.
        if (!isValid || !account) {
            await markWrongSignIn(tried)
            return ApiResponse.refused(403, "Invalid credentials", "WRONG_PASSWORD")
        }
        // The password was right: asking for a code is not a guess, so the
        // attempt is given back, as authorize() gives back the step that asks
        // for one. Otherwise each sign-in by emailed code used one of the
        // account's tries (review on #29).
        await giveBackSignIn(tried)

        if (!(account as any).mfaEnabled || !(account as any).emailVerifiedAt) {
            // Reachable in practice only if MFA got enabled before email
            // verification existed — Phase 2+3 forces verification before any
            // dashboard access, including reaching MFA settings to enroll, so
            // every real account hits this already verified.
            return ApiResponse.refused(403, "MFA recovery is not available for this account", "NO_EMAIL_CODES")
        }

        try {
            await VerificationCodeService.issue(
                account.email,
                'MFA_RECOVERY',
                superAdmin ? { superAdminId: account.id } : { userId: account.id }
            )
        } catch (error: any) {
            if (error.message === 'RATE_LIMITED') return ApiResponse.refused(429, "Too many code requests — try again later", "TOO_MANY_CODES")
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

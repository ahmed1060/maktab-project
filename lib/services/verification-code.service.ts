import { randomInt, createHash } from 'crypto'
import { prisma } from '@/lib/prisma'
import { sendVerificationCodeEmail, VerificationEmailPurpose } from '@/lib/email'
import { RateLimiter } from '@/lib/api-utils'

const CODE_TTL_MINUTES = 10
const MAX_ATTEMPTS = 5
const REQUEST_LIMIT = 3
const REQUEST_WINDOW_MS = 15 * 60 * 1000

// A 6-digit code doesn't need bcrypt's cost factor — the real defenses
// against guessing are MAX_ATTEMPTS and the short expiry below, not hash
// cost. SHA-256 just keeps a DB dump from handing out working codes.
function hashCode(code: string): string {
    return createHash('sha256').update(code).digest('hex')
}

function generateCode(): string {
    return randomInt(0, 1_000_000).toString().padStart(6, '0')
}

type Owner = { userId?: string; superAdminId?: string }

/**
 * The shared engine behind every "prove you control this inbox" moment in
 * the app — email verification, email change, MFA's email-fallback
 * recovery, and forgot-password. One mechanism, four VerificationPurpose
 * values, rather than four ad-hoc flows.
 */
export class VerificationCodeService {
    /**
     * Generates a code, stores its hash, and emails it. Rate-limited by
     * email+purpose rather than by account, so this stays safe to expose
     * to an unauthenticated caller too (forgot-password, added later in
     * this plan) — someone spamming requests at an address they don't
     * control hits the same limit a legitimate repeated request would,
     * and nothing here reveals whether that email even has an account.
     */
    static async issue(email: string, purpose: VerificationEmailPurpose, owner: Owner = {}): Promise<void> {
        const normalizedEmail = email.toLowerCase().trim()

        const { limited } = await RateLimiter.getLimitData(`verify-code:${purpose}:${normalizedEmail}`, REQUEST_LIMIT, REQUEST_WINDOW_MS)
        if (limited) {
            throw new Error('RATE_LIMITED')
        }

        const code = generateCode()
        const expiresAt = new Date(Date.now() + CODE_TTL_MINUTES * 60 * 1000)

        await prisma.verificationCode.create({
            data: {
                email: normalizedEmail,
                purpose,
                codeHash: hashCode(code),
                expiresAt,
                userId: owner.userId,
                superAdminId: owner.superAdminId,
            }
        })

        await sendVerificationCodeEmail(normalizedEmail, code, purpose, CODE_TTL_MINUTES)
    }

    /**
     * Checks a submitted code against the most recent unconsumed,
     * unexpired row for this email+purpose. A wrong guess increments
     * `attempts` (and MAX_ATTEMPTS locks the code out entirely, forcing a
     * fresh one rather than unlimited guessing); a correct one consumes
     * it — either way, that code row can never succeed twice.
     */
    static async verify(email: string, purpose: VerificationEmailPurpose, code: string): Promise<boolean> {
        const normalizedEmail = email.toLowerCase().trim()

        const record = await prisma.verificationCode.findFirst({
            where: {
                email: normalizedEmail,
                purpose,
                consumedAt: null,
                expiresAt: { gt: new Date() },
            },
            orderBy: { createdAt: 'desc' },
        })

        if (!record || record.attempts >= MAX_ATTEMPTS) return false

        const isValid = record.codeHash === hashCode(code.trim())

        if (!isValid) {
            await prisma.verificationCode.update({
                where: { id: record.id },
                data: { attempts: { increment: 1 } },
            })
            return false
        }

        await prisma.verificationCode.update({
            where: { id: record.id },
            data: { consumedAt: new Date() },
        })

        return true
    }
}

import { createHash } from 'node:crypto'
import { RateLimiter } from '@/lib/api-utils'
import { prisma } from '@/lib/prisma'

/**
 * Signing in's limit: five wrong passwords or codes in fifteen minutes lock
 * the account, whatever address they come from (decided 2026-11-03). It was
 * the address's, so one person's mistakes locked everybody behind the same
 * office Wi-Fi, while the person themselves could get in from their phone.
 *
 * An email nobody has is counted the same way, so a lock says nothing of
 * which emails exist (F-17); it's kept as a hash, not as it was typed. A
 * Super Admin, or a company's Admin for their own people, can lift a lock,
 * and resetting the password with Forgot password lifts it too.
 */
export const SIGN_IN_TRIES = 5
export const SIGN_IN_WINDOW_MS = 15 * 60 * 1000

const ACCOUNT = 'login:account:'

/** The count for an account, wherever its sign-ins come from. */
export const accountLockKey = (accountId: string) => `${ACCOUNT}${accountId}`

/** The count for an email nobody has, kept as a hash. */
export const unknownLockKey = (email: string) =>
    `login:unknown:${createHash('sha256').update(email.trim().toLowerCase()).digest('hex')}`

/** Whose count a sign-in uses: the account's when there is one. */
export const lockKeyFor = (account: { id: string } | null, email: string) =>
    account ? accountLockKey(account.id) : unknownLockKey(email)

/** Counts an attempt and says whether it's over the limit; a right password gives it back (RateLimiter.refund). */
export const countSignIn = (key: string) => RateLimiter.getLimitData(key, SIGN_IN_TRIES, SIGN_IN_WINDOW_MS)

/** When each of these accounts can sign in again, for the ones locked now. */
export async function lockedUntil(accountIds: string[], now: Date = new Date()): Promise<Map<string, Date>> {
    if (accountIds.length === 0) return new Map()
    const rows = await prisma.rateLimit.findMany({
        // Five counted is locked: the next try is refused.
        where: { key: { in: accountIds.map(accountLockKey) }, count: { gte: SIGN_IN_TRIES }, resetAt: { gt: now } },
        select: { key: true, resetAt: true },
    })
    return new Map(rows.map(row => [row.key.slice(ACCOUNT.length), row.resetAt]))
}

/** Lifts the lock, and the count of codes asked to confirm a sensitive action (lib/auth.ts, step-up). */
export async function unlockSignIn(accountId: string): Promise<void> {
    await Promise.all([RateLimiter.clear(accountLockKey(accountId)), RateLimiter.clear(`step-up:${accountId}`)])
}

/**
 * Every count whose window has passed: one is as good as none (RateLimiter
 * starts a new window), and every email typed has one. Swept daily (prune).
 */
export async function sweepExpiredCounts(now: Date = new Date()): Promise<number> {
    const { count } = await prisma.rateLimit.deleteMany({ where: { resetAt: { lt: now } } })
    return count
}

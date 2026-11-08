import bcrypt from "bcryptjs"
import { prisma } from "@/lib/prisma"
import { RateLimiter } from "@/lib/api-utils"

/**
 * One's own password, checked by the server where something asks for it: the
 * profile's check before a save (/api/auth/verify) and a new password of
 * one's own (UserService.update), PR 229. Wrong tries are counted per
 * account, both together, as signing in counts them: five in fifteen
 * minutes, then none, right or wrong, until the fifteen minutes are up. Each
 * try is counted before it's checked, so tries sent at once can't slip past
 * the count, and a right one gives its try back.
 */
export const OWN_PASSWORD_LIMIT = 5
export const OWN_PASSWORD_WINDOW_MS = 15 * 60 * 1000

const KEY = "own-password:"
const ownPasswordKey = (accountId: string) => `${KEY}${accountId}`

/** What the routes answer, in English beside their codes; the profile says them in the reader's language. */
export const CURRENT_PASSWORD_WRONG = "Your current password is needed to set a new one, and that isn't it"
export const OWN_PASSWORD_TRIES = "Too many wrong tries for this account. You can try again within 15 minutes, or your company's Admin can unlock it now."

/** Whether `typed` is the account's password; throws OWN_PASSWORD_TRIES once its wrong tries are used up. */
export async function ownPasswordMatches(accountId: string, hash: string, typed: string): Promise<boolean> {
    const key = ownPasswordKey(accountId)
    const { limited, resetAt } = await RateLimiter.getLimitData(key, OWN_PASSWORD_LIMIT, OWN_PASSWORD_WINDOW_MS)
    if (limited) throw new Error("OWN_PASSWORD_TRIES")
    const right = await bcrypt.compare(typed, hash)
    if (right) await RateLimiter.refund(key, resetAt)
    return right
}

/**
 * When each of these accounts' password tries start again, for the ones whose
 * five are used up now: shown beside their status, with Unlock, to whoever may
 * unlock them (app/api/users/route.ts), as a sign-in lock is.
 */
export async function ownPasswordPausedUntil(accountIds: string[], now: Date = new Date()): Promise<Map<string, Date>> {
    if (accountIds.length === 0) return new Map()
    const rows = await prisma.rateLimit.findMany({
        where: { key: { in: accountIds.map(ownPasswordKey) }, count: { gte: OWN_PASSWORD_LIMIT }, resetAt: { gt: now } },
        select: { key: true, resetAt: true },
    })
    return new Map(rows.map(row => [row.key.slice(KEY.length), row.resetAt]))
}

/** Lifts the pause before its fifteen minutes are up: Unlock, by somebody else (decided 2026-11-08). */
export async function unpauseOwnPassword(accountId: string): Promise<void> {
    await RateLimiter.clear(ownPasswordKey(accountId))
}

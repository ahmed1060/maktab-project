import { createHash } from 'node:crypto'
import { RateLimiter } from '@/lib/api-utils'
import { prisma } from '@/lib/prisma'

/**
 * Signing in's limit, the account's, whatever address the tries come from
 * (decided 2026-11-03): five wrong passwords or codes in a row pause it for
 * 30 seconds, and ten lock it for fifteen minutes. It was the address's, five
 * in fifteen minutes, so one person's mistakes locked everybody behind the
 * same office Wi-Fi, while the person themselves could get in from their
 * phone; and five was too few for somebody who'd forgotten which password.
 *
 * In a row: a sign-in that succeeds starts over, and a run is forgotten
 * fifteen minutes after its last wrong try. An email nobody has is counted
 * the same way, so a lock says nothing of which emails exist (F-17); it's
 * kept as a hash, not as it was typed. A Super Admin, or a company's Admin
 * for their own people, can lift a lock, and resetting the password with
 * Forgot password lifts it too.
 */
export const PAUSE_AFTER = 5
export const PAUSE_MS = 30 * 1000
export const LOCK_AFTER = 10
/** How long the lock after ten lasts, and how long a run is remembered after its last try. */
export const LOCK_MS = 15 * 60 * 1000

const ACCOUNT = 'login:account:'

/** The count for an account, wherever its sign-ins come from. */
export const accountLockKey = (accountId: string) => `${ACCOUNT}${accountId}`

/**
 * The count for an email nobody has, kept as a hash. Of the email exactly as
 * typed, as finding the account matches it: with its capitals set aside,
 * five wrong tries as NOBODY@ paused nobody@ only when nobody had it, as
 * somebody's is counted on their account (Codex on PR 183).
 */
export const unknownLockKey = (email: string) =>
    `login:unknown:${createHash('sha256').update(email).digest('hex')}`

/** Whose count a sign-in uses: the account's when there is one. */
export const lockKeyFor = (account: { id: string } | null, email: string) =>
    account ? accountLockKey(account.id) : unknownLockKey(email)

/** What holds sign-in back: the 30 seconds after five, or the fifteen minutes after ten. */
export type Hold = { kind: 'pause' | 'lock'; until: Date }

type Run = { count: number; resetAt: Date }

/** A try counted: whose, and the times the run had before it and has since, to put back if it's given back. */
export type Counted = { kind: 'counted'; key: string; before: Date | null; resetAt: Date }

/**
 * What a run of wrong tries holds back now. Its resetAt is when it's
 * forgotten, fifteen minutes after its last try, which after ten is when
 * the lock lifts; the pause is the first 30 seconds after the fifth.
 */
export function holdOf(run: Run | null, now: Date): Hold | null {
    if (!run || run.resetAt <= now) return null
    if (run.count >= LOCK_AFTER) return { kind: 'lock', until: run.resetAt }
    if (run.count === PAUSE_AFTER) {
        const until = new Date(run.resetAt.getTime() - LOCK_MS + PAUSE_MS)
        if (until > now) return { kind: 'pause', until }
    }
    return null
}

/**
 * Counts a try before its password is checked, or says what holds it back,
 * and then it isn't counted. Counted in one step, and only from where the
 * count may go on: under five, five with its 30 seconds over, or six to
 * nine. Postgres takes the row and checks those conditions again on what it
 * finds, so of tries sent together only as many get through as one at a
 * time would, and none is ever counted past the pause or the lock to be
 * given back. It was counted first and given back after, and a try coming
 * in between found six and took the 30 seconds as over (Codex on PR 183).
 * Fails closed, as RateLimiter does (F-10).
 */
export async function countSignIn(key: string, now: Date = new Date()): Promise<Hold | Counted> {
    try {
        const found = await prisma.rateLimit.findUnique({ where: { key } })
        const run = found && found.resetAt > now ? found : null
        const held = holdOf(run, now)
        if (held) return held
        // As found, to put back if the try is given back.
        const before = found?.resetAt ?? null
        const resetAt = new Date(now.getTime() + LOCK_MS)
        const counted: Counted = { kind: 'counted', key, before, resetAt }

        // No run: this try starts one, unless another sent with it already has.
        if (!run && await startRun(key, found !== null, now, resetAt)) return counted

        const added = await prisma.rateLimit.updateMany({
            where: {
                key,
                resetAt: { gt: now },
                OR: [
                    { count: { lt: PAUSE_AFTER } },
                    { count: PAUSE_AFTER, resetAt: { lte: new Date(now.getTime() + LOCK_MS - PAUSE_MS) } },
                    { count: { gt: PAUSE_AFTER, lt: LOCK_AFTER } },
                ],
            },
            data: { count: { increment: 1 }, resetAt },
        })
        if (added.count) return counted

        // Another try got there first: what holds this one back now.
        const again = await prisma.rateLimit.findUnique({ where: { key } })
        return holdOf(again && again.resetAt > now ? again : null, now) ?? { kind: 'pause', until: new Date(now.getTime() + PAUSE_MS) }
    } catch (e) {
        console.error('[sign-in lock] database error, failing closed', e)
        return { kind: 'pause', until: new Date(now.getTime() + PAUSE_MS) }
    }
}

/** Starts a run at one: a new row, or a forgotten one started over. Only one of the tries sent together does. */
async function startRun(key: string, exists: boolean, now: Date, resetAt: Date): Promise<boolean> {
    if (!exists) {
        try {
            await prisma.rateLimit.create({ data: { key, count: 1, resetAt } })
            return true
        } catch {
            // Somebody's row was made first: counted on from it.
            return false
        }
    }
    const started = await prisma.rateLimit.updateMany({ where: { key, resetAt: { lte: now } }, data: { count: 1, resetAt } })
    return started.count > 0
}

/**
 * What sign-in says when it's held back, with how long is left in seconds,
 * counted here, so the sign-in page counts it down without trusting the
 * phone's clock (lib/login-errors.ts, waitOf).
 */
export function holdMessage(hold: Hold, now: Date = new Date()): string {
    const wait = `[wait ${Math.max(1, Math.ceil((hold.until.getTime() - now.getTime()) / 1000))}]`
    if (hold.kind === 'pause') return `Sign-in paused for 30 seconds after five wrong tries for this account. ${wait}`
    const timeStr = hold.until.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    return `Too many login attempts for this account. Please try again at ${timeStr}. ${wait}`
}

const takeOne = (key: string) =>
    prisma.rateLimit.updateMany({ where: { key, count: { gt: 0 } }, data: { count: { decrement: 1 } } })

/**
 * Gives back a try that wasn't a wrong guess: the step that asks for the
 * code, or an account turned away after its password was right. With the
 * run's time as it was before, or the 30 seconds after the fifth wrong try
 * started again from the right password, and turned the code away (Codex on
 * PR 183). Only if nothing has been counted since; otherwise just the try.
 */
export async function giveBackSignIn(counted: Counted): Promise<void> {
    try {
        if (counted.before) {
            const put = await prisma.rateLimit.updateMany({
                where: { key: counted.key, count: { gt: 0 }, resetAt: counted.resetAt },
                data: { count: { decrement: 1 }, resetAt: counted.before },
            })
            if (put.count) return
        }
        await takeOne(counted.key)
    } catch { }
}

/** A sign-in that succeeded: the run is over, as the tries are counted in a row. */
export const forgetSignIn = (counted: Counted) => RateLimiter.clear(counted.key)

/** When each of these accounts can sign in again, for the ones locked for fifteen minutes now. */
export async function lockedUntil(accountIds: string[], now: Date = new Date()): Promise<Map<string, Date>> {
    if (accountIds.length === 0) return new Map()
    const rows = await prisma.rateLimit.findMany({
        // Only the fifteen minutes: the 30 seconds are over before anybody could look.
        where: { key: { in: accountIds.map(accountLockKey) }, count: { gte: LOCK_AFTER }, resetAt: { gt: now } },
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

import { createHash, randomUUID } from 'node:crypto'
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
 * The count for an email or a username nobody has, kept as a hash, and set
 * apart as finding the account sets them apart. An email exactly as typed:
 * with its capitals set aside, five wrong tries as NOBODY@ paused nobody@
 * only when nobody had it, as somebody's is counted on their account (Codex
 * on PR 183). A username, which has no @, capitals aside: as typed, five
 * wrong tries as NOBODY left nobody free only when nobody had it (Codex on
 * PR 186).
 */
export const unknownLockKey = (typed: string) =>
    `login:unknown:${createHash('sha256').update(typed.includes('@') ? typed : typed.toLowerCase()).digest('hex')}`

/** Whose count a sign-in uses: the account's when there is one. */
export const lockKeyFor = (account: { id: string } | null, typed: string) =>
    account ? accountLockKey(account.id) : unknownLockKey(typed)

/** What holds sign-in back: the 30 seconds after five, or the fifteen minutes after ten. */
export type Hold = { kind: 'pause' | 'lock'; until: Date }

type Run = { count: number; resetAt: Date }

/**
 * A try counted, to give back or mark wrong once its password has been
 * checked: in the run it was counted in, and no other, as the account may be
 * unlocked or signed in meanwhile and a new run started (Codex on PR 183).
 */
export type Counted = { kind: 'counted'; key: string; run: string | null }

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
 * time would, and none is ever counted past the pause or the lock (Codex on
 * PR 183).
 *
 * Counting moves the run's time only at the fifth, which the 30 seconds run
 * from, so tries sent together can't pass them; a wrong guess moves it once
 * it's known to be wrong (markWrongSignIn), which the fifteen minutes run
 * from at the tenth. So a try given back takes back only the count, in
 * whatever order tries come back: putting back the time it found let two
 * overlapping right passwords start the 30 seconds again, and the tenth
 * moving it let five do the same (Codex on PR 183). Fails closed, as
 * RateLimiter does (F-10).
 */
export async function countSignIn(key: string, now: Date = new Date()): Promise<Hold | Counted> {
    const pause: Hold = { kind: 'pause', until: new Date(now.getTime() + PAUSE_MS) }
    const resetAt = new Date(now.getTime() + LOCK_MS)
    try {
        // Looked at again when another try changes the run first.
        for (let look = 0; look < 3; look++) {
            const found = await prisma.rateLimit.findUnique({ where: { key } })
            const run = found && found.resetAt > now ? found : null
            const held = holdOf(run, now)
            if (held) return held

            // No run: this try starts one, unless another sent with it already has.
            if (!run) {
                const started = await startRun(key, found !== null, now, resetAt)
                if (started) return { kind: 'counted', key, run: started }
                continue
            }

            // Counted in this run only: one started meanwhile is looked at again.
            const live = { key, run: run.run, resetAt: { gt: now } }
            const added = await prisma.rateLimit.updateMany({
                where: {
                    ...live,
                    OR: [
                        { count: { lt: PAUSE_AFTER - 1 } },
                        { count: PAUSE_AFTER, resetAt: { lte: new Date(now.getTime() + LOCK_MS - PAUSE_MS) } },
                        { count: { gt: PAUSE_AFTER, lt: LOCK_AFTER } },
                    ],
                },
                data: { count: { increment: 1 } },
            })
            if (added.count) return { kind: 'counted', key, run: run.run }
            // The fifth: the 30 seconds run from it.
            const marked = await prisma.rateLimit.updateMany({
                where: { ...live, count: PAUSE_AFTER - 1 },
                data: { count: { increment: 1 }, resetAt },
            })
            if (marked.count) return { kind: 'counted', key, run: run.run }
        }
        // Still changing under it: what holds it back now, or the 30 seconds.
        const again = await prisma.rateLimit.findUnique({ where: { key } })
        return holdOf(again && again.resetAt > now ? again : null, now) ?? pause
    } catch (e) {
        console.error('[sign-in lock] database error, failing closed', e)
        return pause
    }
}

/**
 * Starts a run at one, with an id of its own: a new row, or a forgotten one
 * started over. Only one of the tries sent together does; it says the run's
 * id, or null when another got there first.
 */
async function startRun(key: string, exists: boolean, now: Date, resetAt: Date): Promise<string | null> {
    const run = randomUUID()
    if (!exists) {
        try {
            await prisma.rateLimit.create({ data: { key, count: 1, resetAt, run } })
            return run
        } catch {
            // Somebody's row was made first: counted on from it.
            return null
        }
    }
    const started = await prisma.rateLimit.updateMany({ where: { key, resetAt: { lte: now } }, data: { count: 1, resetAt, run } })
    return started.count > 0 ? run : null
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

/**
 * Gives back a try that wasn't a wrong guess: the step that asks for the
 * code, or an account turned away after its password was right. Only the
 * count: counting it didn't move the run's time, past the fifth, and the
 * 30 seconds run from the fifth wrong try.
 */
export async function giveBackSignIn(counted: Counted): Promise<void> {
    try {
        await prisma.rateLimit.updateMany({ where: { key: counted.key, run: counted.run, count: { gt: 0 } }, data: { count: { decrement: 1 } } })
    } catch { }
}

/** A try that was a wrong guess: the run is remembered fifteen minutes from it, and at the tenth, locked for them. */
export async function markWrongSignIn(counted: Counted, now: Date = new Date()): Promise<void> {
    const resetAt = new Date(now.getTime() + LOCK_MS)
    try {
        await prisma.rateLimit.updateMany({ where: { key: counted.key, run: counted.run, count: { gt: 0 }, resetAt: { lt: resetAt } }, data: { resetAt } })
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

/**
 * Lifts the lock. Only sign-in's: the count of codes asked to confirm a
 * sensitive action (lib/auth.ts, step-up) is left as it is, or unlocking
 * gave five more codes each time, so somebody holding a session could
 * guess without end (Codex on PR 183).
 */
export async function unlockSignIn(accountId: string): Promise<void> {
    await RateLimiter.clear(accountLockKey(accountId))
}

/**
 * Every count whose window has passed: one is as good as none (RateLimiter
 * starts a new window), and every email typed has one. Swept daily (prune).
 */
export async function sweepExpiredCounts(now: Date = new Date()): Promise<number> {
    const { count } = await prisma.rateLimit.deleteMany({ where: { resetAt: { lt: now } } })
    return count
}

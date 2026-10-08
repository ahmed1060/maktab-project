import { createHash, randomBytes } from "node:crypto"
import { prisma } from "@/lib/prisma"
import type { Prisma } from "@prisma/client"

/**
 * One-time numbers a phone signs (ATTENDANCE_PLAN.md §9.2): asked for just
 * before registering or checking in, signed by the phone's key, used once,
 * within minutes. A captured request cannot be sent again, and a number given
 * for one purpose cannot be used for the other. Kept only as a hash.
 */

export type ChallengePurpose = "REGISTER" | "CHECK_IN" | "FACE"

/** How long a number may be used for. Long enough to get a fix and sign; short enough to be worthless if seen. */
export const CHALLENGE_TTL_MS = 5 * 60_000

const hashOf = (nonce: string) => createHash("sha256").update(nonce).digest("hex")

export class AttendanceChallengeService {
    /**
     * A new number, which replaces any this person was given for the same
     * purpose and has not used: at most one waits per person and purpose,
     * however often an app asks.
     */
    static async issue(userId: string, purpose: ChallengePurpose, now = new Date()) {
        const nonce = randomBytes(32).toString("base64url")
        const expiresAt = new Date(now.getTime() + CHALLENGE_TTL_MS)
        // One at a time per person and purpose: two at once each deleted before the other's row was there,
        // and both numbers stayed usable (review on #21).
        await prisma.$transaction(async tx => {
            await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`attendance-challenge:${userId}:${purpose}`}))::text`
            await tx.attendanceChallenge.deleteMany({ where: { userId, purpose, usedAt: null } })
            await tx.attendanceChallenge.create({ data: { userId, purpose, nonceHash: hashOf(nonce), expiresAt } })
        })
        return { nonce, expiresAt }
    }

    /**
     * Used up, if it is this person's, for this purpose, unused and in time.
     * One conditional write, so two requests with the same number can't both
     * have it.
     */
    static async consume(tx: Prisma.TransactionClient, userId: string, purpose: ChallengePurpose, nonce: string, now = new Date()): Promise<boolean> {
        if (typeof nonce !== "string" || nonce.length < 20 || nonce.length > 100) return false
        const { count } = await tx.attendanceChallenge.updateMany({
            where: { nonceHash: hashOf(nonce), userId, purpose, usedAt: null, expiresAt: { gt: now } },
            data: { usedAt: now },
        })
        return count === 1
    }

    /**
     * Whether the number could still be used, without using it: checked
     * before asking Google or Apple anything, so a replayed or made-up
     * request costs no call to them (review on #26). consume() still decides.
     */
    static async isLive(userId: string, purpose: ChallengePurpose, nonce: string, now = new Date()): Promise<boolean> {
        if (typeof nonce !== "string" || nonce.length < 20 || nonce.length > 100) return false
        const found = await prisma.attendanceChallenge.findFirst({
            where: { nonceHash: hashOf(nonce), userId, purpose, usedAt: null, expiresAt: { gt: now } },
            select: { id: true },
        })
        return !!found
    }

    /** Old numbers, used or not, for the nightly prune. */
    static async prune(now = new Date()) {
        return prisma.attendanceChallenge.deleteMany({ where: { expiresAt: { lt: new Date(now.getTime() - 24 * 3_600_000) } } })
    }
}

import { timingSafeEqual } from "crypto"

/**
 * Verifies a request's Authorization header against CRON_SECRET.
 *
 * Two things the naive `authHeader === \`Bearer ${process.env.CRON_SECRET}\``
 * check gets wrong:
 *  - When CRON_SECRET is unset, the template literal becomes the string
 *    "Bearer undefined", which an attacker can send verbatim to pass the
 *    check. Here, a missing secret always fails closed.
 *  - `===` on secrets is not constant-time. This uses timingSafeEqual instead.
 */
export function isValidCronRequest(req: Request): boolean {
    const cronSecret = process.env.CRON_SECRET
    if (!cronSecret) return false

    const authHeader = req.headers.get("authorization") ?? req.headers.get("Authorization")
    if (!authHeader) return false

    const expected = Buffer.from(`Bearer ${cronSecret}`)
    const actual = Buffer.from(authHeader)

    // timingSafeEqual throws on mismatched lengths, so check that first —
    // returning early here is safe because it depends only on length, not content.
    if (expected.length !== actual.length) return false

    return timingSafeEqual(expected, actual)
}

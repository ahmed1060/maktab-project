/**
 * Next.js throws special control-flow errors internally — redirect(),
 * notFound(), and its own static/dynamic-rendering detection (thrown from
 * inside headers()/cookies() when it's probing whether a route can be
 * statically rendered) — each marked with a `.digest` string. These must
 * be allowed to propagate untouched: catching one and "handling" it like a
 * real application error breaks the mechanism it's part of.
 *
 * Confirmed hit in practice, not theoretical: `next build`'s static/dynamic
 * probing throws DYNAMIC_SERVER_USAGE from inside getServerSession() (it
 * calls headers()/cookies()) for every route that uses it, and it was
 * landing in this app's own catch blocks before this check existed.
 */
export function isNextInternalError(error: unknown): boolean {
    const digest = (error as any)?.digest
    return typeof digest === 'string' && (
        digest === 'DYNAMIC_SERVER_USAGE' ||
        digest.startsWith('NEXT_REDIRECT') ||
        digest.startsWith('NEXT_NOT_FOUND') ||
        digest.startsWith('NEXT_HTTP_ERROR_FALLBACK')
    )
}

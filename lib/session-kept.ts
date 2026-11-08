/**
 * A new password ends the account's other sessions: its sessionVersion moves
 * on, and a session whose token is at an older one is ended at its next
 * check (lib/auth.ts). The session a person sets their own password from is
 * kept: the account remembers it, at the version that ended the others, in
 * keptSession. Kept by the server rather than by the browser catching up, so
 * every request it makes meanwhile is still its own: refused, one would have
 * signed it out (components/AuthInterceptor.tsx).
 *
 * A session is named by the id its token is given at sign-in (sid). Its jti
 * can't name it: next-auth gives the token a new one each time it writes the
 * cookie.
 */

type Account = { sessionVersion: number; keptSession: string | null }

/** What an account remembers of the session it kept: the version it moved to, and the session. */
export function keptSession(version: number, sid: string): string {
    return `${version}:${sid}`
}

/** Whether a token is the session its account kept at the version it's at. */
export function isKept(account: Account, token: { sid?: unknown }): boolean {
    return typeof token.sid === 'string' && token.sid !== '' && account.keptSession === keptSession(account.sessionVersion, token.sid)
}

/**
 * What the account keeps when the session `from` sets its password, which
 * moves its version on by one: that session, if it's still good, as its check
 * would find it, at the account's version or kept there by a change before
 * this one. One the account has already ended, though it hasn't yet been told,
 * isn't kept by setting a password: it ends with the rest. Null when none is.
 */
export function keepAfterChange(account: Account, from: { sid?: unknown; sessionVersion?: unknown } | null | undefined): string | null {
    if (!from || typeof from.sid !== 'string' || !from.sid) return null
    const good = from.sessionVersion === account.sessionVersion || isKept(account, from)
    return good ? keptSession(account.sessionVersion + 1, from.sid) : null
}

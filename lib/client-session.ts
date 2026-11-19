/**
 * A client account's session, and the client's area it's kept in
 * (CLIENT_PORTAL_PLAN.md §5.3, §12 step 7a; PR 331).
 *
 * A client account is one of a client's people, who signs in to see what the
 * company keeps for their client (§5.1). It isn't one of the company's people
 * or a Super Admin, and nothing of the company's app takes its session: the
 * proxy sends it to the client's area, and every route refuses it but the
 * area's own. Signing in as one makes it (step 7b, PR 332; lib/client-sign-in.ts).
 */

/** What a client account's session says it is, where a person's says its role. No person has it. */
export const CLIENT_ACCOUNT_ROLE = "CLIENT_ACCOUNT"

/** The client's area: its pages, and its routes, the only ones a client account reaches. */
export const CLIENT_AREA = "/portal"
export const CLIENT_AREA_API = "/api/portal"

type Who = { role?: unknown; preview?: unknown; id?: unknown } | null | undefined

export const isClientAccount = (who: Who): boolean => !!who && who.role === CLIENT_ACCOUNT_ROLE

const under = (pathname: string, root: string) => pathname === root || pathname.startsWith(`${root}/`)
export const inClientArea = (pathname: string): boolean => under(pathname, CLIENT_AREA)
export const inClientAreaApi = (pathname: string): boolean => under(pathname, CLIENT_AREA_API)

/**
 * Where the proxy sends a signed-in browser before anything else, or null to
 * let the request on. A client account goes from the company's pages, the
 * sign-in page and the root to the client's area; one of the company's
 * people, or a Super Admin, from the client's area to the dashboard. Pages
 * open to anyone, as the legal pages and the invitation's, stay open.
 */
export function proxyRedirect(token: { sub?: unknown; role?: unknown } | null | undefined, pathname: string): string | null {
    // Nobody in it: not signed in, or a session the server ended.
    if (!token?.sub) return null
    if (isClientAccount(token)) {
        if (inClientArea(pathname)) return null
        if (pathname === "/" || pathname === "/login" || under(pathname, "/dashboard")) return CLIENT_AREA
        return null
    }
    return inClientArea(pathname) ? "/dashboard" : null
}

/**
 * Who an audit or error entry names: one of the company's people, or a Super
 * Admin, by the table each is kept in. A Super Admin previewing a role is
 * still the Super Admin. A client account is neither, so it names no one: it
 * isn't kept in either table.
 */
export function loggedAs(who: Who): { userId: string | null; superAdminId: string | null } {
    const id = typeof who?.id === "string" ? who.id : null
    if (!who || !id || isClientAccount(who)) return { userId: null, superAdminId: null }
    if (who.preview || who.role === "SUPER_ADMIN") return { userId: null, superAdminId: id }
    return { userId: id, superAdminId: null }
}

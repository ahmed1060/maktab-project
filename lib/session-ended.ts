/**
 * Where a server page sends a browser whose session the server has ended: a
 * role edited with "apply now" (ROLES_PLAN.md §4.4), a password reset, or a
 * check it couldn't make (lib/auth.ts). The route there clears the session
 * cookie and goes on to sign in (app/api/auth/ended/route.ts).
 *
 * Not straight to sign in: a page can't clear a cookie, and with the old one
 * still there, proxy.ts sent the browser from the sign-in page back into the
 * dashboard.
 */
export const SESSION_ENDED_PATH = '/api/auth/ended'

/**
 * Sign in, for a browser the server signed out: the page says its session
 * ended (DESIGN.md §5.5, Sign-in). From the route above, and from a page
 * whose own request was refused (components/AuthInterceptor.tsx).
 */
export const SESSION_ENDED_SIGN_IN = '/login?session=ended'

/** Whether the sign-in page was opened by a browser the server signed out. */
export const sessionEnded = (params: URLSearchParams | null) => params?.get('session') === 'ended'

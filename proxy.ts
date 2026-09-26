import { withAuth } from "next-auth/middleware"
import { NextResponse } from "next/server"

// Fail loudly rather than silently verifying session tokens against a
// publicly known string. lib/auth.ts already has no fallback here — the two
// halves of the auth system must agree on the real secret or not run at all.
const nextAuthSecret = process.env.NEXTAUTH_SECRET
if (!nextAuthSecret) {
    throw new Error("NEXTAUTH_SECRET is not set — refusing to start with an insecure fallback secret")
}

// Next 16 renamed this file convention from "middleware" to "proxy" and warns
// on every build while the old name is used. Only the filename and this
// function's name change — what it does, and the matcher below, are untouched.
// The next-auth import path is the package's own and is unrelated to the
// convention.
export default withAuth(
    function proxy(req) {
        const token = req.nextauth.token
        const { pathname } = req.nextUrl

        // 1. If user is authenticated and tries to access /login or /, redirect to /dashboard
        if (token && (pathname === '/login' || pathname === '/')) {
            return NextResponse.redirect(new URL('/dashboard', req.url))
        }

        // 2. Unauthenticated users trying to access /dashboard are handled by withAuth automatically
        // but the matcher below ensures it only runs for protected routes.

        // 2b. A user with a pending forced password reset (F-02: replaces the
        // old password-reveal feature) can't use the rest of the dashboard
        // until they set a new password.
        if (token?.mustChangePassword && pathname.startsWith('/dashboard') && pathname !== '/dashboard/change-password') {
            return NextResponse.redirect(new URL('/dashboard/change-password', req.url))
        }

        // 2c. F-27: an unverified email blocks the rest of the dashboard the
        // same way. Checked after mustChangePassword (not instead of it) —
        // a temp-password takeover is the more urgent thing to resolve
        // first if somehow both are true at once. Excludes change-password
        // too, not just the security screen, so the redirect above still wins
        // when both conditions hold.
        //
        // The excluded path and the redirect target must be the same page, and
        // must be the *new* one. /dashboard/email-settings is now a redirect
        // into here: leave it as the exclusion and an unverified user bounces
        // between the gate letting that path through and the page sending them
        // on, forever.
        if (
            token && !token.mustChangePassword && !token.emailVerified &&
            pathname.startsWith('/dashboard') &&
            pathname !== '/dashboard/security-settings' &&
            pathname !== '/dashboard/change-password'
        ) {
            return NextResponse.redirect(new URL('/dashboard/security-settings', req.url))
        }

        // 2d. System-wide maintenance mode: non-super-admins get held on a
        // dedicated page. Super Admins are exempt so whoever turned it on
        // can still finish what they're doing (e.g. a backup restore) and
        // turn it back off. Excludes the maintenance page itself, or this
        // would redirect-loop.
        if (
            token?.maintenanceMode && token.role !== 'SUPER_ADMIN' &&
            pathname.startsWith('/dashboard') &&
            pathname !== '/dashboard/maintenance'
        ) {
            return NextResponse.redirect(new URL('/dashboard/maintenance', req.url))
        }

        // 2e. Subscription lockout: the company's Admin is the only person who
        // reaches the dashboard at all in this state — everyone else is stopped
        // at login — and they are held on a page that explains it and says
        // plainly that nothing was deleted. Super Admin is exempt: they are the
        // one who can renew it on the customer's behalf.
        //
        // Excludes the expired page itself, or this redirect-loops. Placed after
        // maintenance so a system-wide maintenance hold still wins: that one
        // affects everybody and is usually shorter.
        if (
            (token?.subscription as any)?.state === 'LOCKED' && token?.role !== 'SUPER_ADMIN' &&
            pathname.startsWith('/dashboard') &&
            pathname !== '/dashboard/subscription-expired'
        ) {
            return NextResponse.redirect(new URL('/dashboard/subscription-expired', req.url))
        }

        // 3. Locale Validation
        const locale = req.cookies.get('NEXT_LOCALE')?.value
        if (locale && !['en', 'ar'].includes(locale)) {
            const response = NextResponse.next()
            response.cookies.set('NEXT_LOCALE', 'en', { path: '/', maxAge: 31536000 })
            return response
        }

        return NextResponse.next()
    },
    {
        callbacks: {
            authorized: ({ token, req }) => {
                const { pathname } = req.nextUrl

                // If it's the dashboard, require a token
                if (pathname.startsWith('/dashboard')) {
                    return !!token
                }

                // Always allow other paths (middleware function above handles /login and /)
                return true
            },
        },
        secret: nextAuthSecret,
    }
)

export const config = {
    matcher: [
        /*
         * Match all request paths except for the ones starting with:
         * - api (API routes)
         * - _next/static (static files)
         * - _next/image (image optimization files)
         * - favicon.ico (favicon file)
         * - monitoring (Sentry's tunnel, next.config.mjs — error reports,
         *   including from the login page and a locked subscription, must
         *   not be redirected)
         * - common extensions (svg, png, jpg, etc.)
         *
         * F-21: no more "uploads" exclusion — storage moved to Supabase
         * long ago, there's no local public/uploads/ path this app ever
         * serves from.
         */
        '/((?!api|_next/static|_next/image|favicon.ico|monitoring|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
    ],
}

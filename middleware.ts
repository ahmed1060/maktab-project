import { withAuth } from "next-auth/middleware"
import { NextResponse } from "next/server"

export default withAuth(
    function middleware(req) {
        const token = req.nextauth.token
        const { pathname } = req.nextUrl

        // 1. If user is authenticated and tries to access /login or /, redirect to /dashboard
        if (token && (pathname === '/login' || pathname === '/')) {
            return NextResponse.redirect(new URL('/dashboard', req.url))
        }

        // 2. Unauthenticated users trying to access /dashboard are handled by withAuth automatically
        // but the matcher below ensures it only runs for protected routes.

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
         */
        '/((?!api|_next/static|_next/image|favicon.ico).*)',
    ],
}

import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { SESSION_ENDED_SIGN_IN } from "@/lib/session-ended"

/** next-auth's session cookie, by either name, and each part of it when it's long enough to be split. */
const SESSION_COOKIE = /^(__Secure-)?next-auth\.session-token(\.\d+)?$/

/**
 * Where a server page sends a browser whose session the server has ended
 * (lib/session-ended.ts): its session cookie is cleared, and it goes on to
 * sign in. A page can't clear a cookie itself, and sent to the sign-in page
 * with the old one still there, proxy.ts sent the browser back into the
 * dashboard.
 *
 * A session that's still good is sent to the dashboard instead, so a link to
 * here can't sign anyone out.
 */
export async function GET(req: NextRequest) {
    const session = await getServerSession(authOptions)
    if (session) return NextResponse.redirect(new URL("/dashboard", req.url))

    // Where it's told its session ended (DESIGN.md §5.5, Sign-in).
    const res = NextResponse.redirect(new URL(SESSION_ENDED_SIGN_IN, req.url))
    for (const { name } of req.cookies.getAll()) {
        if (!SESSION_COOKIE.test(name)) continue
        // A __Secure- cookie is only cleared by one that's Secure too.
        res.cookies.set(name, "", { path: "/", maxAge: 0, httpOnly: true, sameSite: "lax", secure: name.startsWith("__Secure-") })
    }
    return res
}

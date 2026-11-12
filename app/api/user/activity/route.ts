import { withStandardHandler } from "@/lib/api-utils"
import { getToken } from "next-auth/jwt"
import type { NextRequest } from "next/server"
import { ApiResponse } from "@/lib/api-response"
import { UserService } from "@/lib/services/user.service"
import { accountKind } from "@/lib/security"
import { readTabReport } from "@/lib/tab-presence"

export const POST = withStandardHandler(async (req, session, body) => {
    // A tab's report (lib/tab-presence.ts): sent as JSON while the page is
    // open, and as text by a closing tab's beacon, which the handler leaves
    // unread. None at all from a page still on the script before part 6a.
    const report = readTabReport(body ?? await req.text().catch(() => ""))
    if (report === "bad") return ApiResponse.badRequest("A tab's report is its id, and here or away with its place in the tab's order.")
    // The browser's session, named in its cookie, which signing out closes
    // the tabs of (UserService.closeSessionTabs).
    const token = report && "state" in report ? await getToken({ req: req as NextRequest, secret: process.env.NEXTAUTH_SECRET }) : null
    const sid = typeof token?.sid === "string" && token.sid ? token.sid : null
    // The account's own kind, not a previewed role's: the id is the
    // Super Admin's while they preview one.
    const result = await UserService.updateActivity(session.user.id, accountKind(session.user) ?? session.user.role, report, sid)
    return ApiResponse.success(result)
})

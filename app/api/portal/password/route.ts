import { NextRequest } from "next/server"
import { getToken } from "next-auth/jwt"
import { withStandardHandler } from "@/lib/api-utils"
import { ApiResponse } from "@/lib/api-response"
import { CLIENT_PASSWORD_TRIES, changeClientPassword } from "@/lib/client-password-change"
import { CURRENT_PASSWORD_WRONG } from "@/lib/own-password"

/**
 * Change password for one of a client's people (CLIENT_PORTAL_PLAN.md §5.3,
 * §12 step 7d-2; PR 335), from the client's area, for the session's own
 * account alone. The session it's sent from is named in its cookie and kept
 * (lib/session-kept.ts), as a person's is (app/api/users). The other refusals
 * are answered by the handler (lib/api-errors.ts).
 */
export const POST = withStandardHandler(async (req, session, json) => {
    const from = await getToken({ req: req as NextRequest, secret: process.env.NEXTAUTH_SECRET })
    try {
        await changeClientPassword(session.user.id, from, json)
    } catch (error) {
        const code = error instanceof Error ? error.message : ""
        // With their codes, which the page says in the reader's language.
        if (code === "CURRENT_PASSWORD_WRONG") return ApiResponse.refused(403, CURRENT_PASSWORD_WRONG, code)
        if (code === "OWN_PASSWORD_TRIES") return ApiResponse.refused(429, CLIENT_PASSWORD_TRIES, code)
        throw error
    }
    return ApiResponse.success({ changed: true })
}, { clientArea: true })

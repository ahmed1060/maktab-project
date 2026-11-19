import { withStandardHandler } from "@/lib/api-utils"
import { ApiResponse } from "@/lib/api-response"
import { prisma } from "@/lib/prisma"
import { CLIENT_LANGUAGES } from "@/lib/client-accounts"

/**
 * The language one of a client's people picks on the client's area's top
 * bar (CLIENT_PORTAL_PLAN.md §5.2, §12 step 7d-1; PR 334), kept as their
 * account's, as a person's choice is theirs (app/api/user/language): the area
 * opens in it next time, and the emails to them are in it. Their own account
 * only, the session's; Arabic or English.
 */
export const POST = withStandardHandler(async (_req, session, json) => {
    const language = json?.language
    if (!(CLIENT_LANGUAGES as readonly unknown[]).includes(language)) return ApiResponse.badRequest("Invalid language")
    const { count } = await prisma.clientAccount.updateMany({ where: { id: session.user.id }, data: { language } })
    // Removed meanwhile: its session ends at its next check (lib/client-sign-in.ts).
    if (!count) return ApiResponse.notFound("Account not found")
    return ApiResponse.success({ language })
}, { clientArea: true })

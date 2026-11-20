import { withStandardHandler } from "@/lib/api-utils"
import { ApiResponse } from "@/lib/api-response"
import { nizmoMessages } from "@/lib/services/client-message-template.service"

/** Nizmo's client messages on WhatsApp, each in each language, for the Super Admin (CLIENT_PORTAL_PLAN.md §7.1). */
export const GET = withStandardHandler(async (_req, session) => {
    if (session.user.role !== "SUPER_ADMIN") return ApiResponse.forbidden()
    return ApiResponse.success({ messages: await nizmoMessages() })
})

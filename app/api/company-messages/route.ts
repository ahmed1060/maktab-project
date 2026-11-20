import { withStandardHandler } from "@/lib/api-utils"
import { ApiResponse } from "@/lib/api-response"
import { messagesCompanyId } from "@/lib/client-message-template"
import { companyMessages } from "@/lib/services/client-message-template.service"

/**
 * A company's client messages on WhatsApp, each in each language, as it uses
 * them: its own copy or Nizmo's (CLIENT_PORTAL_PLAN.md §7.1, step 10c-1).
 * For whoever holds client_messages.manage, in a company whose package has
 * the client portal: the path is the tax position's module's in
 * lib/features/routes.ts, and the service checks the company's own package,
 * as the Super Admin, who names the company, passes the gate whatever it
 * bought.
 */
export const GET = withStandardHandler(async (req, session) => {
    const companyId = messagesCompanyId(session.user as any, new URL(req.url).searchParams.get("companyId"))
    if (!companyId) return ApiResponse.badRequest("companyId is required")
    return ApiResponse.success({ messages: await companyMessages(companyId) })
}, { permission: "client_messages.manage" })

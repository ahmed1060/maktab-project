import { withStandardHandler } from "@/lib/api-utils"
import { ApiResponse } from "@/lib/api-response"
import { messagesCompanyId } from "@/lib/client-message-template"
import { setTaxUpdateEmails, taxUpdateEmails } from "@/lib/services/client-message-template.service"
import { taxUpdateEmailsSchema } from "@/lib/validations/client-message.schema"

/**
 * The update email's switch on the Client portal tab (CLIENT_PORTAL_PLAN.md
 * §4.4, step 11a; PR 350): whether the company emails its client's people
 * when their tax position is updated. Read and changed by whoever holds
 * client_messages.manage, for their own company, or the one the Super Admin
 * names. The path is the tax position's module's in lib/features/routes.ts,
 * and the service checks the company's own package. Its refusals are
 * answered by withStandardHandler (lib/api-errors.ts).
 */
const actorOf = (session: any) => ({ id: session.user.id, name: session.user.name ?? "", role: session.user.role })

export const GET = withStandardHandler(async (req, session) => {
    const companyId = messagesCompanyId(session.user as any, new URL(req.url).searchParams.get("companyId"))
    if (!companyId) return ApiResponse.badRequest("companyId is required")
    return ApiResponse.success({ on: await taxUpdateEmails(companyId) })
}, { permission: "client_messages.manage" })

export const PUT = withStandardHandler(async (req, session, json) => {
    const companyId = messagesCompanyId(session.user as any, new URL(req.url).searchParams.get("companyId"))
    if (!companyId) return ApiResponse.badRequest("companyId is required")
    const validation = taxUpdateEmailsSchema.safeParse(json)
    if (!validation.success) return ApiResponse.badRequest("Validation Error", validation.error.format())
    return ApiResponse.success({ on: await setTaxUpdateEmails(actorOf(session), companyId, validation.data.on) })
}, { permission: "client_messages.manage" })

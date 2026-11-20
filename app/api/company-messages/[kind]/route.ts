import { withStandardHandler } from "@/lib/api-utils"
import { ApiResponse } from "@/lib/api-response"
import { messagesCompanyId } from "@/lib/client-message-template"
import { nizmoMessagesAgain } from "@/lib/services/client-message-template.service"
import { nizmoMessagesAgainSchema } from "@/lib/validations/client-message.schema"

/**
 * One of a company's client messages, in every language
 * (CLIENT_PORTAL_PLAN.md §7.1, step 10c-2; PR 349): DELETE is Use Nizmo's
 * message as the Client portal tab asks for it, putting back every language
 * the company changed, all of them or none. Each is in the audit log. Its
 * refusals are answered by withStandardHandler (lib/api-errors.ts).
 */
const actorOf = (session: any) => ({ id: session.user.id, name: session.user.name ?? "", role: session.user.role })

export const DELETE = withStandardHandler(async (req, session, json, context) => {
    const companyId = messagesCompanyId(session.user as any, new URL(req.url).searchParams.get("companyId"))
    if (!companyId) return ApiResponse.badRequest("companyId is required")
    const validation = nizmoMessagesAgainSchema.safeParse({ ...json, kind: context.params.kind })
    if (!validation.success) return ApiResponse.badRequest("Validation Error", validation.error.format())
    return ApiResponse.success({ messages: await nizmoMessagesAgain(actorOf(session), companyId, validation.data) })
}, { permission: "client_messages.manage" })

import { withStandardHandler } from "@/lib/api-utils"
import { ApiResponse } from "@/lib/api-response"
import { messagesCompanyId } from "@/lib/client-message-template"
import { nizmoMessageAgain, saveCompanyMessage } from "@/lib/services/client-message-template.service"
import { clientMessageSchema, nizmoMessageAgainSchema } from "@/lib/validations/client-message.schema"

/**
 * One of a company's client messages, in one language
 * (CLIENT_PORTAL_PLAN.md §7.1, step 10c-1): PUT saves the company's copy,
 * from the text it started from, as the Super Admin's are saved; DELETE is
 * Use Nizmo's message, which takes the copy away. Each is in the audit log.
 * Their refusals are answered by withStandardHandler (lib/api-errors.ts).
 */
const actorOf = (session: any) => ({ id: session.user.id, name: session.user.name ?? "", role: session.user.role })

export const PUT = withStandardHandler(async (req, session, json, context) => {
    const companyId = messagesCompanyId(session.user as any, new URL(req.url).searchParams.get("companyId"))
    if (!companyId) return ApiResponse.badRequest("companyId is required")
    const validation = clientMessageSchema.safeParse({ ...json, kind: context.params.kind, language: context.params.language })
    if (!validation.success) return ApiResponse.badRequest("Validation Error", validation.error.format())
    return ApiResponse.success(await saveCompanyMessage(actorOf(session), companyId, validation.data))
}, { permission: "client_messages.manage" })

export const DELETE = withStandardHandler(async (req, session, json, context) => {
    const companyId = messagesCompanyId(session.user as any, new URL(req.url).searchParams.get("companyId"))
    if (!companyId) return ApiResponse.badRequest("companyId is required")
    const validation = nizmoMessageAgainSchema.safeParse({ ...json, kind: context.params.kind, language: context.params.language })
    if (!validation.success) return ApiResponse.badRequest("Validation Error", validation.error.format())
    return ApiResponse.success(await nizmoMessageAgain(actorOf(session), companyId, validation.data))
}, { permission: "client_messages.manage" })

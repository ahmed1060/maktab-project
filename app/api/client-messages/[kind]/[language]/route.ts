import { withStandardHandler } from "@/lib/api-utils"
import { ApiResponse } from "@/lib/api-response"
import { saveNizmoMessage } from "@/lib/services/client-message-template.service"
import { clientMessageSchema } from "@/lib/validations/client-message.schema"

/**
 * The Super Admin changes one of Nizmo's client messages, in one language,
 * for every company without its own copy (CLIENT_PORTAL_PLAN.md §7.1). Its
 * refusals are answered by withStandardHandler (lib/api-errors.ts).
 */
export const PUT = withStandardHandler(async (_req, session, json, context) => {
    if (session.user.role !== "SUPER_ADMIN") return ApiResponse.forbidden()
    const validation = clientMessageSchema.safeParse({ ...json, kind: context.params.kind, language: context.params.language })
    if (!validation.success) return ApiResponse.badRequest("Validation Error", validation.error.format())
    return ApiResponse.success(await saveNizmoMessage({ id: session.user.id, name: session.user.name ?? "" }, validation.data))
})

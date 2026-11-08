import { withStandardHandler } from "@/lib/api-utils"
import { ApiResponse } from "@/lib/api-response"
import type { Actor } from "@/lib/permissions/can"
import { clientStatement } from "@/lib/services/client-statement.service"

/**
 * A client's statement (CLIENTS_PLAN.md §6.9): its charges for a period, with
 * what's still due, to print or save as a PDF. Every check is the
 * service's, for whoever sees all the company's charges; the permission here
 * only turns away someone who sees none at all.
 */
export const GET = withStandardHandler(async (req, session) => {
    const params = new URL(req.url).searchParams
    const read = (key: string) => params.get(key) || undefined
    return ApiResponse.success(await clientStatement(session.user as Actor & { id: string }, { clientId: read("clientId"), from: read("from"), to: read("to") }))
}, { permission: "charges.view" })

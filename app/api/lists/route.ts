import { withStandardHandler } from "@/lib/api-utils"
import { ApiResponse } from "@/lib/api-response"
import { ListService } from "@/lib/services/list.service"

/**
 * The company's saved lists of cost names and task titles (CLIENTS_PLAN.md
 * §5): what a picker suggests as someone types (?kind=&q=), a whole list
 * for the Saved lists page (?kind=&manage=1), and every name for a filter
 * (?kind=&pick=filters). Each check is ListService's, against the name's
 * company; the permission here only turns away someone who holds none at
 * all.
 */
export const GET = withStandardHandler(async (req, session) => {
    const { searchParams } = new URL(req.url)
    const input = { kind: searchParams.get("kind"), companyId: searchParams.get("companyId") }
    if (searchParams.get("manage") === "1") return ApiResponse.success(await ListService.list(session, input))
    // Every name, for the Tasks and Costs pages' filters (§5.9).
    if (searchParams.get("pick") === "filters") return ApiResponse.success(await ListService.forFilters(session, input))
    return ApiResponse.success(await ListService.suggest(session, { ...input, q: searchParams.get("q") }))
})

/** "+ Add" (§5.2–5.3). */
export const POST = withStandardHandler(async (_req, session, json) => {
    return ApiResponse.success(await ListService.add(session, { kind: json?.kind, name: json?.name, companyId: json?.companyId }), 201)
}, { permission: "lists.add" })

/** Renaming, merging and archiving a name (§5.6). */
export const PUT = withStandardHandler(async (_req, session, json) => {
    if (typeof json?.archived === "boolean") return ApiResponse.success(await ListService.setArchived(session, { id: json.id, archived: json.archived }))
    if (json?.into !== undefined) return ApiResponse.success(await ListService.merge(session, { id: json.id, into: json.into }))
    return ApiResponse.success(await ListService.rename(session, { id: json?.id, name: json?.name }))
}, { permission: "lists.manage" })

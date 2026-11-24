import { withStandardHandler } from "@/lib/api-utils"
import { ApiResponse } from "@/lib/api-response"
import { nameSuggestionSchema } from "@/lib/validations/name-suggestion.schema"
import { spellingSourcesFor } from "@/lib/names/spellings"
import { suggestWithSpellings } from "@/lib/services/name-spelling.service"

/**
 * A name's other language, suggested, with the company's spellings first
 * (LATER_CHANGES_PLAN.md §3.1, step 3b, PR 401; DESIGN.md §5.3). Asked by
 * whoever may use a form that takes a name, which is anyone in the
 * company, as one's own profile takes one: employees' names and the
 * company's are anyone's to learn from, clients' names and their owners'
 * only for whoever may add or edit a client (spellingSourcesFor). The
 * Super Admin's are the company in view's. Only a suggestion: nothing is
 * saved.
 */
export const GET = withStandardHandler(async (req, session) => {
    const { searchParams } = new URL(req.url)
    const parsed = nameSuggestionSchema.safeParse({ name: searchParams.get("name"), to: searchParams.get("to"), kind: searchParams.get("kind") })
    if (!parsed.success) return ApiResponse.badRequest("Invalid name suggestion", parsed.error.flatten())
    const { name, to, kind } = parsed.data
    const companyId = session.user.role === "SUPER_ADMIN" ? searchParams.get("companyId") : (session.user as any).companyId ?? null
    return ApiResponse.success(await suggestWithSpellings(companyId, name, { to, kind }, spellingSourcesFor(session.user as any, kind)))
})

import { withStandardHandler } from "@/lib/api-utils"
import { ApiResponse } from "@/lib/api-response"
import { CompanyService } from "@/lib/services/company.service"

/**
 * A free username code for a company's name, which the Create and Edit
 * company dialogs fill in as the name is typed (lib/username.ts). The
 * company being edited is named, since its own code is free for it.
 */
export const GET = withStandardHandler(async (req, session) => {
    if (session.user.role !== 'SUPER_ADMIN') return ApiResponse.forbidden()

    const { searchParams } = new URL(req.url)
    // As long as a company's name can be.
    const name = (searchParams.get('name') ?? '').trim().slice(0, 50)
    const id = searchParams.get('id') || null

    return ApiResponse.success({ code: await CompanyService.suggestUsernameCode(name, id) })
})

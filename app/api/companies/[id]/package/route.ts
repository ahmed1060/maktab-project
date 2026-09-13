import { withStandardHandler } from "@/lib/api-utils"
import { ApiResponse } from "@/lib/api-response"
import { PackageService } from "@/lib/services/package.service"
import { z } from "zod"

// packageId null is meaningful — it returns the company to grandfathered,
// unrestricted access — so the field is nullable rather than optional. Omitting
// it is a malformed request, not a request to clear it.
const assignSchema = z.object({
    packageId: z.string().min(1).nullable(),
})

export const PUT = withStandardHandler(async (req, session, json, { params }) => {
    if (session.user.role !== 'SUPER_ADMIN') return ApiResponse.forbidden()

    const companyId = params.id

    const validation = assignSchema.safeParse(json)
    if (!validation.success) {
        return ApiResponse.badRequest("Validation Error", validation.error.format())
    }

    try {
        const result = await PackageService.assignToCompany(companyId, validation.data.packageId, session)
        return ApiResponse.success(result)
    } catch (error: any) {
        if (error.message === 'COMPANY_NOT_FOUND') return ApiResponse.notFound("Company not found")
        if (error.message === 'PACKAGE_NOT_FOUND') return ApiResponse.notFound("Package not found")
        if (error.message === 'PACKAGE_INACTIVE') {
            return ApiResponse.badRequest("That package has been retired and can no longer be assigned to new companies")
        }
        throw error
    }
})

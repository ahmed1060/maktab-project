import { withStandardHandler } from "@/lib/api-utils"
import { ApiResponse } from "@/lib/api-response"
import { createPackageSchema, updatePackageSchema } from "@/lib/validations/package.schema"
import { PackageService } from "@/lib/services/package.service"

// Packages are platform pricing, not company data, so every method here is
// Super Admin only — including the read. A company Admin has no business
// enumerating what else is for sale and at what price.
function denyNonSuperAdmin(session: any) {
    return session.user.role !== 'SUPER_ADMIN' ? ApiResponse.forbidden() : null
}

export const GET = withStandardHandler(async (req, session) => {
    const denied = denyNonSuperAdmin(session)
    if (denied) return denied

    const { searchParams } = new URL(req.url)
    const id = searchParams.get('id')

    if (id) {
        try {
            return ApiResponse.success(await PackageService.getById(id))
        } catch (error: any) {
            if (error.message === 'PACKAGE_NOT_FOUND') return ApiResponse.notFound("Package not found")
            throw error
        }
    }

    // The management screen needs retired packages too; the assignment dropdown
    // asks without this flag and gets only what is still sellable.
    const includeInactive = searchParams.get('includeInactive') === 'true'
    return ApiResponse.success(await PackageService.list({ includeInactive }))
})

export const POST = withStandardHandler(async (req, session, json) => {
    const denied = denyNonSuperAdmin(session)
    if (denied) return denied

    const validation = createPackageSchema.safeParse(json)
    if (!validation.success) {
        return ApiResponse.badRequest("Validation Error", validation.error.format())
    }

    try {
        return ApiResponse.success(await PackageService.create(validation.data, session), 201)
    } catch (error: any) {
        if (error.message === 'PACKAGE_NAME_TAKEN') return ApiResponse.badRequest("A package with this name already exists")
        if (error.code === 'P2002') return ApiResponse.badRequest("A package with this name already exists")
        throw error
    }
})

export const PUT = withStandardHandler(async (req, session, json) => {
    const denied = denyNonSuperAdmin(session)
    if (denied) return denied

    const validation = updatePackageSchema.safeParse(json)
    if (!validation.success) {
        return ApiResponse.badRequest("Validation Error", validation.error.format())
    }

    try {
        return ApiResponse.success(await PackageService.update(validation.data, session))
    } catch (error: any) {
        if (error.message === 'PACKAGE_NOT_FOUND') return ApiResponse.notFound("Package not found")
        if (error.message === 'PACKAGE_NAME_TAKEN') return ApiResponse.badRequest("A package with this name already exists")
        throw error
    }
})

export const DELETE = withStandardHandler(async (req, session) => {
    const denied = denyNonSuperAdmin(session)
    if (denied) return denied

    const { searchParams } = new URL(req.url)
    const id = searchParams.get('id')
    if (!id) return ApiResponse.badRequest("Package ID is required")

    try {
        return ApiResponse.success(await PackageService.remove(id, session))
    } catch (error: any) {
        if (error.message === 'PACKAGE_NOT_FOUND') return ApiResponse.notFound("Package not found")
        if (error.message === 'PACKAGE_IN_USE') {
            return ApiResponse.badRequest(
                "This package is assigned to one or more companies. Deactivate it instead — deleting it would return those companies to unrestricted access."
            )
        }
        // The ON DELETE RESTRICT foreign key, if the check above were ever
        // bypassed. The database is what actually guarantees this.
        if (error.code === 'P2003') return ApiResponse.badRequest("This package is still assigned to a company")
        throw error
    }
})

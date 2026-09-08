import { withStandardHandler } from "@/lib/api-utils"
import { prisma } from "@/lib/prisma"
import { ApiResponse } from "@/lib/api-response"
import { createVendorSchema, updateVendorSchema } from "@/lib/validations/vendor.schema"
import { VendorService } from "@/lib/services/vendor.service"

// Read access: ADMIN/TEAM_LEADER/SUPER_ADMIN — Team Leader is read-only
// (needs the list to pick a vendor when creating a task) but can't manage
// it; write access is checked per-method below.
export const GET = withStandardHandler(async (req, session) => {
    const userRole = session.user.role
    const userCompanyId = (session.user as any).companyId

    if (!['ADMIN', 'TEAM_LEADER', 'SUPER_ADMIN'].includes(userRole || '')) {
        return ApiResponse.forbidden()
    }

    const { searchParams } = new URL(req.url)
    const vendorId = searchParams.get('id')

    if (vendorId) {
        const vendor = await prisma.vendor.findUnique({ where: { id: vendorId } })
        if (!vendor) return ApiResponse.notFound("Vendor not found")
        if (userRole !== 'SUPER_ADMIN' && vendor.companyId !== userCompanyId) return ApiResponse.forbidden()
        return ApiResponse.success(vendor)
    }

    let companyId: string | undefined
    if (userRole === 'SUPER_ADMIN') {
        // No companyId means "all companies" — an aggregate view, not an
        // error. The frontend uses this when the Super Admin hasn't picked
        // one company via the switcher.
        companyId = searchParams.get('companyId') || undefined
    } else {
        if (!userCompanyId) return ApiResponse.success([])
        companyId = userCompanyId
    }

    const vendors = await prisma.vendor.findMany({
        where: companyId ? { companyId } : {},
        orderBy: { name: 'asc' },
        include: {
            // createdBy is null for a Super-Admin-created vendor (the FK
            // only targets User) — the frontend shows a generic "Super
            // Admin" label in that case rather than nothing.
            createdBy: { select: { firstName: true, lastName: true } },
            // Company name is only needed to label rows in the Super
            // Admin's aggregate ("all companies") view — a non-Super-Admin
            // request is always scoped to their own single company already.
            ...(userRole === 'SUPER_ADMIN' ? { company: { select: { name: true } } } : {})
        }
    })

    return ApiResponse.success(vendors)
})

export const POST = withStandardHandler(async (req, session, json) => {
    if (!['ADMIN', 'SUPER_ADMIN'].includes(session.user.role || '')) {
        return ApiResponse.forbidden()
    }

    const validation = createVendorSchema.safeParse(json)
    if (!validation.success) {
        return ApiResponse.badRequest("Validation Error", validation.error.format())
    }

    try {
        const result = await VendorService.create(validation.data, session)
        return ApiResponse.success(result, 201)
    } catch (error: any) {
        if (error.message === 'COMPANY_SELECTION_REQUIRED') return ApiResponse.badRequest("Company selection required for Super Admin")
        if (error.message === 'USER_NO_COMPANY') return ApiResponse.forbidden("User is not assigned to a company")
        // Unique constraint on (name, companyId)
        if (error.code === 'P2002') return ApiResponse.badRequest("A vendor with this name already exists")

        throw error
    }
})

export const PUT = withStandardHandler(async (req, session, json) => {
    if (!['ADMIN', 'SUPER_ADMIN'].includes(session.user.role || '')) {
        return ApiResponse.forbidden()
    }

    const validation = updateVendorSchema.safeParse(json)
    if (!validation.success) {
        return ApiResponse.badRequest("Validation Error", validation.error.format())
    }

    try {
        const result = await VendorService.update(validation.data, session)
        return ApiResponse.success(result)
    } catch (error: any) {
        if (error.message === 'VENDOR_NOT_FOUND') return ApiResponse.notFound("Vendor not found")
        if (error.message === 'FORBIDDEN') return ApiResponse.forbidden()
        if (error.code === 'P2002') return ApiResponse.badRequest("A vendor with this name already exists")

        throw error
    }
})

export const DELETE = withStandardHandler(async (req, session) => {
    if (!['ADMIN', 'SUPER_ADMIN'].includes(session.user.role || '')) {
        return ApiResponse.forbidden()
    }

    const { searchParams } = new URL(req.url)
    const id = searchParams.get('id')
    if (!id) return ApiResponse.badRequest("ID required")

    try {
        await VendorService.delete(id, session)
        return ApiResponse.success({ success: true, id })
    } catch (error: any) {
        if (error.message === 'VENDOR_NOT_FOUND') return ApiResponse.notFound("Vendor not found")
        if (error.message === 'FORBIDDEN') return ApiResponse.forbidden()

        throw error
    }
})

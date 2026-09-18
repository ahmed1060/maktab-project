import { withStandardHandler } from "@/lib/api-utils"
import { prisma } from "@/lib/prisma"
import { ApiResponse } from "@/lib/api-response"
import { createCompanySchema, updateCompanySchema } from "@/lib/validations/company.schema"
import { CompanyService } from "@/lib/services/company.service"

export const GET = withStandardHandler(async (req, session) => {
    if (session.user.role !== 'SUPER_ADMIN') return ApiResponse.forbidden()

    const { searchParams } = new URL(req.url)
    const id = searchParams.get('id')

    if (id) {
        const company = await prisma.company.findUnique({
            where: { id },
            select: {
                id: true, name: true, isBanned: true, autoVerifyLocation: true,
                moduleLabels: true, moduleIcons: true, logoUrl: true,
                payrollDay: true, payslipsVisible: true, timezone: true,
                packageId: true, trialPreset: true, trialExtensionDays: true, createdAt: true,
                package: { select: { id: true, name: true, hasCompanyManagement: true, hasHR: true } }
            }
        })
        if (!company) return ApiResponse.notFound("Company not found")
        return ApiResponse.success(company)
    }

    const page = parseInt(searchParams.get('page') || '1')
    const limit = parseInt(searchParams.get('limit') || '10')

    // Both narrowed to their known values rather than passed through: these
    // reach a sort comparator and a filter predicate, and an unexpected string
    // should fall back to the default view, not decide behaviour.
    const filter = searchParams.get('filter') === 'needs-attention' ? 'needs-attention' : 'all'
    const sort = searchParams.get('sort') === 'date' ? 'date' : 'name'

    return ApiResponse.success(
        await CompanyService.listWithSubscription({ page, limit, filter, sort })
    )
})

export const POST = withStandardHandler(async (req, session, json) => {
    if (session.user.role !== 'SUPER_ADMIN') return ApiResponse.forbidden()

    // 1. Validation
    const validation = createCompanySchema.safeParse(json)
    if (!validation.success) {
        return ApiResponse.badRequest("Validation Error", validation.error.format())
    }

    try {
        // 2. Service
        const result = await CompanyService.create(validation.data, session)
        return ApiResponse.success(result, 201)
    } catch (error: any) {
        if ((error as any).code === 'P2002') return ApiResponse.badRequest("Company already exists")
        throw error
    }
})

export const PUT = withStandardHandler(async (req, session, json) => {
    if (session.user.role !== 'SUPER_ADMIN') return ApiResponse.forbidden()

    // 1. Validation
    const validation = updateCompanySchema.safeParse(json)
    if (!validation.success) {
        return ApiResponse.badRequest("Validation Error", validation.error.format())
    }

    try {
        // A trial extension is a separate action with its own audit entry, not a
        // field on the company — it increments rather than sets, so replaying a
        // stale form must never silently reset somebody's extension.
        const { extendTrialDays, ...companyFields } = validation.data

        const result = await CompanyService.update(companyFields, session)

        if (extendTrialDays) {
            const trial = await CompanyService.extendTrial(companyFields.id, extendTrialDays, session)
            return ApiResponse.success({ ...result, trial })
        }

        return ApiResponse.success(result)
    } catch (error: any) {
        if (error.message === 'COMPANY_NOT_FOUND') return ApiResponse.notFound("Company not found")
        if (error.message === 'COMPANY_HAS_NO_TRIAL') return ApiResponse.badRequest("This company has no trial to extend")
        if (error.message === 'CANNOT_RENAME_SHSD') return ApiResponse.forbidden("Cannot rename the system company (SHSD)")
        if ((error as any).code === 'P2002') return ApiResponse.badRequest("Company name already exists")
        throw error
    }
})

export const DELETE = withStandardHandler(async (req, session) => {
    if (session.user.role !== 'SUPER_ADMIN') return ApiResponse.forbidden()

    const { searchParams } = new URL(req.url)
    const id = searchParams.get('id')
    const passcode = searchParams.get('passcode') || ''
    if (!id) return ApiResponse.badRequest("Company ID required")

    try {
        await CompanyService.delete(id, passcode, session)
        return ApiResponse.success({ success: true, id })
    } catch (error: any) {
        if (error.message === 'INVALID_PASSCODE') return ApiResponse.forbidden("Invalid verification passcode")
        if (error.message === 'COMPANY_NOT_FOUND') return ApiResponse.notFound("Company not found")
        if (error.message === 'CANNOT_DELETE_SHSD') return ApiResponse.forbidden("Cannot delete the system company (SHSD)")
        throw error
    }
})

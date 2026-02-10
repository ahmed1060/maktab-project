import { withStandardHandler } from "@/lib/api-utils"
import { prisma } from "@/lib/prisma"
import { ApiResponse } from "@/lib/api-response"
import { createUserSchema, updateUserSchema } from "@/lib/validations/user.schema"
import { UserService } from "@/lib/services/user.service"

export const GET = withStandardHandler(async (req, session) => {
    const userRole = session.user.role
    const { searchParams } = new URL(req.url)
    const userId = searchParams.get('id')

    // 1. Authorization & Single User Fetch
    if (userId) {
        if (userId !== session.user.id && !['ADMIN', 'SUPER_ADMIN', 'TEAM_LEADER'].includes(userRole || '')) {
            return ApiResponse.unauthorized()
        }

        const user = await prisma.user.findUnique({
            where: { id: userId },
            select: {
                id: true, firstName: true, lastName: true, email: true, status: true,
                role: true, gender: true, salary: true, companyId: true,
                totalDifficultyPoints: true, avatar: true, dayOffCredit: true,
                baseDayOffCredit: true, username: true
            }
        })

        if (user) {
            const canViewSalary = ['ADMIN', 'SUPER_ADMIN'].includes(userRole || '') || session.user.id === userId
            return ApiResponse.success({
                ...user,
                salary: canViewSalary ? user.salary : undefined
            })
        }

        const superAdmin = await prisma.superAdmin.findUnique({
            where: { id: userId },
            select: {
                id: true, firstName: true, lastName: true, email: true,
                gender: true, avatar: true, username: true
            }
        })

        if (superAdmin) {
            return ApiResponse.success({
                ...superAdmin,
                status: 'ACTIVE',
                role: 'SUPER_ADMIN',
                salary: 0,
                totalDifficultyPoints: 0
            })
        }
        return ApiResponse.notFound("User not found")
    }

    // 2. Multi-User Fetch (Filtered)
    if (!['ADMIN', 'SUPER_ADMIN', 'TEAM_LEADER'].includes(userRole || '')) {
        return ApiResponse.unauthorized()
    }

    const companyIdParam = searchParams.get('companyId')
    const companyNameParam = searchParams.get('company')
    let filterCompanyId: string | undefined = undefined

    if (companyIdParam) filterCompanyId = companyIdParam
    else if (companyNameParam) {
        const comp = await prisma.company.findUnique({ where: { name: companyNameParam } })
        if (comp) filterCompanyId = comp.id
    }

    const whereClause: any = { role: { not: 'SUPER_ADMIN' } }

    if (userRole === 'SUPER_ADMIN') {
        if (filterCompanyId) whereClause.companyId = filterCompanyId
    } else {
        const userCompanyId = (session.user as any).companyId
        if (!userCompanyId) return ApiResponse.success({ data: [], total: 0, page: 1, totalPages: 0 })
        whereClause.companyId = userCompanyId
    }

    // Special count for deleted users
    const countOnly = searchParams.get('countOnly')
    if (countOnly === 'deleted') {
        const deletedCount = await prisma.user.count({ where: { ...whereClause, status: 'DELETED' } })
        return ApiResponse.success({ total: deletedCount })
    }

    const includeDeleted = searchParams.get('includeDeleted') === 'true'
    const excludeRole = searchParams.get('excludeRole')
    const excludeUserId = searchParams.get('excludeUserId')

    if (excludeRole) {
        const rolesToExclude = excludeRole.split(',')
        whereClause.role = { ...(whereClause.role || {}), notIn: rolesToExclude }
    }

    if (userRole === 'TEAM_LEADER') {
        const currentExclude = whereClause.role?.notIn || (whereClause.role?.not ? [whereClause.role.not] : [])
        if (!currentExclude.includes('ADMIN')) {
            whereClause.role = { ...(whereClause.role || {}), notIn: [...currentExclude, 'ADMIN'] }
        }
    }

    if (excludeUserId) whereClause.id = { not: excludeUserId }

    const statusParam = searchParams.get('status')
    const searchParam = searchParams.get('search')

    if (searchParam) {
        whereClause.OR = [
            { firstName: { contains: searchParam, mode: 'insensitive' } },
            { lastName: { contains: searchParam, mode: 'insensitive' } },
            { email: { contains: searchParam, mode: 'insensitive' } },
            { company: { name: { contains: searchParam, mode: 'insensitive' } } }
        ]
    }

    if (statusParam) {
        whereClause.status = statusParam
    } else if (!includeDeleted) {
        whereClause.AND = whereClause.AND || []
        whereClause.AND.push({ status: { not: 'DELETED' } })
    }

    const page = parseInt(searchParams.get('page') || '1')
    const limit = parseInt(searchParams.get('limit') || '10')
    const skip = (page - 1) * limit

    const [users, total] = await Promise.all([
        prisma.user.findMany({
            where: whereClause,
            select: {
                id: true, firstName: true, lastName: true, email: true, status: true,
                lastActivity: true, role: true, gender: true, username: true,
                company: { select: { id: true, name: true } },
                totalDifficultyPoints: true
            },
            orderBy: [{ company: { name: 'asc' } }, { firstName: 'asc' }],
            skip,
            take: limit
        }),
        prisma.user.count({ where: whereClause })
    ])

    const usersWithStatus = users.map(user => {
        let effectiveStatus = user.status
        if (effectiveStatus === 'ACTIVE' && user.lastActivity) {
            const diffMs = new Date().getTime() - new Date(user.lastActivity).getTime()
            if (diffMs > 60000) effectiveStatus = 'OFFLINE'
        }
        return { ...user, status: effectiveStatus }
    })

    return ApiResponse.success({
        data: usersWithStatus, total, page, totalPages: Math.ceil(total / limit)
    })
})

export const POST = withStandardHandler(async (req, session, json) => {
    // 1. Validation
    const validation = createUserSchema.safeParse(json)
    if (!validation.success) {
        return ApiResponse.badRequest("Validation Error", validation.error.format())
    }

    try {
        // 2. Service
        const result = await UserService.create(validation.data, session)
        return ApiResponse.success(result, 201)
    } catch (error: any) {
        // 3. Error Mapping
        if (error.message === 'ONLY_SUPER_ADMIN_CAN_CREATE_ADMIN') return ApiResponse.forbidden("Only Super Admin can create Admin users")
        if (error.message === 'TARGET_COMPANY_NOT_FOUND') return ApiResponse.forbidden("Target company not found or access restricted")
        if (error.message === 'USER_ALREADY_EXISTS') return ApiResponse.badRequest("User already exists")
        if (error.message === 'USERNAME_IN_USE') return ApiResponse.badRequest("Username in use")

        throw error
    }
})

export const PUT = withStandardHandler(async (req, session, json) => {
    // 1. Validation
    const validation = updateUserSchema.safeParse(json)
    if (!validation.success) {
        return ApiResponse.badRequest("Validation Error", validation.error.format())
    }

    const { id } = validation.data
    const userRole = session.user.role

    // 2. Authorization check
    if (id !== session.user.id && !['ADMIN', 'SUPER_ADMIN'].includes(userRole || '')) {
        return ApiResponse.unauthorized()
    }

    try {
        // 3. Service
        const result = await UserService.update(validation.data, session)
        return ApiResponse.success(result)
    } catch (error: any) {
        // 4. Error Mapping
        if (error.message === 'USER_NOT_FOUND') return ApiResponse.notFound("User not found")
        if (error.message === 'NAME_CHANGE_REQUIRES_ADMIN') return ApiResponse.forbidden("Name changes require admin approval")
        if (error.message === 'FORBIDDEN_ROLE_ASSIGNMENT') return ApiResponse.forbidden("Forbidden role assignment")
        if (error.message === 'INVALID_PASSCODE') return ApiResponse.forbidden("Invalid verification passcode")

        throw error
    }
})

export const DELETE = withStandardHandler(async (req, session) => {
    const userRole = session.user.role
    if (!['ADMIN', 'SUPER_ADMIN'].includes(userRole || '')) return ApiResponse.unauthorized()

    const { searchParams } = new URL(req.url)
    const id = searchParams.get('id')
    const isPermanent = searchParams.get('permanent') === 'true'
    const passcode = searchParams.get('passcode') || ''

    if (!id) return ApiResponse.badRequest("User ID required")

    try {
        await UserService.delete(id, session, isPermanent, passcode)
        return ApiResponse.success({ id: id, permanent: isPermanent })
    } catch (error: any) {
        if (error.message === 'INVALID_PASSCODE') return ApiResponse.forbidden("Invalid verification passcode")
        if (error.message === 'INVALID_ID') return ApiResponse.badRequest("Invalid ID or cannot delete self")
        if (error.message === 'USER_NOT_FOUND') return ApiResponse.notFound("User not found")
        if (error.message === 'FORBIDDEN') return ApiResponse.forbidden("Insufficient permissions to delete this user")
        if (error.message === 'MUST_SOFT_DELETE_FIRST') return ApiResponse.badRequest("Must soft-delete the user first")

        throw error
    }
})

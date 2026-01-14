import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { supabase } from "@/lib/storage"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import bcrypt from "bcryptjs"

export async function GET(req: Request) {
    const session = await getServerSession(authOptions)
    const userRole = session?.user?.role

    if (!session || !session.user) {
        return new NextResponse("Unauthorized", { status: 401 })
    }

    // Check if requesting a single user by ID
    const { searchParams } = new URL(req.url)
    const userId = searchParams.get('id')

    // If listing users, enforce role check
    if (!userId && !['ADMIN', 'SUPER_ADMIN', 'TEAM_LEADER'].includes(userRole || '')) {
        return new NextResponse("Unauthorized", { status: 401 })
    }

    // If fetching single user, allow if self or admin
    if (userId && userId !== session.user.id && !['ADMIN', 'SUPER_ADMIN', 'TEAM_LEADER'].includes(userRole || '')) {
        return new NextResponse("Unauthorized", { status: 401 })
    }

    if (userId) {
        // 1. Try finding in regular User table
        const user = await prisma.user.findUnique({
            where: { id: userId },
            select: {
                id: true,
                firstName: true,
                lastName: true,
                email: true,
                status: true,
                role: true,
                gender: true,
                salary: true,
                companyId: true,
                totalDifficultyPoints: true,
                avatar: true,
                dayOffCredit: true
            }
        })

        if (user) {
            // Filter Salary
            const canViewSalary = ['ADMIN', 'SUPER_ADMIN'].includes(userRole || '') || session.user.id === userId

            return NextResponse.json({
                id: user.id,
                firstName: user.firstName,
                lastName: user.lastName,
                email: user.email,
                status: user.status,
                role: user.role,
                gender: user.gender,
                companyId: user.companyId,
                salary: canViewSalary ? user.salary : undefined,
                dayOffCredit: user.dayOffCredit,
                totalDifficultyPoints: user.totalDifficultyPoints,
                avatar: user.avatar
            })
        }

        // 2. If not found, try SuperAdmin table
        const superAdmin = await prisma.superAdmin.findUnique({
            where: { id: userId },
            select: {
                id: true,
                firstName: true,
                lastName: true,
                email: true,
                gender: true,
                avatar: true
            }
        })

        if (superAdmin) {
            return NextResponse.json({
                id: superAdmin.id,
                firstName: superAdmin.firstName,
                lastName: superAdmin.lastName,
                email: superAdmin.email,
                status: 'ACTIVE',
                role: 'SUPER_ADMIN', // Injected role
                gender: superAdmin.gender,
                avatar: superAdmin.avatar,
                salary: 0, // No salary for Super Admins
                totalDifficultyPoints: 0 // Super Admins don't play the points game
            })
        }

        return new NextResponse("User not found", { status: 404 })
    }

    const companyIdParam = searchParams.get('companyId')
    const companyNameParam = searchParams.get('company')
    let filterCompanyId: string | undefined = undefined

    if (companyIdParam) {
        filterCompanyId = companyIdParam
    } else if (companyNameParam) {
        const comp = await prisma.company.findUnique({ where: { name: companyNameParam } })
        if (comp) filterCompanyId = comp.id
    }

    // Fetch list of users
    const whereClause: any = {}

    if (userRole === 'SUPER_ADMIN') {
        if (filterCompanyId) {
            whereClause.companyId = filterCompanyId
        }
    } else {
        // Enforce strict isolation for ADMIN, TEAM_LEADER, EMPLOYEE
        const userCompanyId = (session.user as any).companyId
        if (!userCompanyId) {
            // User has no company, so they shouldn't see any users list
            return NextResponse.json([])
        }
        whereClause.companyId = userCompanyId

        // Also exclude SUPER_ADMINs from the list visible to regular companies
        whereClause.role = { not: 'SUPER_ADMIN' }
    }

    // Added: Support for efficient counting
    const countOnly = searchParams.get('countOnly')
    if (countOnly === 'deleted') {
        const deletedCount = await prisma.user.count({
            where: { ...whereClause, status: 'DELETED' }
        })
        return NextResponse.json({ total: deletedCount })
    }

    // Filter out DELETED users by default, unless requested
    const includeDeleted = searchParams.get('includeDeleted') === 'true'

    const excludeRole = searchParams.get('excludeRole')
    const excludeUserId = searchParams.get('excludeUserId')

    if (excludeRole) {
        whereClause.role = { not: excludeRole }
    }
    if (excludeUserId) {
        whereClause.id = { not: excludeUserId }
    }

    const statusParam = searchParams.get('status')

    if (statusParam) {
        whereClause.status = statusParam
    } else if (!includeDeleted) {
        whereClause.status = { not: 'DELETED' }
    }

    const page = parseInt(searchParams.get('page') || '1')
    const limit = parseInt(searchParams.get('limit') || '10')
    const skip = (page - 1) * limit

    const [users, total] = await Promise.all([
        prisma.user.findMany({
            where: whereClause,
            select: {
                id: true,
                firstName: true,
                lastName: true,
                email: true,
                status: true,
                lastActivity: true,
                role: true,
                gender: true,
                company: {
                    select: {
                        id: true,
                        name: true
                    }
                },
                totalDifficultyPoints: true,
                salary: false
            },
            // Updated Ordering: Sort by company name, then first name
            orderBy: [
                { company: { name: 'asc' } },
                { firstName: 'asc' }
            ],
            skip,
            take: limit
        }),
        prisma.user.count({ where: whereClause })
    ])

    // Map users with effective status
    const usersWithStatus = users.map(user => {
        // Determine effective status based on lastActivity
        let effectiveStatus = user.status
        if (effectiveStatus === 'ACTIVE') {
            const lastActivity = user.lastActivity
            if (lastActivity) {
                const diffMs = new Date().getTime() - new Date(lastActivity).getTime()
                const oneMinuteMs = 60 * 1000
                if (diffMs > oneMinuteMs) {
                    effectiveStatus = 'OFFLINE'
                }
            }
        }

        return {
            id: user.id,
            firstName: user.firstName,
            lastName: user.lastName,
            email: user.email,
            status: effectiveStatus,
            role: user.role,
            gender: user.gender,
            company: user.company,
            totalDifficultyPoints: user.totalDifficultyPoints
        }
    })

    return NextResponse.json({
        data: usersWithStatus,
        total,
        page,
        totalPages: Math.ceil(total / limit)
    })
}


export async function POST(req: Request) {
    const session = await getServerSession(authOptions)
    const userRole = session?.user?.role

    if (!session || !['ADMIN', 'SUPER_ADMIN'].includes(userRole || '')) {
        return new NextResponse("Unauthorized", { status: 401 })
    }

    const json = await req.json()
    const { firstName, lastName, email, password, role, gender, companyId, salary, dayOffCredit } = json

    // Validation
    if (firstName.length > 15) return new NextResponse("First name must be max 15 characters", { status: 400 })
    if (lastName.length > 15) return new NextResponse("Last name must be max 15 characters", { status: 400 })
    if (password.length > 20) return new NextResponse("Password must be max 20 characters", { status: 400 })

    const emailRegex = /^[^@]{1,20}@[^@]{1,10}\.com$/
    if (!emailRegex.test(email)) {
        return new NextResponse("Email format invalid (user<=20, domain<=10, .com only)", { status: 400 })
    }

    // Validate role
    const newUserRole = role || 'EMPLOYEE'

    // Only SUPER_ADMIN can create ADMIN or SUPER_ADMIN users
    if ((newUserRole === 'ADMIN' || newUserRole === 'SUPER_ADMIN') && userRole !== 'SUPER_ADMIN') {
        return new NextResponse("Only Super Admin can create Admin users", { status: 403 })
    }

    // Determine Company ID
    let targetCompanyId = (session.user as any).companyId

    if (userRole === 'SUPER_ADMIN') {
        if (companyId) {
            targetCompanyId = companyId
        }
    } else {
        // Enforce company inheritance for Admins/Team Leaders
        if (!targetCompanyId) {
            return new NextResponse("Error: Your account is not associated with any company. Cannot create user.", { status: 403 })
        }
    }

    // Check if user already exists
    const existingUser = await prisma.user.findUnique({ where: { email } })
    if (existingUser) {
        return new NextResponse("User already exists", { status: 400 })
    }

    const hashedPassword = await bcrypt.hash(password, 10)
    const user = await prisma.user.create({
        data: {
            firstName,
            lastName,
            email,
            password: hashedPassword,
            role: newUserRole,
            status: 'OFFLINE',
            gender: gender || 'MALE',
            companyId: targetCompanyId,
            salary: salary ? parseFloat(salary) : 0,
            dayOffCredit: dayOffCredit ? parseFloat(dayOffCredit) : 0
        },
        select: { id: true, firstName: true, lastName: true, email: true, role: true, status: true, gender: true }
    })

    return NextResponse.json(user)
}

export async function PUT(req: Request) {
    const session = await getServerSession(authOptions)
    const userRole = session?.user?.role

    if (!session || !session.user) {
        return new NextResponse("Unauthorized", { status: 401 })
    }

    const json = await req.json()
    const { id, firstName, lastName, email, password, role, gender, salary, companyId, avatar, dayOffCredit } = json

    if (!id) {
        return new NextResponse("User ID required", { status: 400 })
    }

    // Allow if self or admin/super_admin
    // Note: Super Admins can edit anyone? Or just themselves and Admins?
    // "Only proper changes" -> standard ACL.
    if (id !== session.user.id && !['ADMIN', 'SUPER_ADMIN'].includes(userRole || '')) {
        return new NextResponse("Unauthorized", { status: 401 })
    }

    // 1. Determine User Type & Existence
    const regularUser = await prisma.user.findUnique({ where: { id } })
    const superAdminUser = !regularUser ? await prisma.superAdmin.findUnique({ where: { id } }) : null

    if (!regularUser && !superAdminUser) {
        return new NextResponse("User not found", { status: 404 })
    }

    // 2. Email Uniqueness Check (Global)
    if (email) {
        // Check User Table
        const conflictUser = await prisma.user.findFirst({
            where: {
                email,
                NOT: { id }
            }
        })
        if (conflictUser) return new NextResponse("Email already in use", { status: 400 })

        // Check SuperAdmin Table
        const conflictAdmin = await prisma.superAdmin.findFirst({
            where: {
                email,
                NOT: { id }
            }
        })
        if (conflictAdmin) return new NextResponse("Email already in use", { status: 400 })
    }

    // Build update data
    const updateData: any = {}

    const isSelf = id === session.user.id

    if (isSelf && (regularUser?.role === 'EMPLOYEE' || regularUser?.role === 'TEAM_LEADER')) {
        if ((firstName && firstName !== regularUser.firstName) || (lastName && lastName !== regularUser.lastName)) {
            return new NextResponse("Name changes require admin approval. Please submit a request from your profile.", { status: 403 })
        }
    }

    if (firstName) {
        if (firstName.length > 15) return new NextResponse("First name max 15 chars", { status: 400 })
        updateData.firstName = firstName
    }
    if (lastName) {
        if (lastName.length > 15) return new NextResponse("Last name max 15 chars", { status: 400 })
        updateData.lastName = lastName
    }
    if (email) {
        const emailRegex = /^[^@]{1,20}@[^@]{1,10}\.com$/
        if (!emailRegex.test(email)) {
            return new NextResponse("Email format invalid", { status: 400 })
        }
        updateData.email = email
    }
    if (password) {
        if (password.length > 20) return new NextResponse("Password max 20 chars", { status: 400 })
        updateData.password = await bcrypt.hash(password, 10)
    }
    if (gender) updateData.gender = gender
    if (avatar !== undefined) {
        updateData.avatar = avatar
        // Cleanup old avatar if it's being replaced
        const existingAvatar = regularUser?.avatar || superAdminUser?.avatar
        if (existingAvatar && existingAvatar !== avatar) {
            try {
                const urlParts = existingAvatar.split('/app-assets/')
                if (urlParts.length > 1) {
                    const filePath = urlParts[1]
                    await supabase.storage.from('app-assets').remove([filePath])
                }
            } catch (err) {
                console.error('Failed to cleanup old avatar:', err)
            }
        }
    }

    // --- CASE A: Regular User Update ---
    if (regularUser) {
        if (role) {
            // Role validation
            if (!['ADMIN', 'SUPER_ADMIN'].includes(userRole || '')) {
                // Ignore
            } else {
                if ((role === 'ADMIN' || role === 'SUPER_ADMIN') && userRole !== 'SUPER_ADMIN') {
                    return new NextResponse("Only Super Admin can assign Admin/SuperAdmin roles", { status: 403 })
                }
                updateData.role = role
            }
        }

        if (['ADMIN', 'SUPER_ADMIN'].includes(userRole || '')) {
            if (salary > 1000000000) return new NextResponse("Salary cannot exceed 1 billion", { status: 400 })
            updateData.salary = salary
            if (dayOffCredit !== undefined) updateData.dayOffCredit = parseFloat(dayOffCredit)
        }


        // Allow Super Admin to update Company
        if (companyId !== undefined && userRole === 'SUPER_ADMIN') {
            updateData.companyId = companyId || null
            console.log(`[API] Updating user ${id} company to: ${updateData.companyId}`)
        }

        const updatedUser = await prisma.user.update({
            where: { id },
            data: updateData,
            select: { id: true, firstName: true, lastName: true, email: true, role: true, gender: true, salary: true, companyId: true, avatar: true, dayOffCredit: true }
        })

        // Sync Salary Record
        if (updateData.salary !== undefined) {
            const now = new Date()
            const currentMonth = now.getMonth() + 1
            const currentYear = now.getFullYear()

            const existingRecord = await prisma.salaryRecord.findUnique({
                where: { userId_month_year: { userId: id, month: currentMonth, year: currentYear } }
            })

            if (existingRecord) {
                await prisma.salaryRecord.update({
                    where: { id: existingRecord.id },
                    data: { baseSalary: updateData.salary }
                })
            } else {
                const daysInMonth = new Date(currentYear, currentMonth, 0).getDate()
                await prisma.salaryRecord.create({
                    data: {
                        userId: id,
                        month: currentMonth,
                        year: currentYear,
                        totalDays: daysInMonth,
                        baseSalary: updateData.salary
                    }
                })
            }
        }
        return NextResponse.json(updatedUser)
    }

    // --- CASE B: SuperAdmin Update ---
    if (superAdminUser) {
        // Super Admins: No Role Update (Fixed), No Salary Update (Not in DB)
        // Allow updates to basic info (already in updateData)

        const updatedAdmin = await prisma.superAdmin.update({
            where: { id },
            data: updateData,
            select: { id: true, firstName: true, lastName: true, email: true, gender: true, avatar: true }
        })

        return NextResponse.json({
            ...updatedAdmin,
            role: 'SUPER_ADMIN',
            status: 'ACTIVE',
            salary: 0
        })
    }

    return new NextResponse("Unexpected error", { status: 500 })
}

export async function DELETE(req: Request) {
    const session = await getServerSession(authOptions)
    const userRole = session?.user?.role

    if (!session || !session.user || !['ADMIN', 'SUPER_ADMIN'].includes(userRole || '')) {
        return new NextResponse("Unauthorized", { status: 401 })
    }

    const { searchParams } = new URL(req.url)
    const userId = searchParams.get('id')
    const isPermanent = searchParams.get('permanent') === 'true'

    if (!userId) {
        return new NextResponse("User ID required", { status: 400 })
    }

    // Prevent deleting yourself
    if (userId === session.user.id) {
        return new NextResponse("Cannot delete yourself", { status: 400 })
    }

    // Get the user to be deleted
    const userToDelete = await prisma.user.findUnique({ where: { id: userId } })

    if (!userToDelete) {
        return new NextResponse("User not found", { status: 404 })
    }

    // Only SUPER_ADMIN can delete ADMIN users
    if (userToDelete.role === 'ADMIN' && userRole !== 'SUPER_ADMIN') {
        return new NextResponse("Only Super Admin can delete Admin users", { status: 403 })
    }

    // Cannot delete SUPER_ADMIN
    if (userToDelete.role === 'SUPER_ADMIN') {
        return new NextResponse("Cannot delete Super Admin", { status: 403 })
    }

    try {
        if (isPermanent) {
            if (userToDelete.status !== 'DELETED') {
                return new NextResponse("User must be soft-deleted first before permanent removal", { status: 400 })
            }

            // Hard Delete
            await prisma.user.delete({
                where: { id: userId }
            })
            return NextResponse.json({ success: true, message: 'User permanently removed' })
        }

        // Soft Delete: Mark as DELETED and scramble email to release unique constraint
        const timestamp = new Date().getTime()
        const deletedEmail = `${userToDelete.email}_DELETED_${timestamp}`

        await prisma.user.update({
            where: { id: userId },
            data: {
                status: 'DELETED',
                email: deletedEmail
            }
        })

        return NextResponse.json({ success: true })
    } catch (error: any) {
        console.error('Delete error:', error)
        if (error.code === 'P2003') {
            return new NextResponse("Cannot permanently delete user because they have linked records (Tasks, Salary History, etc.). Please keep them soft-deleted.", { status: 400 })
        }
        return new NextResponse("Failed to delete user", { status: 500 })
    }
}

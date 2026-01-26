import { withStandardHandler } from "@/lib/api-utils"
import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { supabase } from "@/lib/storage"
import bcrypt from "bcryptjs"
import { encrypt } from "@/lib/crypto"
import { generateUsername } from "@/lib/username"

export const GET = withStandardHandler(async (req, session) => {
    const userRole = session.user.role
    const { searchParams } = new URL(req.url)
    const userId = searchParams.get('id')

    if (!userId && !['ADMIN', 'SUPER_ADMIN', 'TEAM_LEADER'].includes(userRole || '')) {
        return new NextResponse("Unauthorized", { status: 401 })
    }

    if (userId && userId !== session.user.id && !['ADMIN', 'SUPER_ADMIN', 'TEAM_LEADER'].includes(userRole || '')) {
        return new NextResponse("Unauthorized", { status: 401 })
    }

    if (userId) {
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
            return NextResponse.json({
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
            return NextResponse.json({
                ...superAdmin,
                status: 'ACTIVE',
                role: 'SUPER_ADMIN',
                salary: 0,
                totalDifficultyPoints: 0
            })
        }
        return new NextResponse("User not found", { status: 404 })
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
        if (!userCompanyId) return NextResponse.json([])
        whereClause.companyId = userCompanyId
    }

    const countOnly = searchParams.get('countOnly')
    if (countOnly === 'deleted') {
        const deletedCount = await prisma.user.count({ where: { ...whereClause, status: 'DELETED' } })
        return NextResponse.json({ total: deletedCount })
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

    if (statusParam) whereClause.status = statusParam
    else if (!includeDeleted) {
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

    return NextResponse.json({
        data: usersWithStatus, total, page, totalPages: Math.ceil(total / limit)
    })
})

export const POST = withStandardHandler(async (req, session, json) => {
    const userRole = session.user.role
    if (!['ADMIN', 'SUPER_ADMIN'].includes(userRole || '')) {
        return new NextResponse("Unauthorized", { status: 401 })
    }

    const { firstName, lastName, email, password, role, gender, companyId, salary, dayOffCredit, baseDayOffCredit, username } = json

    if (firstName.length > 15 || lastName.length > 15 || password.length > 20) {
        return new NextResponse("Field limits exceeded", { status: 400 })
    }

    const emailRegex = /^[^@]{1,20}@[^@]{1,10}\.com$/
    if (!emailRegex.test(email)) return new NextResponse("Email format invalid", { status: 400 })

    const newUserRole = role || 'EMPLOYEE'
    if ((newUserRole === 'ADMIN' || newUserRole === 'SUPER_ADMIN') && userRole !== 'SUPER_ADMIN') {
        return new NextResponse("Only Super Admin can create Admin users", { status: 403 })
    }

    let targetCompanyId = (session.user as any).companyId
    if (userRole === 'SUPER_ADMIN' && companyId) targetCompanyId = companyId

    if (!targetCompanyId && userRole !== 'SUPER_ADMIN') return new NextResponse("Target company not found", { status: 403 })

    const existingUser = await prisma.user.findUnique({ where: { email } })
    if (existingUser) return new NextResponse("User already exists", { status: 400 })

    const hashedPassword = await bcrypt.hash(password, 10)

    let finalUsername = username
    if (finalUsername) {
        const conflict = await prisma.user.findFirst({ where: { username: { equals: finalUsername, mode: 'insensitive' } } })
        if (conflict) return new NextResponse("Username in use", { status: 400 })
    } else if (targetCompanyId) {
        finalUsername = await generateUsername(targetCompanyId)
    }

    const user = await prisma.user.create({
        data: {
            firstName, lastName, email, username: finalUsername, password: hashedPassword,
            role: newUserRole, status: 'OFFLINE', gender: gender || 'MALE', companyId: targetCompanyId,
            salary: salary ? parseFloat(salary) : 0,
            dayOffCredit: baseDayOffCredit ? parseFloat(baseDayOffCredit) : (dayOffCredit ? parseFloat(dayOffCredit) : 0),
            baseDayOffCredit: baseDayOffCredit ? parseFloat(baseDayOffCredit) : (dayOffCredit ? parseFloat(dayOffCredit) : 0),
            plainPasswordEnc: encrypt(password)
        },
        select: { id: true, firstName: true, lastName: true, email: true, role: true, status: true, gender: true, username: true }
    })

    return NextResponse.json(user)
}, {
    audit: { action: 'CREATE_USER', entityType: 'USER', getEntityId: (res) => res.id }
})

export const PUT = withStandardHandler(async (req, session, json) => {
    const userRole = session.user.role
    const { id, firstName, lastName, email, password, role, gender, salary, companyId, avatar, dayOffCredit, baseDayOffCredit, username } = json

    if (!id) return new NextResponse("User ID required", { status: 400 })

    if (id !== session.user.id && !['ADMIN', 'SUPER_ADMIN'].includes(userRole || '')) {
        return new NextResponse("Unauthorized", { status: 401 })
    }

    const regularUser = await prisma.user.findUnique({ where: { id } })
    const superAdminUser = !regularUser ? await prisma.superAdmin.findUnique({ where: { id } }) : null

    if (!regularUser && !superAdminUser) return new NextResponse("User not found", { status: 404 })

    const updateData: any = {}
    const isSelf = id === session.user.id

    if (isSelf && (regularUser?.role === 'EMPLOYEE' || regularUser?.role === 'TEAM_LEADER')) {
        if ((firstName && firstName !== regularUser.firstName) || (lastName && lastName !== regularUser.lastName)) {
            return new NextResponse("Name changes require admin approval", { status: 403 })
        }
    }

    if (firstName) updateData.firstName = firstName
    if (lastName) updateData.lastName = lastName
    if (email) updateData.email = email
    if (password) {
        updateData.password = await bcrypt.hash(password, 10)
        updateData.plainPasswordEnc = encrypt(password)
    }
    if (gender) updateData.gender = gender
    if (avatar !== undefined) {
        updateData.avatar = avatar
        const oldAvatar = regularUser?.avatar || superAdminUser?.avatar
        if (oldAvatar && oldAvatar !== avatar) {
            try {
                const parts = oldAvatar.split('/app-assets/')
                if (parts.length > 1) await supabase.storage.from('app-assets').remove([parts[1]])
            } catch { }
        }
    }

    if (regularUser) {
        if (role && ['ADMIN', 'SUPER_ADMIN'].includes(userRole || '')) {
            if ((role === 'ADMIN' || role === 'SUPER_ADMIN') && userRole !== 'SUPER_ADMIN') {
                return new NextResponse("Forbidden role assignment", { status: 403 })
            }
            updateData.role = role
        }

        if (username !== undefined && userRole === 'SUPER_ADMIN') updateData.username = username || null

        if (['ADMIN', 'SUPER_ADMIN'].includes(userRole || '')) {
            if (salary !== undefined) updateData.salary = salary
            if (dayOffCredit !== undefined) updateData.dayOffCredit = parseFloat(dayOffCredit)
            if (baseDayOffCredit !== undefined) {
                const newBase = parseFloat(baseDayOffCredit)
                updateData.baseDayOffCredit = newBase
                const currentYear = new Date().getFullYear()
                const deductions = await prisma.dayOffRequest.aggregate({
                    where: { userId: id, status: 'APPROVED', deductionType: 'CREDIT', date: { gte: new Date(currentYear, 0, 1), lt: new Date(currentYear + 1, 0, 1) } },
                    _sum: { daysDeducted: true }
                })
                updateData.dayOffCredit = newBase - (deductions._sum.daysDeducted || 0)
            }
        }

        if (companyId !== undefined && userRole === 'SUPER_ADMIN') updateData.companyId = companyId || null

        const updated = await prisma.user.update({
            where: { id }, data: updateData,
            select: { id: true, firstName: true, lastName: true, email: true, role: true, gender: true, salary: true, companyId: true, avatar: true, dayOffCredit: true, baseDayOffCredit: true, username: true }
        })

        if (updateData.salary !== undefined) {
            const now = new Date()
            const m = now.getMonth() + 1, y = now.getFullYear()
            const existing = await prisma.salaryRecord.findUnique({ where: { userId_month_year: { userId: id, month: m, year: y } } })
            if (existing) await prisma.salaryRecord.update({ where: { id: existing.id }, data: { baseSalary: updateData.salary } })
            else await prisma.salaryRecord.create({ data: { userId: id, month: m, year: y, totalDays: new Date(y, m, 0).getDate(), baseSalary: updateData.salary } })
        }
        return NextResponse.json(updated)
    }

    if (superAdminUser) {
        const updated = await prisma.superAdmin.update({ where: { id }, data: updateData, select: { id: true, firstName: true, lastName: true, email: true, gender: true, avatar: true, username: true } })
        return NextResponse.json({ ...updated, role: 'SUPER_ADMIN', status: 'ACTIVE', salary: 0 })
    }

    return new NextResponse("Error", { status: 500 })
}, {
    audit: { action: 'UPDATE_USER', entityType: 'USER', getEntityId: (res) => res.id }
})

export const DELETE = withStandardHandler(async (req, session) => {
    const userRole = session.user.role
    if (!['ADMIN', 'SUPER_ADMIN'].includes(userRole || '')) return new NextResponse("Unauthorized", { status: 401 })

    const { searchParams } = new URL(req.url)
    const userId = searchParams.get('id')
    const isPermanent = searchParams.get('permanent') === 'true'

    if (!userId || userId === session.user.id) return new NextResponse("Invalid ID", { status: 400 })

    const user = await prisma.user.findUnique({ where: { id: userId } })
    if (!user) return new NextResponse("Not found", { status: 404 })

    if (user.role === 'ADMIN' && userRole !== 'SUPER_ADMIN') return new NextResponse("Forbidden", { status: 403 })
    if (user.role === 'SUPER_ADMIN') return new NextResponse("Forbidden", { status: 403 })

    if (isPermanent) {
        if (user.status !== 'DELETED') return new NextResponse("Must soft-delete first", { status: 400 })
        await prisma.user.delete({ where: { id: userId } })
        return NextResponse.json({ success: true, id: userId })
    }

    await prisma.user.update({
        where: { id: userId },
        data: { status: 'DELETED', email: `${user.email}_DELETED_${Date.now()}` }
    })
    return NextResponse.json({ success: true, id: userId })
}, {
    audit: { action: 'DELETE_USER', entityType: 'USER', getEntityId: (res) => res.id }
})

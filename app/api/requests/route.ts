import { withStandardHandler } from "@/lib/api-utils"
import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"

export const GET = withStandardHandler(async (req, session) => {
    const { searchParams } = new URL(req.url)
    const status = searchParams.get('status')
    const companyIdParam = searchParams.get('companyId')
    const search = searchParams.get('search')
    const filterUserId = searchParams.get('userId')
    const sortBy = searchParams.get('sortBy') || 'createdAt'
    const order = searchParams.get('order') || 'desc'

    const userRole = (session.user as any).role
    const userId = (session.user as any).id
    const userCompanyId = (session.user as any).companyId

    const where: any = {}

    if (userRole === 'SUPER_ADMIN') {
        if (companyIdParam) {
            where.companyId = companyIdParam
        }
    } else if (['ADMIN', 'TEAM_LEADER'].includes(userRole)) {
        where.companyId = userCompanyId
    } else {
        where.userId = userId
    }

    if (status) {
        where.status = status
    } else {
        const isHistory = searchParams.get('history') === 'true'
        if (isHistory) {
            where.status = 'COMPLETED'
        } else {
            where.status = { in: ['PENDING', 'IN_PROGRESS'] }
        }
    }

    if (search) {
        where.title = { contains: search, mode: 'insensitive' }
    }

    if (filterUserId && (userRole === 'SUPER_ADMIN' || userRole === 'ADMIN' || userRole === 'TEAM_LEADER')) {
        where.userId = filterUserId
    }

    const page = parseInt(searchParams.get('page') || '1')
    const limit = parseInt(searchParams.get('limit') || '10')
    const skip = (page - 1) * limit

    const [requests, total] = await Promise.all([
        prisma.request.findMany({
            where,
            include: {
                user: {
                    select: {
                        id: true, firstName: true, lastName: true, email: true, avatar: true, role: true
                    }
                }
            },
            orderBy: { [sortBy]: order },
            skip,
            take: limit
        }),
        prisma.request.count({ where })
    ])

    return NextResponse.json({
        data: requests,
        total,
        page,
        totalPages: Math.ceil(total / limit)
    })
})

export const POST = withStandardHandler(async (req, session, json) => {
    const { title, details } = json

    if (!title || !details) {
        return new NextResponse("Title and details are required", { status: 400 })
    }

    const userId = (session.user as any).id
    const userRole = (session.user as any).role
    let companyId = (session.user as any).companyId

    if (userRole === 'SUPER_ADMIN' && json.companyId) {
        companyId = json.companyId
    }

    const request = await prisma.request.create({
        data: {
            title,
            details,
            userId,
            companyId,
            status: 'PENDING'
        }
    })

    if (companyId) {
        const admins = await prisma.user.findMany({
            where: {
                companyId,
                role: { in: ['ADMIN', 'TEAM_LEADER'] }
            },
            select: { id: true }
        })

        if (admins.length > 0) {
            await prisma.notification.createMany({
                data: admins.map(admin => ({
                    userId: admin.id,
                    type: 'NEW_REQUEST',
                    message: `New request from ${(session.user as any).firstName}: ${title}`,
                    relatedId: request.id
                }))
            })
        }
    }

    return NextResponse.json(request)
}, {
    audit: {
        action: 'CREATE_REQUEST',
        entityType: 'REQUEST',
        getEntityId: (res) => res.id
    }
})

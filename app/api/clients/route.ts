import { withStandardHandler } from "@/lib/api-utils"
import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"

export const GET = withStandardHandler(async (req, session) => {
    const { searchParams } = new URL(req.url)
    const companyId = searchParams.get('companyId')
    const clientId = searchParams.get('id')
    const userRole = session.user.role
    const userCompanyId = (session.user as any).companyId

    if (clientId) {
        const client = await prisma.businessClient.findUnique({
            where: { id: clientId },
            include: {
                createdBy: { select: { firstName: true, lastName: true, role: true } },
                lastEditedBy: { select: { firstName: true, lastName: true, role: true } },
                _count: { select: { sections: true } }
            }
        })

        if (!client) return new NextResponse("Client not found", { status: 404 })
        if (userRole !== 'SUPER_ADMIN' && client.companyId !== userCompanyId) return new NextResponse("Forbidden", { status: 403 })

        return NextResponse.json(client)
    }

    if (!userCompanyId && userRole !== 'SUPER_ADMIN') return NextResponse.json([])

    const where: any = {}
    if (userRole === 'SUPER_ADMIN') {
        if (companyId) where.companyId = companyId
    } else {
        where.companyId = userCompanyId
    }

    const page = parseInt(searchParams.get('page') || '1')
    const limit = parseInt(searchParams.get('limit') || '10')
    const skip = (page - 1) * limit

    const [clients, total] = await Promise.all([
        prisma.businessClient.findMany({
            where,
            orderBy: { createdAt: 'desc' },
            include: {
                createdBy: { select: { firstName: true, lastName: true, role: true } },
                lastEditedBy: { select: { firstName: true, lastName: true, role: true } },
                _count: { select: { sections: true } }
            },
            skip,
            take: limit
        }),
        prisma.businessClient.count({ where })
    ])

    return NextResponse.json({
        data: clients,
        total,
        page,
        totalPages: Math.ceil(total / limit)
    })
})

export const POST = withStandardHandler(async (req, session, json) => {
    const userRole = session.user.role
    const userId = session.user.id
    const userCompanyId = (session.user as any).companyId

    const { name, companyId } = json
    if (!name) return new NextResponse("Name is required", { status: 400 })

    let targetCompanyId = userCompanyId
    if (userRole === 'SUPER_ADMIN') {
        if (companyId) targetCompanyId = companyId
        else if (!targetCompanyId) return new NextResponse("Company selection required", { status: 400 })
    } else {
        if (!targetCompanyId) return new NextResponse("User not assigned to a company", { status: 404 })
    }

    const client = await prisma.businessClient.create({
        data: {
            name,
            companyId: targetCompanyId!,
            createdById: userRole === 'SUPER_ADMIN' ? null : userId
        }
    })

    return NextResponse.json(client)
}, {
    audit: { action: 'CREATE_CLIENT', entityType: 'CLIENT', getEntityId: (res) => res.id }
})

export const PUT = withStandardHandler(async (req, session, json) => {
    const userRole = session.user.role
    const userId = session.user.id
    const userCompanyId = (session.user as any).companyId

    if (!['ADMIN', 'SUPER_ADMIN', 'TEAM_LEADER'].includes(userRole || '')) {
        return new NextResponse("Unauthorized", { status: 401 })
    }

    const { id, name } = json
    if (!id || !name) return new NextResponse("ID and Name are required", { status: 400 })

    const client = await prisma.businessClient.findUnique({ where: { id } })
    if (!client) return new NextResponse("Client not found", { status: 404 })

    if (userRole !== 'SUPER_ADMIN' && client.companyId !== userCompanyId) return new NextResponse("Forbidden", { status: 403 })

    const updated = await prisma.businessClient.update({
        where: { id },
        data: {
            name,
            lastEditedById: userRole === 'SUPER_ADMIN' ? null : userId
        }
    })

    return NextResponse.json(updated)
}, {
    audit: { action: 'UPDATE_CLIENT', entityType: 'CLIENT', getEntityId: (res) => res.id }
})

export const DELETE = withStandardHandler(async (req, session) => {
    const userRole = session.user.role
    const userCompanyId = (session.user as any).companyId

    if (!['ADMIN', 'SUPER_ADMIN'].includes(userRole || '')) return new NextResponse("Unauthorized", { status: 401 })

    const { searchParams } = new URL(req.url)
    const id = searchParams.get('id')
    if (!id) return new NextResponse("ID required", { status: 400 })

    const client = await prisma.businessClient.findUnique({ where: { id } })
    if (!client) return new NextResponse("Client not found", { status: 404 })

    if (userRole !== 'SUPER_ADMIN' && client.companyId !== userCompanyId) return new NextResponse("Forbidden", { status: 403 })

    await prisma.businessClient.delete({ where: { id } })
    return NextResponse.json({ success: true, id })
}, {
    audit: { action: 'DELETE_CLIENT', entityType: 'CLIENT', getEntityId: (res) => res.id }
})

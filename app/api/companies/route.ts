import { withStandardHandler } from "@/lib/api-utils"
import { prisma } from "@/lib/prisma"
import { NextResponse } from "next/server"

export const GET = withStandardHandler(async (req, session) => {
    if (session.user.role !== 'SUPER_ADMIN') {
        return new NextResponse("Unauthorized", { status: 401 })
    }

    const { searchParams } = new URL(req.url)
    const id = searchParams.get('id')

    if (id) {
        const company = await prisma.company.findUnique({
            where: { id },
            select: { id: true, name: true, isBanned: true }
        })
        if (!company) {
            return NextResponse.json({ error: "Not found" }, { status: 404 })
        }
        return NextResponse.json(company)
    }

    const page = parseInt(searchParams.get('page') || '1')
    const limit = parseInt(searchParams.get('limit') || '10')
    const skip = (page - 1) * limit

    const companies = await prisma.company.findMany({
        select: { id: true, name: true, isBanned: true },
        orderBy: { name: 'asc' },
        skip,
        take: limit
    })
    const total = await prisma.company.count()

    return NextResponse.json({
        data: companies,
        total,
        page,
        totalPages: Math.ceil(total / limit)
    })
})

export const POST = withStandardHandler(async (req, session, json) => {
    if (session.user.role !== 'SUPER_ADMIN') {
        return new NextResponse("Unauthorized", { status: 401 })
    }

    const { name } = json
    if (!name) {
        return NextResponse.json({ error: "Name is required" }, { status: 400 })
    }

    try {
        const company = await prisma.company.create({
            data: { name }
        })
        return NextResponse.json(company)
    } catch (error) {
        if ((error as any).code === 'P2002') {
            return NextResponse.json({ error: "Company already exists" }, { status: 400 })
        }
        throw error // withStandardHandler handles 500
    }
}, {
    audit: { action: 'CREATE_COMPANY', entityType: 'COMPANY', getEntityId: (res) => res.id }
})

export const PUT = withStandardHandler(async (req, session, json) => {
    if (session.user.role !== 'SUPER_ADMIN') {
        return new NextResponse("Unauthorized", { status: 401 })
    }

    const { id, name, isBanned } = json
    if (!id) {
        return NextResponse.json({ error: "ID is required" }, { status: 400 })
    }

    try {
        // Handle specific Ban/Unban action if isBanned is provided
        if (isBanned !== undefined) {
            await prisma.company.update({
                where: { id },
                data: { isBanned }
            })
            // If name is also provided, update it too
            if (name) {
                const existing = await prisma.company.findUnique({ where: { id } })
                if (existing?.name === 'SHSD' && name !== 'SHSD') {
                    return NextResponse.json({ error: "Cannot rename SHSD" }, { status: 403 })
                }
                await prisma.company.update({
                    where: { id },
                    data: { name }
                })
            }
            return NextResponse.json({ success: true })
        }

        // Standard Rename (fallback)
        if (!name) return NextResponse.json({ error: "Name required" }, { status: 400 })

        const existing = await prisma.company.findUnique({ where: { id } })
        if (existing?.name === 'SHSD' && name !== 'SHSD') {
            return NextResponse.json({ error: "Cannot rename the default system company (SHSD)" }, { status: 403 })
        }

        const company = await prisma.company.update({
            where: { id },
            data: { name }
        })

        return NextResponse.json(company)
    } catch (error) {
        if ((error as any).code === 'P2002') {
            return NextResponse.json({ error: "Company name already exists" }, { status: 400 })
        }
        throw error
    }
}, {
    audit: { action: 'UPDATE_COMPANY', entityType: 'COMPANY', getEntityId: (res, body) => body.id }
})

export const DELETE = withStandardHandler(async (req, session) => {
    if (session.user.role !== 'SUPER_ADMIN') {
        return new NextResponse("Unauthorized", { status: 401 })
    }

    const { searchParams } = new URL(req.url)
    const id = searchParams.get('id')

    if (!id) {
        return NextResponse.json({ error: "Company ID is required" }, { status: 400 })
    }

    // 1. Get Company & Verify
    const company = await prisma.company.findUnique({
        where: { id },
        include: { users: { select: { id: true } } }
    })

    if (!company) {
        return NextResponse.json({ error: "Company not found" }, { status: 404 })
    }

    // 2. Prevent Deleting SHSD
    if (company.name === 'SHSD') {
        return NextResponse.json({ error: "Cannot delete the default system company (SHSD)" }, { status: 403 })
    }

    const userIds = company.users.map(u => u.id)

    // 3. Transactional Cascading Delete
    await prisma.$transaction(async (tx) => {
        if (userIds.length > 0) {
            // Delete Company Tasks
            await tx.task.deleteMany({ where: { companyId: id } })

            // Delete Obligations
            await tx.obligation.deleteMany({ where: { companyId: id } })

            // Delete Notifications
            await tx.notification.deleteMany({ where: { userId: { in: userIds } } })

            // Delete Salary Records
            await tx.salaryRecord.deleteMany({ where: { userId: { in: userIds } } })

            // Delete Audit Logs
            await tx.auditLog.deleteMany({ where: { userId: { in: userIds } } })

            // Delete Created Tasks
            await tx.task.deleteMany({
                where: { createdBy: { in: userIds } }
            })

            // Delete Users
            await tx.user.deleteMany({ where: { id: { in: userIds } } })
        }

        // Delete Company
        await tx.company.delete({ where: { id } })
    })

    return NextResponse.json({ success: true })
}, {
    audit: { action: 'DELETE_COMPANY', entityType: 'COMPANY', getEntityId: (res, body) => body?.id }
})

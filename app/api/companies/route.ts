import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"

export async function GET(req: Request) {
    try {
        const session = await getServerSession(authOptions)
        if (!session?.user || session.user.role !== 'SUPER_ADMIN') {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
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
    } catch (error) {
        console.error('Fetch error:', error)
        return NextResponse.json(
            { error: "Failed to fetch companies" },
            { status: 500 }
        )
    }
}

export async function POST(req: Request) {
    // ... existing POST logic (standard create is fine, defaults isBanned=false) ...
    // Wait, standard create might fail if it tries to return all fields and doesn't know isBanned?
    // Actually, create returns what it knows. If DB has default, it's fine.
    // Let's keep POST standard for now, but wrapper it safely? 
    // No, let's just leave POST as is. The client doesn't know isBanned so it won't try to select it return it.
    // The DB will set default false.
    try {
        const session = await getServerSession(authOptions)

        if (!session?.user || session.user.role !== 'SUPER_ADMIN') {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
        }

        const { name } = await req.json()

        if (!name) {
            return NextResponse.json({ error: "Name is required" }, { status: 400 })
        }

        const company = await prisma.company.create({
            data: { name }
        })

        return NextResponse.json(company)
    } catch (error) {
        if ((error as any).code === 'P2002') {
            return NextResponse.json({ error: "Company already exists" }, { status: 400 })
        }
        return NextResponse.json(
            { error: "Failed to create company" },
            { status: 500 }
        )
    }

}

export async function PUT(req: Request) {
    try {
        const session = await getServerSession(authOptions)

        if (!session?.user || session.user.role !== 'SUPER_ADMIN') {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
        }

        const body = await req.json()
        const { id, name, isBanned } = body

        if (!id) {
            return NextResponse.json({ error: "ID is required" }, { status: 400 })
        }

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
        console.error('Update error:', error)
        if ((error as any).code === 'P2002') {
            return NextResponse.json({ error: "Company name already exists" }, { status: 400 })
        }
        return NextResponse.json(
            { error: "Failed to update company" },
            { status: 500 }
        )
    }
}

export async function DELETE(req: Request) {
    try {
        const session = await getServerSession(authOptions)

        if (!session?.user || session.user.role !== 'SUPER_ADMIN') {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
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
                // Delete Assigned Tasks
                await tx.task.deleteMany({ where: { assigneeId: { in: userIds } } })

                // Delete Obligations
                await tx.obligation.deleteMany({ where: { assigneeId: { in: userIds } } })

                // Delete Notifications
                await tx.notification.deleteMany({ where: { userId: { in: userIds } } })

                // Delete Salary Records
                await tx.salaryRecord.deleteMany({ where: { userId: { in: userIds } } })

                // Delete Audit Logs
                await tx.auditLog.deleteMany({ where: { userId: { in: userIds } } })

                // Unlink Created Tasks
                await tx.task.updateMany({
                    where: { createdBy: { in: userIds } },
                    data: { createdBy: null }
                })

                // Delete Users
                await tx.user.deleteMany({ where: { id: { in: userIds } } })
            }

            // Delete Company
            await tx.company.delete({ where: { id } })
        })

        return NextResponse.json({ success: true })
    } catch (error) {
        console.error('Delete company error:', error)
        return NextResponse.json(
            { error: "Failed to delete company" },
            { status: 500 }
        )
    }
}

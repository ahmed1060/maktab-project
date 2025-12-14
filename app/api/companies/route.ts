import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"

export async function GET() {
    try {
        const session = await getServerSession(authOptions)
        if (!session?.user || session.user.role !== 'SUPER_ADMIN') {
            // Exception: Employees/Admins might need to fetch their own company name? 
            // Actually, the frontend often has companyName in session.
            // If this endpoint is used for the "Company Select" list (Super Admin only), then it's fine.
            // If used for "My Company" profile, existing users use `api/users?id=me`.
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
        }

        const companies = await prisma.company.findMany({
            select: {
                id: true,
                name: true
            },
            orderBy: {
                name: 'asc'
            }
        })

        return NextResponse.json(companies)
    } catch (error) {
        return NextResponse.json(
            { error: "Failed to fetch companies" },
            { status: 500 }
        )
    }
}

export async function POST(req: Request) {
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

        const { id, name } = await req.json()

        if (!id || !name) {
            return NextResponse.json({ error: "ID and Name are required" }, { status: 400 })
        }

        // Prevent renaming SHSD if strict requirement? User said "company name SHSD by default and can not be changed".
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

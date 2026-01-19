import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"

export async function GET(req: Request) {
    const session = await getServerSession(authOptions)
    if (!session) {
        return new NextResponse("Unauthorized", { status: 401 })
    }

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
        // Default to active requests (PENDING or IN_PROGRESS) if not history
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

    try {
        const requests = await prisma.request.findMany({
            where,
            include: {
                user: {
                    select: {
                        id: true,
                        firstName: true,
                        lastName: true,
                        email: true,
                        avatar: true,
                        role: true
                    }
                }
            },
            orderBy: {
                [sortBy]: order
            }
        })

        return NextResponse.json(requests)
    } catch (error) {
        console.error("Error fetching requests:", error)
        return new NextResponse("Internal Server Error", { status: 500 })
    }
}

export async function POST(req: Request) {
    const session = await getServerSession(authOptions)
    if (!session) {
        return new NextResponse("Unauthorized", { status: 401 })
    }

    try {
        const json = await req.json()
        const { title, details } = json

        if (!title || !details) {
            return new NextResponse("Title and details are required", { status: 400 })
        }

        const userId = (session.user as any).id
        const companyId = (session.user as any).companyId

        const request = await prisma.request.create({
            data: {
                title,
                details,
                userId,
                companyId,
                status: 'PENDING'
            }
        })

        // Notify admins and team leaders
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

        // Also notify Super Admins if no companyId or just as a general rule? 
        // The user said: "super admins/admins/teamleader should receive a notification of it"
        // Let's notify super admins too.
        const superAdmins = await prisma.superAdmin.findMany({ select: { id: true } })
        // Wait, Notification model userId is logic to User model. SuperAdmin is a different model.
        // Let's check Notification model in schema.prisma again.
        // userId String -> User model. SuperAdmin does not have notifications relation in schema.prisma.
        // So I can only notify Users.

        return NextResponse.json(request)
    } catch (error) {
        console.error("Error creating request:", error)
        return new NextResponse("Internal Server Error", { status: 500 })
    }
}

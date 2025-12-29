import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"

export async function GET(req: Request) {
    const session = await getServerSession(authOptions)
    const userRole = session?.user?.role

    if (!session) {
        return new NextResponse("Unauthorized", { status: 401 })
    }

    const { searchParams } = new URL(req.url)
    const status = searchParams.get('status') || 'PENDING'
    const targetUserId = searchParams.get('userId')

    const isAdmin = ['ADMIN', 'SUPER_ADMIN'].includes(userRole || '')

    const whereClause: any = { status }

    if (!isAdmin) {
        // Regular users can only see their own requests
        whereClause.userId = (session.user as any).id
    } else {
        // Admins and Team Leaders are restricted to their company
        // Super Admin is exempt
        if (userRole !== 'SUPER_ADMIN') {
            const userCompanyId = (session.user as any).companyId
            if (!userCompanyId) {
                return NextResponse.json([], { status: 200 }) // No company, no results
            }
            whereClause.user = { companyId: userCompanyId }
        }

        if (targetUserId) {
            whereClause.userId = targetUserId
        }
    }

    const requests = await prisma.profileUpdateRequest.findMany({
        where: whereClause,
        include: {
            user: {
                select: {
                    firstName: true,
                    lastName: true,
                    email: true,
                    role: true,
                    company: {
                        select: { name: true }
                    }
                }
            }
        },
        orderBy: { createdAt: 'desc' }
    })

    return NextResponse.json(requests)
}

export async function POST(req: Request) {
    const session = await getServerSession(authOptions)
    if (!session || !session.user) {
        return new NextResponse("Unauthorized", { status: 401 })
    }

    const userId = (session.user as any).id
    const { newFirstName, newLastName } = await req.json()

    if (!newFirstName || !newLastName) {
        return new NextResponse("New name required", { status: 400 })
    }

    if (newFirstName.length > 15 || newLastName.length > 15) {
        return new NextResponse("Name too long (max 15 characters)", { status: 400 })
    }

    // Check for existing pending request
    const existing = await prisma.profileUpdateRequest.findFirst({
        where: {
            userId,
            status: 'PENDING'
        }
    })

    if (existing) {
        return new NextResponse("You already have a pending name change request", { status: 400 })
    }

    const user = await prisma.user.findUnique({ where: { id: userId } })
    if (!user) return new NextResponse("User not found", { status: 404 })

    // If name is identical, don't create request
    if (user.firstName === newFirstName && user.lastName === newLastName) {
        return new NextResponse("New name is identical to current name", { status: 400 })
    }

    const request = await prisma.profileUpdateRequest.create({
        data: {
            userId,
            oldFirstName: user.firstName,
            oldLastName: user.lastName,
            newFirstName,
            newLastName,
            status: 'PENDING'
        }
    })

    // Create a notification for admins/super-admins of this company
    // For now, simpler: notification system is global for the user who gets a status change.
    // The requirement says "accessible for admins from a button beside notification button".
    // I'll create a notification for the requesting user as confirmation? 
    // Actually, I'll just return the request.

    return NextResponse.json(request)
}

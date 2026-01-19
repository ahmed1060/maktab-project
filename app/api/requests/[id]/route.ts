import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"

export async function GET(req: Request, { params }: { params: { id: string } }) {
    const session = await getServerSession(authOptions)
    if (!session) {
        return new NextResponse("Unauthorized", { status: 401 })
    }

    try {
        const request = await prisma.request.findUnique({
            where: { id: params.id },
            include: {
                user: {
                    select: {
                        firstName: true,
                        lastName: true,
                        email: true,
                        avatar: true
                    }
                }
            }
        })

        if (!request) {
            return new NextResponse("Request not found", { status: 404 })
        }

        // Authorization check: User can see their own, Admin/TeamLeader can see company's, SuperAdmin can see all.
        const userRole = (session.user as any).role
        const userId = (session.user as any).id
        const userCompanyId = (session.user as any).companyId

        if (userRole === 'SUPER_ADMIN') {
            // OK
        } else if (['ADMIN', 'TEAM_LEADER'].includes(userRole)) {
            if (request.companyId !== userCompanyId) {
                return new NextResponse("Forbidden", { status: 403 })
            }
        } else {
            if (request.userId !== userId) {
                return new NextResponse("Forbidden", { status: 403 })
            }
        }

        return NextResponse.json(request)
    } catch (error) {
        console.error("Error fetching request:", error)
        return new NextResponse("Internal Server Error", { status: 500 })
    }
}

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
    const session = await getServerSession(authOptions)
    if (!session) {
        return new NextResponse("Unauthorized", { status: 401 })
    }

    const userRole = (session.user as any).role
    if (!['SUPER_ADMIN', 'ADMIN', 'TEAM_LEADER'].includes(userRole)) {
        return new NextResponse("Forbidden", { status: 403 })
    }

    try {
        const json = await req.json()
        const { status } = json

        if (!status || !['PENDING', 'IN_PROGRESS', 'COMPLETED'].includes(status)) {
            return new NextResponse("Invalid status", { status: 400 })
        }

        const request = await prisma.request.findUnique({
            where: { id: params.id }
        })

        if (!request) {
            return new NextResponse("Request not found", { status: 404 })
        }

        // Company isolation for Admins/TeamLeaders
        if (userRole !== 'SUPER_ADMIN') {
            const userCompanyId = (session.user as any).companyId
            if (request.companyId !== userCompanyId) {
                return new NextResponse("Forbidden", { status: 403 })
            }
        }

        const updatedRequest = await prisma.request.update({
            where: { id: params.id },
            data: { status }
        })

        // Notify user
        await prisma.notification.create({
            data: {
                userId: request.userId,
                type: 'REQUEST_STATUS_UPDATED',
                message: `Your request "${request.title}" status changed to ${status.replace('_', ' ')}`,
                relatedId: request.id
            }
        })

        return NextResponse.json(updatedRequest)
    } catch (error) {
        console.error("Error updating request status:", error)
        return new NextResponse("Internal Server Error", { status: 500 })
    }
}

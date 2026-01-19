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

        const data: any = { status }
        if (status === 'IN_PROGRESS') data.inProgressAt = new Date()
        if (status === 'COMPLETED') data.completedAt = new Date()

        const updatedRequest = await prisma.request.update({
            where: { id: params.id },
            data
        })

        // Notify user with enhanced message
        const updaterName = `${(session.user as any).firstName || ''} ${(session.user as any).lastName || ''}`.trim() || session.user?.name || 'Someone'
        const updaterRole = userRole.replace(/_/g, ' ')
        const statusText = status.replace(/_/g, ' ')

        await prisma.notification.create({
            data: {
                userId: request.userId,
                type: 'REQUEST_STATUS_UPDATED',
                message: `Your request "${request.title}" is ${statusText}. (Done by ${updaterRole} ${updaterName})`,
                relatedId: request.id
            }
        })

        return NextResponse.json(updatedRequest)
    } catch (error) {
        console.error("Error updating request status:", error)
        return new NextResponse("Internal Server Error", { status: 500 })
    }
}

export async function DELETE(req: Request, { params }: { params: { id: string } }) {
    const session = await getServerSession(authOptions)
    if (!session) {
        return new NextResponse("Unauthorized", { status: 401 })
    }

    const userRole = (session.user as any).role
    const userId = (session.user as any).id

    try {
        const request = await prisma.request.findUnique({
            where: { id: params.id }
        })

        if (!request) {
            return new NextResponse("Request not found", { status: 404 })
        }

        // Restriction: COMPLETED requests cannot be deleted unless SUPER_ADMIN
        if (request.status === 'COMPLETED' && userRole !== 'SUPER_ADMIN') {
            return new NextResponse("Forbidden: Completed requests can only be deleted by Super Admins", { status: 403 })
        }

        // Authorization: User can delete their own, Admin/TeamLeader can delete company's, SuperAdmin can delete all.
        if (userRole === 'SUPER_ADMIN') {
            // OK
        } else if (['ADMIN', 'TEAM_LEADER'].includes(userRole)) {
            const userCompanyId = (session.user as any).companyId
            if (request.companyId !== userCompanyId) {
                return new NextResponse("Forbidden", { status: 403 })
            }
        } else {
            if (request.userId !== userId) {
                return new NextResponse("Forbidden", { status: 403 })
            }
        }

        await prisma.request.delete({
            where: { id: params.id }
        })

        return new NextResponse(null, { status: 204 })
    } catch (error) {
        console.error("Error deleting request:", error)
        return new NextResponse("Internal Server Error", { status: 500 })
    }
}

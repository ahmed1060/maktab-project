import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"

export async function POST(req: Request, { params }: { params: { id: string } }) {
    const session = await getServerSession(authOptions)
    const userRole = session?.user?.role

    if (!session || !['ADMIN', 'SUPER_ADMIN'].includes(userRole || '')) {
        return new NextResponse("Unauthorized", { status: 401 })
    }

    const { id } = params
    const { adminNote } = await req.json().catch(() => ({ adminNote: '' }))

    const request = await prisma.profileUpdateRequest.findUnique({
        where: { id },
        include: { user: true }
    })

    if (!request) return new NextResponse("Request not found", { status: 404 })

    // Company Isolation Check
    const { verifyResourceAccess } = await import("@/lib/security")
    const hasAccess = await verifyResourceAccess(session, request.userId, 'USER')
    if (!hasAccess) {
        return new NextResponse("Forbidden: Access Denied", { status: 403 })
    }

    if (request.status !== 'PENDING') return new NextResponse("Request already processed", { status: 400 })

    // Update User
    await prisma.$transaction([
        prisma.user.update({
            where: { id: request.userId },
            data: {
                firstName: request.newFirstName,
                lastName: request.newLastName
            }
        }),
        prisma.profileUpdateRequest.update({
            where: { id },
            data: {
                status: 'APPROVED',
                adminNote
            }
        }),
        prisma.notification.create({
            data: {
                userId: request.userId,
                type: 'PROFILE_UPDATE',
                message: `Your name change request has been approved! Your name is now ${request.newFirstName} ${request.newLastName}.`,
                read: false
            }
        })
    ])

    return NextResponse.json({ success: true })
}

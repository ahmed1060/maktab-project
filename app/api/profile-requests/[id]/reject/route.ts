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
        where: { id }
    })

    if (!request) return new NextResponse("Request not found", { status: 404 })
    if (request.status !== 'PENDING') return new NextResponse("Request already processed", { status: 400 })

    await prisma.$transaction([
        prisma.profileUpdateRequest.update({
            where: { id },
            data: {
                status: 'REJECTED',
                adminNote
            }
        }),
        prisma.notification.create({
            data: {
                userId: request.userId,
                type: 'PROFILE_UPDATE_REJECTED',
                message: `Your name change request has been rejected.${adminNote ? ` Note: ${adminNote}` : ''}`,
                read: false
            }
        })
    ])

    return NextResponse.json({ success: true })
}

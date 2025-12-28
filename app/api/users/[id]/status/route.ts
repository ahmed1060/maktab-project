import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { verifyResourceAccess } from "@/lib/security"

export async function POST(
    request: Request,
    { params }: { params: { id: string } }
) {
    const session = await getServerSession(authOptions)
    if (!session) return new NextResponse("Unauthorized", { status: 401 })

    // Company Isolation Check
    const hasAccess = await verifyResourceAccess(session, params.id, 'USER')
    if (!hasAccess) {
        return new NextResponse("Access Denied: User belongs to a different company", { status: 403 })
    }

    const userRole = (session?.user as any)?.role

    // Only SUPER_ADMIN can change status (suspend/unsuspend)
    if (userRole !== 'SUPER_ADMIN') {
        return NextResponse.json({ error: "Only Super Admin can suspend/unsuspend users" }, { status: 403 })
    }

    try {
        const { status } = await request.json()

        // Validate status
        if (!['ACTIVE', 'OFFLINE', 'SUSPENDED'].includes(status)) {
            return NextResponse.json({ error: "Invalid status" }, { status: 400 })
        }

        const user = await prisma.user.update({
            where: { id: params.id },
            data: { status }
        })

        return NextResponse.json({ success: true, status: user.status })
    } catch (error) {
        console.error("Error updating status:", error)
        return NextResponse.json(
            { error: "Failed to update status" },
            { status: 500 }
        )
    }
}

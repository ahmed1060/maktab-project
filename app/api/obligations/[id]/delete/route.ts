import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { verifyResourceAccess } from "@/lib/security"

export async function DELETE(
    request: Request,
    { params }: { params: { id: string } }
) {
    const session = await getServerSession(authOptions)
    if (!session) return new NextResponse("Unauthorized", { status: 401 })

    // Company Isolation Check
    const hasAccess = await verifyResourceAccess(session, params.id, 'OBLIGATION')
    if (!hasAccess) {
        return new NextResponse("Access Denied: Obligation belongs to a different company", { status: 403 })
    }

    const userRole = (session?.user as any)?.role

    // Only ADMIN and SUPER_ADMIN can delete obligations
    if (!['ADMIN', 'SUPER_ADMIN'].includes(userRole)) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 403 })
    }

    try {
        await prisma.obligation.delete({
            where: { id: params.id }
        })

        return NextResponse.json({ success: true })
    } catch (error) {
        console.error("Error deleting obligation:", error)
        return NextResponse.json(
            { error: "Failed to delete obligation" },
            { status: 500 }
        )
    }
}

import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"

export async function POST(
    request: Request,
    { params }: { params: { id: string } }
) {
    const session = await getServerSession(authOptions)
    const userRole = (session?.user as any)?.role

    // Only ADMIN and SUPER_ADMIN can change status
    if (!['ADMIN', 'SUPER_ADMIN'].includes(userRole)) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 403 })
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

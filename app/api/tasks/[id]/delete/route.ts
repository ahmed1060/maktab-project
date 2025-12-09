import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"

export async function DELETE(
    request: Request,
    { params }: { params: { id: string } }
) {
    const session = await getServerSession(authOptions)
    const userRole = (session?.user as any)?.role

    // Only ADMIN and SUPER_ADMIN can delete tasks
    if (!['ADMIN', 'SUPER_ADMIN'].includes(userRole)) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 403 })
    }

    try {
        await prisma.task.delete({
            where: { id: params.id }
        })

        return NextResponse.json({ success: true })
    } catch (error) {
        console.error("Error deleting task:", error)
        return NextResponse.json(
            { error: "Failed to delete task" },
            { status: 500 }
        )
    }
}

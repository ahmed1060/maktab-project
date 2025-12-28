import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { verifyResourceAccess } from "@/lib/security"

export async function PUT(req: Request, { params }: { params: { id: string } }) {
    const session = await getServerSession(authOptions)
    if (!session) return new NextResponse("Unauthorized", { status: 401 })

    // Company Isolation Check
    const hasAccess = await verifyResourceAccess(session, params.id, 'TASK')
    if (!hasAccess) {
        return new NextResponse("Access Denied: Task belongs to a different company", { status: 403 })
    }

    try {
        // Can any user acknowledge? Usually the assignee.
        // We will allow the current user to acknowledge if they are the assignee or just simply reset it.
        // Requirement implies assignee sees it and dismisses it. 

        await prisma.task.update({
            where: { id: params.id },
            data: { isEdited: false }
        })

        return NextResponse.json({ success: true })
    } catch (error) {
        console.error("Acknowledge failed", error)
        return new NextResponse("Failed to acknowledge", { status: 500 })
    }
}

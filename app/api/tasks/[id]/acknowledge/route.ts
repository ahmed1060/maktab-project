import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"

export async function PUT(req: Request, { params }: { params: { id: string } }) {
    const session = await getServerSession(authOptions)
    if (!session) return new NextResponse("Unauthorized", { status: 401 })

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

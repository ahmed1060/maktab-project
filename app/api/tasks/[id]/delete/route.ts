import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { supabase } from "@/lib/storage"

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
        await prisma.$transaction(async (tx) => {
            const task = await tx.task.findUnique({
                where: { id: params.id },
                select: { status: true, difficulty: true, assigneeId: true, attachments: true }
            })

            if (task && ['APPROVED', 'COMPLETED'].includes(task.status)) {
                try {
                    await tx.user.update({
                        where: { id: task.assigneeId },
                        data: {
                            totalDifficultyPoints: {
                                decrement: task.difficulty
                            }
                        }
                    })
                } catch (error) {
                    console.error("Failed to deduct points during task deletion:", error)
                }
            }

            if (task?.attachments) {
                try {
                    const attachments = JSON.parse(task.attachments)
                    if (Array.isArray(attachments)) {
                        const filePaths = attachments
                            .map((a: any) => a.url?.split('/app-assets/')?.[1])
                            .filter(path => !!path)

                        if (filePaths.length > 0) {
                            await supabase.storage.from('app-assets').remove(filePaths)
                        }
                    }
                } catch (e) {
                    console.error("Failed to cleanup task attachments:", e)
                }
            }

            await tx.task.delete({
                where: { id: params.id }
            })
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

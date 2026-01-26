import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { supabase } from "@/lib/storage"
import { verifyResourceAccess } from "@/lib/security"

export async function DELETE(
    request: Request,
    { params }: { params: { id: string } }
) {
    const session = await getServerSession(authOptions)
    if (!session) return new NextResponse("Unauthorized", { status: 401 })

    // Company Isolation Check
    const hasAccess = await verifyResourceAccess(session, params.id, 'TASK')
    if (!hasAccess) {
        return new NextResponse("Access Denied: Task belongs to a different company", { status: 403 })
    }

    const userRole = (session?.user as any)?.role
    const currentUserId = (session?.user as any).id

    // Only ADMIN, SUPER_ADMIN and TEAM_LEADER can delete tasks
    if (!['ADMIN', 'SUPER_ADMIN', 'TEAM_LEADER'].includes(userRole)) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 403 })
    }

    try {
        await prisma.$transaction(async (tx) => {
            const task = await tx.task.findUnique({
                where: { id: params.id },
                select: { status: true, difficulty: true, assignees: { select: { id: true } }, attachments: true }
            })

            if (!task) throw new Error("Task not found")

            // Self-deletion restriction for ADMIN and SUPER_ADMIN
            const isSelfAssigned = (task.assignees as any[]).some((a: any) => a.id === currentUserId)
            if (['ADMIN', 'SUPER_ADMIN'].includes(userRole) && isSelfAssigned) {
                throw new Error("Admins cannot delete their own tasks")
            }
            // TEAM_LEADER is allowed to delete their own tasks (per user request)

            if (task && ['APPROVED', 'COMPLETED'].includes(task.status)) {
                const assigneeIds = (task.assignees as any[]).map((a: any) => a.id)
                for (const aId of assigneeIds) {
                    try {
                        await tx.user.update({
                            where: { id: aId },
                            data: {
                                totalDifficultyPoints: {
                                    decrement: task.difficulty
                                }
                            }
                        })
                    } catch (error) {
                        console.error(`Failed to deduct points from user ${aId} during task deletion:`, error)
                    }
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

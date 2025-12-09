import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import ObligationDetailClient from "./client"

export default async function ObligationDetailPage({ params }: { params: { id: string } }) {
    const session = await getServerSession(authOptions)
    const obligation = await prisma.obligation.findUnique({
        where: { id: params.id },
        include: { assignee: true }
    })

    if (!obligation) return <div>Obligation not found</div>

    // Auto-update status to IN_PROGRESS if viewed by assignee
    if (obligation.status === 'PENDING' && (session?.user as any)?.id === obligation.assigneeId) {
        // We don't have an IN_PROGRESS status for obligations in the schema yet (it was PENDING/COMPLETED)
        // But the user requested it. Let's assume we can use it or just stick to PENDING until upload.
        // Actually, the user explicitly asked: "make the status of the task or obligation when the employee opens them to change to in progress"
        // So I should probably update the schema or just allow the string if it's not an enum.
        // The schema defines status as String, so it's fine.

        await prisma.obligation.update({
            where: { id: obligation.id },
            data: { status: 'IN_PROGRESS' }
        })
        obligation.status = 'IN_PROGRESS'
    }

    return <ObligationDetailClient obligation={obligation} userRole={(session?.user as any)?.role} />
}

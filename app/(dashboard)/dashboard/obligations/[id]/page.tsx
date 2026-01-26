import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import ObligationDetailClient from "./client"

export default async function ObligationDetailPage({ params }: { params: { id: string } }) {
    const session = await getServerSession(authOptions)
    const userId = (session?.user as any)?.id

    const obligation = await prisma.obligation.findUnique({
        where: { id: params.id },
        include: { assignees: true }
    })

    if (!obligation) return <div>Obligation not found</div>

    // Auto-update status to IN_PROGRESS if viewed by any assignee
    const isAssignee = obligation.assignees.some(u => u.id === userId)
    if (obligation.status === 'PENDING' && isAssignee) {
        await prisma.obligation.update({
            where: { id: obligation.id },
            data: { status: 'IN_PROGRESS' }
        })
        obligation.status = 'IN_PROGRESS'
    }

    return <ObligationDetailClient obligation={obligation} userRole={(session?.user as any)?.role} />
}

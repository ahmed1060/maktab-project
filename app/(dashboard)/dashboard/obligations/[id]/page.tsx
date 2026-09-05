import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { verifyResourceAccess } from "@/lib/security"
import AccessDenied from "@/components/AccessDenied"
import ObligationDetailClient from "./client"

export default async function ObligationDetailPage({ params }: { params: { id: string } }) {
    const session = await getServerSession(authOptions)
    const userId = (session?.user as any)?.id

    const obligation = await prisma.obligation.findUnique({
        where: { id: params.id },
        include: {
            // Select, not `assignees: true` — the latter fetches every User
            // column (password hash, salary) into the Server->Client RSC
            // payload. Salary is now a Prisma.Decimal (F-07), which also
            // can't be passed to a Client Component at all without this.
            assignees: {
                select: { id: true, firstName: true, lastName: true, status: true }
            }
        }
    })

    if (!obligation) return <div>Obligation not found</div>

    // Company isolation — this page previously had no access check at all,
    // not even the employee-assignment restriction Task's page has.
    const hasAccess = await verifyResourceAccess(session, obligation.id, 'OBLIGATION')
    if (!hasAccess) return <AccessDenied />

    // Auto-update status to IN_PROGRESS if viewed by any assignee
    const isAssignee = obligation.assignees.some(u => u.id === userId)
    if (obligation.status === 'PENDING' && isAssignee) {
        await prisma.obligation.update({
            where: { id: obligation.id },
            data: { status: 'IN_PROGRESS' }
        })
        obligation.status = 'IN_PROGRESS'
    }

    return <ObligationDetailClient
        obligation={obligation}
        userRole={(session?.user as any)?.role}
        userId={userId || ''}
        userName={(session?.user as any)?.name || ''}
    />
}

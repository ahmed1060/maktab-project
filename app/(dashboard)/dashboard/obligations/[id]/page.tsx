import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { verifyResourceAccess } from "@/lib/security"
import AccessDenied from "@/components/AccessDenied"
import { accountRefusal } from "@/lib/account-refusal"
import ObligationDetailClient, { ObligationNotFound } from "./client"

export default async function ObligationDetailPage(props: { params: Promise<{ id: string }> }) {
    // Next 15 hands a page its dynamic segments and query string as
    // promises rather than plain objects, so they are awaited here and
    // the rest of the function reads them exactly as it did before.
    const params = await props.params

    const session = await getServerSession(authOptions)
    // Refused as the APIs refuse it: suspended, archived, banned, lapsed or under
    // maintenance, before anything is read (found after PR 139).
    if (accountRefusal(session?.user ?? {})) return <AccessDenied />
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

    if (!obligation) return <ObligationNotFound />

    // Company isolation — this page previously had no access check at all,
    // not even the employee-assignment restriction Task's page has.
    const hasAccess = await verifyResourceAccess(session, obligation.id, 'OBLIGATION')
    if (!hasAccess) return <AccessDenied />

    // Fetch creator details. Unlike Task/Client, Obligation never captured
    // a creator before its createdById column existed — every row from
    // before that migration has createdById = NULL because the data was
    // never recorded, not because a Super Admin made it. A fixed rollout
    // cutoff (this migration's applied date) distinguishes that case
    // ("genuinely unknown") from a real post-rollout Super Admin creation
    // (also NULL, but for the same reason Task.createdBy/Client.createdById
    // are — the FK only targets User).
    const OBLIGATION_CREATED_BY_ROLLOUT = new Date('2026-09-08T00:00:00Z')
    let creatorName: string | null = null
    let creatorUnknown = false
    if (obligation.createdById) {
        const creator = await prisma.user.findUnique({
            where: { id: obligation.createdById },
            select: { firstName: true, lastName: true }
        })
        if (creator) creatorName = `${creator.firstName} ${creator.lastName}`
    } else if (obligation.createdAt < OBLIGATION_CREATED_BY_ROLLOUT) {
        creatorUnknown = true
    }

    // Auto-update status to IN_PROGRESS if viewed by any assignee
    const isAssignee = obligation.assignees.some(u => u.id === userId)
    if (obligation.status === 'PENDING' && isAssignee) {
        await prisma.obligation.update({
            where: { id: obligation.id },
            data: { status: 'IN_PROGRESS' }
        })
        obligation.status = 'IN_PROGRESS'
    }

    // eslint-disable-next-line react-hooks/purity -- server-rendered once per request
    const now = Date.now()
    return <ObligationDetailClient
        obligation={obligation}
        now={now}
        userRole={(session?.user as any)?.role}
        userId={userId || ''}
        userName={(session?.user as any)?.name || ''}
        creatorName={creatorName}
        creatorUnknown={creatorUnknown}
    />
}

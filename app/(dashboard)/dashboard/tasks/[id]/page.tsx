import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { verifyResourceAccess } from "@/lib/security"
import AccessDenied from "@/components/AccessDenied"
import TaskDetailClient from "./client"

export default async function TaskDetailPage(props: { params: Promise<{ id: string }> }) {
    // Next 15 hands a page its dynamic segments and query string as
    // promises rather than plain objects, so they are awaited here and
    // the rest of the function reads them exactly as it did before.
    const params = await props.params

    const session = await getServerSession(authOptions)
    const task = await prisma.task.findUnique({
        where: { id: params.id },
        include: {
            // Select, not `assignees: true` — the latter fetches every User
            // column (password hash, salary, plainPasswordEnc historically)
            // straight into the Server->Client RSC payload. Only pick what
            // this page's client component actually renders.
            assignees: {
                select: { id: true, firstName: true, lastName: true, status: true, role: true }
            },
            // Cosmetic only — location itself was already copied into
            // task.location at creation time regardless of vendor.
            vendor: { select: { name: true } }
        }
    })

    if (!task) return <div>Task not found</div>

    // Company isolation — without this, any logged-in user who knows (or
    // guesses/enumerates) a task ID from another company can view it, since
    // the fetch above has no company scoping of its own.
    const hasAccess = await verifyResourceAccess(session, task.id, 'TASK')
    if (!hasAccess) return <AccessDenied />

    const userId = (session?.user as any)?.id
    const userRole = (session?.user as any)?.role
    const isAssigned = task.assignees?.some((a: any) => a.id === userId)

    // Auto-update status to IN_PROGRESS if viewed by an assignee
    if (task.status === 'PENDING' && isAssigned) {
        await prisma.task.update({
            where: { id: task.id },
            data: { status: 'IN_PROGRESS' }
        })
        task.status = 'IN_PROGRESS' // Update local object for rendering
    }

    // Fetch creator details. Task.createdBy has been null-for-Super-Admin
    // since this feature shipped (the FK only targets User) — that's the
    // only reason it's ever null, so `null` here unambiguously means
    // "created by a Super Admin," not "we don't know." The client component
    // renders that case as a localized "Super Admin" label instead of the
    // literal name lookup below, which only runs for a real User id.
    let creatorName: string | null = null
    if (task.createdBy) {
        const creator = await prisma.user.findUnique({
            where: { id: task.createdBy },
            select: { firstName: true, lastName: true }
        })
        if (creator) {
            creatorName = `${creator.firstName} ${creator.lastName}`
        }
    }

    const isRestricted = userRole === 'EMPLOYEE' && !isAssigned

    /**
     * memberCosts maps each assignee to what they are paid for this task.
     *
     * TaskCostsSection already shows an employee only their own figure, as "My
     * Total Cost", beside the task's grand total — a manager gets the
     * breakdown, an employee does not. But the whole map was serialised into
     * the page regardless, so on a task with three assignees any one of them
     * could read the other two's rate out of the source.
     *
     * The same narrowing the tasks list does, for the same reason: the screen
     * being right is not the same as the payload being right, and the next
     * component handed this object need not be as careful as this one.
     */
    const visibleMemberCosts = (() => {
        const raw = (task as any).memberCosts
        if (userRole !== 'EMPLOYEE' || !raw) return raw
        const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw
        if (!parsed || typeof parsed !== 'object') return raw
        return userId in parsed ? { [userId]: parsed[userId] } : {}
    })()

    // totalCost is a Prisma.Decimal (F-07) — Server Components can only pass
    // plain serializable values to Client Components.
    const serializedTask = {
        ...task,
        totalCost: Number(task.totalCost),
        memberCosts: visibleMemberCosts,
    }

    return <TaskDetailClient
        task={serializedTask}
        userRole={userRole}
        userId={userId}
        creatorName={creatorName}
        currentUserName={(session?.user as any)?.name}
        isRestricted={isRestricted}
    />
}

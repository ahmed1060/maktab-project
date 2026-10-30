import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { verifyResourceAccess } from "@/lib/security"
import AccessDenied from "@/components/AccessDenied"
import TaskDetailClient, { TaskNotFound } from "./client"
import { can } from '@/lib/permissions/can'
import { shapeTask } from '@/lib/permissions/shape'
import type { CostRow } from '@/lib/task-costs'

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
            client: { select: { name: true } },
            // Where it's done (CLIENTS_PLAN.md §2.3): its name and pin as they
            // are now, a pin corrected since included. A task from before
            // locations has none, and shows its own text.
            place: { select: { name: true, latitude: true, longitude: true, client: { select: { name: true } } } },
            // Its costs, each with its description (CLIENTS_PLAN.md §4.4, §4.5).
            costs: { select: { id: true, amount: true, description: true, authorId: true, authorName: true, receiptUrl: true, fromAdvance: true, createdAt: true } },
        }
    })

    if (!task) return <TaskNotFound />

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

    // Someone who does not see others' tasks, looking at one they are not on.
    const viewer = (session?.user ?? { role: null }) as any
    const seesOthersTasks = can(viewer, 'tasks.view')
    const isRestricted = !seesOthersTasks && !isAssigned

    // What each assignee is paid: all of it for someone who sees others'
    // tasks, only their own line for anybody else. shapeTask is the one rule,
    // shared with the task list and the task routes — the whole map used to be
    // serialised into the page, so any assignee could read the others' rates
    // out of the source.
    const visibleMemberCosts = shapeTask(viewer, { memberCosts: (task as any).memberCosts }).memberCosts

    // totalCost is a Prisma.Decimal (F-07) — Server Components can only pass
    // plain serializable values to Client Components.
    const serializedTask = {
        ...task,
        totalCost: Number(task.totalCost),
        memberCosts: visibleMemberCosts,
        costs: task.costs.map((c): CostRow => ({ ...c, amount: Number(c.amount), fromAdvance: Number(c.fromAdvance), createdAt: c.createdAt.toISOString() })),
    }

    // eslint-disable-next-line react-hooks/purity -- server-rendered once per request
    const now = Date.now()
    return <TaskDetailClient
        task={serializedTask}
        now={now}
        userRole={userRole}
        userId={userId}
        creatorName={creatorName}
        currentUserName={(session?.user as any)?.name}
        isRestricted={isRestricted}
    />
}

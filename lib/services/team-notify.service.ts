import { prisma } from "@/lib/prisma"
import { noticeRow } from "@/lib/notice-row"
import { planTeamNotifications, type TeamMove } from "@/lib/team-notifications"

/**
 * Write the notifications for a set of team moves.
 *
 * Best-effort, deliberately, and called after the change has committed. The
 * change is the thing that matters; the notification is news about it. If
 * writing the news fails, the Admin who made the change must not be told the
 * change failed — they would retry it, and a retried bulk move is a second
 * round of everything. So a failure here is logged and swallowed, and it
 * cannot roll anything back because by the time it runs there is nothing
 * left to roll back.
 *
 * The try/catch lives here rather than at each call site so that a new caller
 * cannot forget it.
 */
export async function notifyTeamMoves(moves: TeamMove[]): Promise<void> {
    try {
        const real = moves.filter(m => m.from !== m.to)
        if (real.length === 0) return

        const ids = new Set<string>()
        for (const m of real) {
            ids.add(m.userId)
            if (m.from) ids.add(m.from)
            if (m.to) ids.add(m.to)
        }
        const people = await prisma.user.findMany({
            where: { id: { in: [...ids] } },
            select: { id: true, firstName: true, lastName: true },
        })
        const names = new Map(people.map(p => [p.id, `${p.firstName} ${p.lastName}`.trim()]))

        const plan = planTeamNotifications(real, names)
        if (plan.length === 0) return

        await prisma.notification.createMany({
            data: plan.map(p => ({
                userId: p.userId,
                type: "TEAM_CHANGED",
                ...noticeRow(p.text),
                relatedId: p.relatedId,
            })),
        })
    } catch (error) {
        console.error("[TEAM_NOTIFY_FAILED]", error)
    }
}

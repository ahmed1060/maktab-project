import { prisma } from "@/lib/prisma"
import type { Prisma } from "@prisma/client"
import { checkTeamAssignment } from "@/lib/team-assignment"

/**
 * Where a leader's team goes when the leader stops leading.
 *
 * One implementation for every path that can take a leader away: editing
 * their role, status or company (UserService.update) and ending their contract
 * (the employment route). Each used to be its own decision, and the second one
 * never asked the question at all — ending a Team Leader's contract left their
 * team pointing at an archived account.
 *
 * `reassignReportsTo` has three states, as everywhere else in team assignment:
 * absent means nobody has answered yet (refuse, naming the people), null means
 * leave them unassigned, and an id means move them to that leader.
 */

export type Rehome = { ids: string[]; to: string | null }

export type Report = { id: string; firstName: string; lastName: string }

export class TeamHandOff {
    /**
     * Decide the hand-off for a leader who is about to stop leading.
     *
     * Returns null when there is nobody to move. Throws LEADER_HAS_REPORTS
     * (with `.reports`) when there is and nobody has said where they go,
     * REASSIGN_TARGET_IS_LEAVING when the answer is the leader themselves,
     * TEAM_LEADER_NOT_FOUND, or the checkTeamAssignment code for a new leader
     * who cannot take them.
     */
    static async plan(
        leader: { id: string; companyId: string | null },
        reassignReportsTo: string | null | undefined,
    ): Promise<Rehome | null> {
        const reports: Report[] = await prisma.user.findMany({
            where: { teamLeaderId: leader.id, status: { notIn: ['DELETED', 'ARCHIVED'] } },
            select: { id: true, firstName: true, lastName: true },
        })
        if (reports.length === 0) return null

        if (reassignReportsTo === undefined) {
            // Nobody has answered the question yet. The refusal carries the
            // names so the screen can ask about these people specifically
            // rather than in the abstract.
            const err: any = new Error("LEADER_HAS_REPORTS")
            err.reports = reports
            throw err
        }

        if (reassignReportsTo !== null) {
            // Not the person leaving. Otherwise the answer to "where do they
            // go" is "nowhere", spelled in a way that passes every other check.
            if (reassignReportsTo === leader.id) throw new Error("REASSIGN_TARGET_IS_LEAVING")
            const newLeader = await prisma.user.findUnique({
                where: { id: reassignReportsTo },
                select: { id: true, role: true, companyId: true, status: true },
            })
            if (!newLeader) throw new Error("TEAM_LEADER_NOT_FOUND")
            // The reports are employees in this company, so one check answers
            // for all of them.
            const verdict = checkTeamAssignment(
                { id: reports[0].id, role: 'EMPLOYEE', companyId: leader.companyId },
                newLeader,
            )
            if (!verdict.ok) throw new Error(verdict.refusal.code)
        }

        return { ids: reports.map(r => r.id), to: reassignReportsTo }
    }

    /**
     * Move the team, inside the caller's transaction.
     *
     * Always inside the same transaction as whatever takes the leader away.
     * A rehoming that lands without it leaves a leader who still leads; the
     * change landing without the rehoming is the exact state the refusal
     * exists to prevent.
     *
     * tx, not prisma: a transaction holds a connection, and anything inside it
     * reaching for the global client needs a second one from a pool that is
     * deliberately small — which is a deadlock, not a slow query.
     */
    static async apply(
        tx: Prisma.TransactionClient,
        leaderId: string,
        rehome: Rehome,
        /** Who made the change; null when nobody did — the nightly job. */
        actor: { id: string; role: string | null | undefined } | null,
    ): Promise<void> {
        await tx.user.updateMany({
            where: { id: { in: rehome.ids } },
            data: { teamLeaderId: rehome.to },
        })

        // The leader's own change is recorded by its own path. This one
        // rewrites other people's rows, and each is a change to who can see
        // them. Logged inside the transaction so it cannot outlive a rollback,
        // and carrying the ids because "a team was moved" without saying whose
        // is not an audit trail.
        const { AuditLogService } = await import("./audit-log.service")
        await AuditLogService.log('REASSIGN_TEAM', 'USER', leaderId, {
            tx,
            userId: actor && actor.role !== 'SUPER_ADMIN' ? actor.id : null,
            superAdminId: actor && actor.role === 'SUPER_ADMIN' ? actor.id : null,
            details: { from: leaderId, to: rehome.to, affected: rehome.ids },
        })
    }

    /**
     * Whoever still reports to a leader, unassigned — for the one path with
     * nobody to ask. A contract ended with a future leaving date moves the
     * team when it is recorded, but the leader keeps working until then and
     * can be given somebody new in the meantime. When the nightly job finally
     * archives them, that person would be left under an archived account.
     * Unassigning is the answer that guesses nothing: an Admin sees them as
     * unassigned and chooses.
     */
    static async unassignRemaining(tx: Prisma.TransactionClient, leaderId: string): Promise<Rehome | null> {
        const reports = await tx.user.findMany({
            where: { teamLeaderId: leaderId, status: { notIn: ['DELETED', 'ARCHIVED'] } },
            select: { id: true },
        })
        if (reports.length === 0) return null
        const rehome = { ids: reports.map(r => r.id), to: null }
        await this.apply(tx, leaderId, rehome, null)
        return rehome
    }

    /** The team moves a hand-off made, for notifyTeamMoves once it has committed. */
    static moves(leaderId: string, rehome: Rehome | null) {
        return rehome ? rehome.ids.map(userId => ({ userId, from: leaderId, to: rehome.to })) : []
    }
}

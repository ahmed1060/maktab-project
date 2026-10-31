import { NextResponse } from "next/server"
import { ApiResponse } from "@/lib/api-response"

/**
 * The HTTP answer for a refused team change, shared by every route that can
 * take a leader away from their team (editing a user, ending a contract), so
 * the screen gets the same refusal — and the same payload to build the
 * hand-off popup from — whichever way the Admin got there.
 *
 * Returns null for anything that is not a team refusal, for the route to map
 * or rethrow.
 */
export function teamRefusalResponse(error: any) {
    // The refusal names the people it is about. "Reassign them first" without
    // saying who sends an Admin hunting through a list, and the popup that
    // offers to reassign or unassign them is built from exactly this payload.
    if (error?.message === 'LEADER_HAS_REPORTS') {
        // Its code too, so the Requests page, which offers no hand-off, can say
        // where to make the change instead (UI_PLAN.md §2.3, part 5b).
        return NextResponse.json({
            success: false,
            error: "This person still leads a team. Choose where their team members go before changing this.",
            details: { reports: error.reports ?? [] },
            code: 'LEADER_HAS_REPORTS',
        }, { status: 400 })
    }
    const message = TEAM_REFUSALS[error?.message as keyof typeof TEAM_REFUSALS]
    return message ? ApiResponse.badRequest(message) : null
}

const TEAM_REFUSALS = {
    TEAM_LEADER_NOT_FOUND: "That team leader no longer exists",
    REASSIGN_TARGET_IS_LEAVING: "Their team cannot be moved to the person who is leaving it",
    NOT_A_LEADER: "That person is not a team leader",
    ONLY_EMPLOYEES_HAVE_LEADERS: "Only employees are assigned to a team leader",
    SELF_LEADERSHIP: "Somebody cannot be their own team leader",
    DIFFERENT_COMPANY: "A team leader and their team must be in the same company",
    LEADER_UNAVAILABLE: "That team leader's account is archived or deleted",
} as const

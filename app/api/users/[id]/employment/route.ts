import { withStandardHandler } from "@/lib/api-utils"
import { ApiResponse } from "@/lib/api-response"
import { teamRefusalResponse } from "@/lib/team-handoff-response"
import { EmploymentService } from "@/lib/services/employment.service"
import { SettlementService } from "@/lib/services/settlement.service"
import { verifyResourceAccess } from "@/lib/security"
import { can } from "@/lib/permissions/can"
import { toMajor } from "@/lib/payroll"
import { calendarMonth } from "@/lib/time"

/**
 * Ending a contract, and seeing what it would settle at first.
 *
 * GET previews, POST commits. They are the same calculation over the same
 * date, which is the point: an admin should never be told one figure on the
 * confirmation screen and have a different one recorded.
 */

/** Preview: what ending on `lastWorkingDay` would settle at, plus this month's timeline. */
export const GET = withStandardHandler(async (req, session, _json, { params }) => {
    const userId = params.id
    const { searchParams } = new URL(req.url)
    const lastWorkingDay = searchParams.get('lastWorkingDay')

    // The employment record is the HR record, seen by those who edit people —
    // not employees.view, which a Team Leader holds for their team. Asking for
    // a settlement preview is the first step of ending a contract.
    const needed = lastWorkingDay ? "employees.end_contract" : "employees.edit"
    if (!can(session.user, needed)) return ApiResponse.forbidden("Managers only")
    if (!(await verifyResourceAccess(session, userId, 'USER'))) return ApiResponse.forbidden("Access denied")

    const now = new Date()
    const { year, month } = calendarMonth(now)

    const [history, timeline] = await Promise.all([
        EmploymentService.history(userId),
        EmploymentService.timelineForMonth(userId, year, month),
    ])

    if (!lastWorkingDay) {
        return ApiResponse.success({ history, timeline, preview: null })
    }

    try {
        const preview = await SettlementService.preview(userId, lastWorkingDay)
        return ApiResponse.success({
            history,
            timeline,
            preview: {
                ...preview,
                // Major units for display. The calculation stays in minor units
                // all the way to here so the rounding happens once, where it is
                // written down.
                earned: toMajor(preview.earnedMinor),
                paid: toMajor(preview.paidMinor),
                net: toMajor(preview.netMinor),
                debtsOutstanding: toMajor(preview.debtsOutstandingMinor),
                debtRecovered: toMajor(preview.debtRecoveredMinor),
                payable: toMajor(preview.payableMinor),
            },
        })
    } catch (error: any) {
        const message = error?.message ?? ""
        // Both are real answers rather than crashes: a date this system cannot
        // read, or a person with no salary history covering the month they
        // would leave in.
        if (/Not a date/.test(message)) {
            return ApiResponse.badRequest("lastWorkingDay must be YYYY-MM-DD")
        }
        if (/No salary in effect/.test(message)) {
            return ApiResponse.badRequest(message)
        }
        throw error
    }
})

/** Commit: end the contract, or reinstate somebody whose contract was ended. */
export const POST = withStandardHandler(async (req, session, json, { params }) => {
    const userId = params.id
    if (!can(session.user, "employees.end_contract")) return ApiResponse.forbidden("Managers only")
    if (!(await verifyResourceAccess(session, userId, 'USER'))) return ApiResponse.forbidden("Access denied")
    if (userId === session.user.id) return ApiResponse.badRequest("You cannot end your own contract")

    const { action, lastWorkingDay, reason } = json ?? {}
    // Three states, as everywhere in team assignment: absent means nobody has
    // said where a leader's team goes yet, null means leave them unassigned,
    // an id means move them there.
    const reassignReportsTo = json && typeof json === 'object' && 'reassignReportsTo' in json ? json.reassignReportsTo : undefined
    if (reassignReportsTo !== undefined && reassignReportsTo !== null && (typeof reassignReportsTo !== 'string' || !reassignReportsTo)) {
        return ApiResponse.badRequest("reassignReportsTo must be a team leader's id or null")
    }

    if (action === 'REINSTATE') {
        const event = await EmploymentService.record({
            userId,
            type: 'REINSTATED',
            effectiveFrom: new Date(),
            reason: typeof reason === 'string' ? reason : undefined,
            createdById: session.user.id,
        })
        return ApiResponse.success({ event })
    }

    if (action !== 'END_CONTRACT') return ApiResponse.badRequest("Unknown action")
    if (typeof lastWorkingDay !== 'string') return ApiResponse.badRequest("lastWorkingDay is required")

    // P5 shipped the preview and said plainly that the refusal had to wait for
    // a table to persist a settlement into. This is that refusal: there is no
    // path here that ends a contract without producing the statement, because
    // both happen in one transaction or neither does.
    try {
        const { event, settlement, debt, preview } = await SettlementService.settleAndEnd({
            userId,
            lastWorkingDay,
            reason: typeof reason === 'string' ? reason : undefined,
            createdById: session.user.id,
            actorRole: session.user.role,
            reassignReportsTo,
        })

        return ApiResponse.success({
            event,
            settlement,
            debtId: debt?.id ?? null,
            // record() archives straight away when the date has already arrived,
            // and leaves the status alone when it has not — the nightly job
            // applies it at the local day boundary. Saying which happened keeps
            // the screen honest about whether this person can still sign in.
            archivedNow: preview.endsAt.getTime() <= Date.now(),
        })
    } catch (error: any) {
        const message = error?.message ?? ""
        // A leader with a team is asked where it goes first — the same
        // refusal, with the same names, as the edit form gets.
        const teamRefusal = teamRefusalResponse(error)
        if (teamRefusal) return teamRefusal
        if (/Not a date/.test(message)) {
            return ApiResponse.badRequest("lastWorkingDay must be YYYY-MM-DD")
        }
        if (/No salary in effect/.test(message)) {
            return ApiResponse.badRequest(message)
        }
        if (message === "USER_HAS_NO_COMPANY") {
            return ApiResponse.badRequest("This account belongs to no company, so there is nobody to settle with.")
        }
        throw error
    }
})

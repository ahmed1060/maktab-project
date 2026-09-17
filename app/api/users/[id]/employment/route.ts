import { withStandardHandler } from "@/lib/api-utils"
import { ApiResponse } from "@/lib/api-response"
import { EmploymentService } from "@/lib/services/employment.service"
import { verifyResourceAccess } from "@/lib/security"
import { endOfContractInstant } from "@/lib/employment"
import { toMajor } from "@/lib/payroll"
import { calendarMonth } from "@/lib/time"

/**
 * Ending a contract, and seeing what it would settle at first.
 *
 * GET previews, POST commits. They are the same calculation over the same
 * date, which is the point: an admin should never be told one figure on the
 * confirmation screen and have a different one recorded.
 */

const MANAGERS = ['ADMIN', 'SUPER_ADMIN']

/** Preview: what ending on `lastWorkingDay` would settle at, plus this month's timeline. */
export const GET = withStandardHandler(async (req, session, _json, { params }) => {
    const userId = params.id
    if (!MANAGERS.includes(session.user.role || '')) return ApiResponse.forbidden("Managers only")
    if (!(await verifyResourceAccess(session, userId, 'USER'))) return ApiResponse.forbidden("Access denied")

    const { searchParams } = new URL(req.url)
    const lastWorkingDay = searchParams.get('lastWorkingDay')

    const now = new Date()
    const { year, month } = calendarMonth(now)

    const [history, timeline] = await Promise.all([
        EmploymentService.history(userId),
        EmploymentService.timelineForMonth(userId, year, month),
    ])

    if (!lastWorkingDay) {
        return ApiResponse.success({ history, timeline, preview: null })
    }

    let endsAt: Date
    try {
        endsAt = endOfContractInstant(lastWorkingDay)
    } catch {
        return ApiResponse.badRequest("lastWorkingDay must be YYYY-MM-DD")
    }

    try {
        const preview = await EmploymentService.previewSettlement({ userId, endsAt })
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
            },
        })
    } catch (error: any) {
        // ratesForMonth refuses a month with no salary in force rather than
        // guessing one. That is a real answer, not a crash: it means this
        // person has no salary history covering the month they would leave in.
        if (/No salary in effect/.test(error?.message ?? '')) {
            return ApiResponse.badRequest(error.message)
        }
        throw error
    }
})

/** Commit: end the contract, or reinstate somebody whose contract was ended. */
export const POST = withStandardHandler(async (req, session, json, { params }) => {
    const userId = params.id
    if (!MANAGERS.includes(session.user.role || '')) return ApiResponse.forbidden("Managers only")
    if (!(await verifyResourceAccess(session, userId, 'USER'))) return ApiResponse.forbidden("Access denied")
    if (userId === session.user.id) return ApiResponse.badRequest("You cannot end your own contract")

    const { action, lastWorkingDay, reason } = json ?? {}

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

    let endsAt: Date
    try {
        endsAt = endOfContractInstant(lastWorkingDay)
    } catch {
        return ApiResponse.badRequest("lastWorkingDay must be YYYY-MM-DD")
    }

    const event = await EmploymentService.record({
        userId,
        type: 'CONTRACT_ENDED',
        effectiveFrom: endsAt,
        reason: typeof reason === 'string' ? reason : undefined,
        createdById: session.user.id,
    })

    return ApiResponse.success({
        event,
        // record() archives straight away when the date has already arrived,
        // and leaves the status alone when it has not — the nightly job applies
        // it at the local day boundary. Saying which happened keeps the screen
        // honest about whether this person can still sign in tonight.
        archivedNow: endsAt.getTime() <= Date.now(),
    })
})

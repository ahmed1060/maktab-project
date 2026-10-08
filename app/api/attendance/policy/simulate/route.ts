import { z } from "zod"
import { withStandardHandler } from "@/lib/api-utils"
import { ApiResponse } from "@/lib/api-response"
import { AttendanceEngineService } from "@/lib/services/attendance-engine.service"
import { AttendanceCalendarService } from "@/lib/services/attendance-calendar.service"
import { checkBody } from "@/lib/services/attendance-policy.service"
import { addDays } from "@/lib/attendance/calendar"
import { attendanceCompanyFor, denyAttendanceSettings } from "@/lib/attendance/settings-access"
import { can, canCompanyWide } from "@/lib/permissions/can"

const simulateSchema = z.object({
    companyId: z.string().optional(),
    /** The month to replay, YYYY-MM; last month when left out. */
    month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).optional(),
    // Checked in full as a policy would be (lib/attendance/policy.ts).
    body: z.record(z.string(), z.unknown()),
})

/**
 * "Under this rule, last month would have been…" (ATTENDANCE_PLAN.md §6.7):
 * a draft policy replayed over a month, per person against the policy in
 * force. Nothing is saved. For whoever edits the policy.
 */
export const POST = withStandardHandler(async (_req, session, json) => {
    const validation = simulateSchema.safeParse(json)
    if (!validation.success) return ApiResponse.badRequest("Validation Error", validation.error.format())
    const companyId = attendanceCompanyFor(session, validation.data.companyId)
    const denied = await denyAttendanceSettings(session, companyId, "edit")
    if (denied) return denied
    const draft = checkBody(validation.data.body)
    const month = validation.data.month ?? addDays(`${(await AttendanceCalendarService.today(companyId!)).slice(0, 7)}-01`, -1).slice(0, 7)
    const result = await AttendanceEngineService.simulate(companyId!, month, draft)
    // Money here is each person's salary at work: priced per person, a draft
    // charging one day would read out everyone's day rate. Without salary.view
    // over the whole company, the preview shows days, not money (review on #15).
    if (canCompanyWide(session.user, "salary.view") && can(session.user, "salary.view", { companyId: companyId! })) return ApiResponse.success(result)
    const days = <T extends { deductionDays: number; days: number }>(s: T) => ({ deductionDays: s.deductionDays, days: s.days, deductionMinor: null, overtimeMinor: null })
    const daysMoved = (p: { current: { deductionDays: number }; draft: { deductionDays: number } }) => p.draft.deductionDays - p.current.deductionDays
    return ApiResponse.success({
        ...result,
        moneyHidden: true,
        // Ordered by days and name: the engine's order, by money, would rank everyone's pay (review on #15).
        people: result.people
            .map(p => ({ ...p, current: days(p.current), draft: days(p.draft) }))
            .sort((a, b) => daysMoved(b) - daysMoved(a) || a.name.localeCompare(b.name) || a.userId.localeCompare(b.userId)),
        totals: { current: days(result.totals.current), draft: days(result.totals.draft) },
    })
})

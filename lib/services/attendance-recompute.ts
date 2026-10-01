/**
 * Rebuilds the attendance days a change touched (ATTENDANCE_PLAN.md §11:
 * recomputation on any change to schedule, override, holiday, policy, punch,
 * mapping or approval). Loaded lazily: the engine reads the calendar, the
 * policy and the punches, so the services that change them cannot import it
 * at the top without a cycle.
 *
 * Runs after the change has committed, and never fails it: if rebuilding
 * fails, the change stands and the nightly reconciliation catches up.
 */
export async function recomputeAfter(companyId: string, fromDate: string, userIds?: readonly string[]) {
    const { AttendanceEngineService } = await import("./attendance-engine.service")
    await AttendanceEngineService.afterChange(companyId, fromDate, userIds)
}

/** After a change to the central holiday calendar: every company that has punches observes it. */
export async function recomputeEveryCompanyAfter(fromDate: string) {
    const { prisma } = await import("@/lib/prisma")
    const companies = await prisma.attendancePunch.findMany({ distinct: ["companyId"], select: { companyId: true } })
    for (const { companyId } of companies) await recomputeAfter(companyId, fromDate)
}

/**
 * After a change to somebody's salary or employment, effective from an
 * instant: their days from that date in their company's calendar (review on
 * #13). Only for a change that has committed — one written inside a caller's
 * transaction is caught by the nightly run instead, which rebuilds the months
 * of recent changes.
 */
export async function recomputeForPersonFrom(userId: string, from: Date) {
    const { prisma } = await import("@/lib/prisma")
    const { calendarDateStr } = await import("@/lib/time")
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { companyId: true, company: { select: { timezone: true } } } })
    if (!user?.companyId || !user.company) return
    await recomputeAfter(user.companyId, calendarDateStr(from, user.company.timezone), [userId])
}

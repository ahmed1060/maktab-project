import { prisma } from "@/lib/prisma"
import { offsetMsIn, DEFAULT_TIME_ZONE } from "@/lib/time"
import { addDays, formatMinutes, toDateString } from "@/lib/attendance/calendar"
import { EARLY_MARGIN_MINUTES } from "@/lib/attendance/engine"
import { hasBundle, resolveBundles } from "@/lib/features/bundles"
import { CompanyService } from "./company.service"
import { AttendanceEngineService } from "./attendance-engine.service"
import { AttendanceCheckInService } from "./attendance-check-in.service"
import { NotificationService } from "./notification.service"
import { PushService } from "./push.service"

/**
 * "You haven't checked in" (ATTENDANCE_PLAN.md §13.4): N minutes after a
 * shift starts with no check-in, the person is told, on their phone and in
 * the bell. N is the policy's noCheckInReminderMinutes; null turns it off.
 *
 * Only for people who check in with the app — a phone in use or waiting —
 * in a company that still has the Mobile App add-on. Once per person and
 * working day (CheckInReminder), however often the job runs. Not on a rest
 * day or holiday, not on leave, when suspended, or when lateness that day
 * is already excused or asked for: the same days the late notice keeps
 * quiet on. And not more than an hour after it was due: if the job was down,
 * a reminder at noon about 09:00 helps nobody.
 */

const LATE_WINDOW_MINUTES = 60

export class CheckInReminderService {
    /** Reminds whoever is due, then sends what is waiting to be pushed. */
    static async run(now = new Date()) {
        const phones = await prisma.checkInPhone.findMany({
            // Not someone who can't sign in (review on #25): suspended, deleted, or whose
            // contract ended — a change partway through a day isn't a whole day's suspension.
            where: { status: { in: ["ACTIVE", "PENDING"] }, user: { status: { notIn: ["SUSPENDED", "DELETED", "ARCHIVED"] } } },
            select: { companyId: true, userId: true },
            distinct: ["userId"],
        })
        const byCompany = new Map<string, string[]>()
        for (const p of phones) byCompany.set(p.companyId, [...(byCompany.get(p.companyId) ?? []), p.userId])

        let reminded = 0
        for (const [companyId, userIds] of byCompany) {
            reminded += await this.remindCompany(companyId, userIds, now)
        }
        const pushed = await PushService.flush(now)
        return { reminded, pushed }
    }

    private static async remindCompany(companyId: string, userIds: string[], now: Date): Promise<number> {
        const company = await CompanyService.settingsExposure(companyId)
        if (!company || !hasBundle(resolveBundles(company.package), "ATTENDANCE_MOBILE")) return 0
        const { timezone } = await prisma.company.findUniqueOrThrow({ where: { id: companyId }, select: { timezone: true } })
        const local = new Date(now.getTime() + offsetMsIn(now, timezone ?? DEFAULT_TIME_ZONE)).toISOString().slice(0, 19)
        const today = local.slice(0, 10)
        // Yesterday too: a night shift that started last evening.
        const dates = [addDays(today, -1), today]
        const { plans, policyOn } = await AttendanceEngineService.plansFor(companyId, userIds, dates)
        const minutesInto = (date: string) => (Date.parse(`${local}Z`) - Date.parse(`${date}T00:00:00Z`)) / 60_000

        // Who is due, from the plans alone; then what rules them out, a
        // handful of queries for the whole company (review on #25).
        const due: { userId: string; date: string; start: number; earliest: Date }[] = []
        for (const userId of userIds) {
            for (const date of dates) {
                const expected = plans.get(userId)?.get(date)
                const after = policyOn(date)?.noCheckInReminderMinutes
                if (expected?.kind !== "WORK" || !after) continue
                const start = expected.hours.startMinutes
                const since = minutesInto(date) - start
                if (since < after || since > after + LATE_WINDOW_MINUTES) continue
                // Any check-in since the shift's window opened counts, flagged or held included.
                due.push({ userId, date, start, earliest: new Date(Date.parse(`${date}T00:00:00Z`) + (start - EARLY_MARGIN_MINUTES) * 60_000) })
            }
        }
        if (due.length === 0) return 0
        const [punches, waived] = await Promise.all([
            prisma.attendancePunch.findMany({
                // This company's own: punches stay with a company the person has left.
                where: {
                    companyId, userId: { in: [...new Set(due.map(d => d.userId))] }, voidedAt: null, status: { in: ["ACCEPTED", "FLAGGED", "PENDING_DEVICE"] },
                    punchAtLocal: { gte: new Date(Math.min(...due.map(d => d.earliest.getTime()))), lte: new Date(`${local}Z`) },
                },
                select: { userId: true, punchAtLocal: true },
            }),
            AttendanceCheckInService.latenessWaivedFor(companyId, due),
        ])
        const remind = due.filter(d =>
            !punches.some(p => p.userId === d.userId && p.punchAtLocal >= d.earliest) && !waived.has(`${d.userId}|${d.date}`))
        if (remind.length === 0) return 0

        // Once per person and day: the rows inserted are the ones told, in one transaction.
        return prisma.$transaction(async tx => {
            const inserted = await tx.$queryRaw<{ userId: string; date: Date }[]>`
                INSERT INTO "CheckInReminder"("userId", "date", "companyId")
                SELECT u, d::date, ${companyId} FROM UNNEST(${remind.map(r => r.userId)}::text[], ${remind.map(r => r.date)}::text[]) AS t(u, d)
                ON CONFLICT DO NOTHING
                RETURNING "userId", "date"`
            const startOf = new Map(remind.map(r => [`${r.userId}|${r.date}`, r.start]))
            const byTime = new Map<string, string[]>()
            for (const row of inserted) {
                const time = formatMinutes(startOf.get(`${row.userId}|${toDateString(row.date)}`)!)
                byTime.set(time, [...(byTime.get(time) ?? []), row.userId])
            }
            for (const [time, ids] of byTime) {
                await NotificationService.notifyMany(ids, "ATTENDANCE_REMINDER", { key: "notice_att_checkin_reminder", params: { time } }, "/dashboard/check-in", tx)
            }
            return inserted.length
        })
    }
}

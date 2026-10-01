import { prisma } from "@/lib/prisma"
import { Prisma } from "@prisma/client"
import { calendarDateStr } from "@/lib/time"
import { AuditLogService } from "./audit-log.service"
import {
    addDays, dayHoursProblem, defaultOn, formatMinutes, hoursProblem, isDateString, overridesOverlap, spanOf, toDateString, workWeekProblem,
    type DayHours,
} from "@/lib/attendance/calendar"

/**
 * The attendance calendar of one company (ATTENDANCE_PLAN.md §7): its
 * schedules, their dated versions and overrides, who works which, and the
 * holidays it observes. Access is the caller's: every route checks the
 * company's Attendance settings tab first (lib/company-settings-access.ts).
 *
 * One rule runs through all of it (§6.1): nothing may change a date whose
 * payroll month is approved or paid. That month's payslips were computed
 * against the calendar as it stood, and a calendar that moves under them makes
 * them wrong after the fact.
 */

export type HoursInput = { startMinutes: number; endMinutes: number; breakMinutes?: number }

export type VersionInput = HoursInput & {
    effectiveFrom: string
    /** Empty for the company's work week. */
    workWeek?: number[]
    days?: DayHours[]
}

export type OverrideInput = HoursInput & {
    name: string
    startDate: string
    endDate: string
    days?: DayHours[]
}

const DATE_ONLY = (date: string) => new Date(`${date}T00:00:00Z`)

/** The day-by-day shape every screen and the engine read. */
const SCHEDULE_INCLUDE = {
    versions: { include: { days: true }, orderBy: { effectiveFrom: "asc" } },
    overrides: { include: { days: true }, orderBy: { startDate: "asc" } },
} satisfies Prisma.WorkScheduleInclude

/** Who did it, in the column the audit log keeps for their kind of account. */
async function actorOf(tx: Prisma.TransactionClient, actorId: string) {
    const superAdmin = await tx.superAdmin.findUnique({ where: { id: actorId }, select: { id: true } })
    return superAdmin ? { superAdminId: actorId } : { userId: actorId }
}

function fail(code: string): never {
    throw new Error(code)
}

function checkHours(input: HoursInput & { days?: DayHours[] }) {
    const problem = hoursProblem(input.startMinutes, input.endMinutes, input.breakMinutes ?? 0)
        ?? dayHoursProblem(input.days ?? [], input.breakMinutes ?? 0)
    if (problem) fail(problem)
}

function serializeSchedule(s: Prisma.WorkScheduleGetPayload<{ include: typeof SCHEDULE_INCLUDE }>) {
    return {
        id: s.id,
        name: s.name,
        archivedAt: s.archivedAt,
        versions: s.versions.map(v => ({
            id: v.id,
            effectiveFrom: toDateString(v.effectiveFrom),
            startMinutes: v.startMinutes,
            endMinutes: v.endMinutes,
            breakMinutes: v.breakMinutes,
            workWeek: v.workWeek,
            days: v.days.map(d => ({ weekday: d.weekday, startMinutes: d.startMinutes, endMinutes: d.endMinutes })),
        })),
        overrides: s.overrides.map(o => ({
            id: o.id,
            name: o.name,
            startDate: toDateString(o.startDate),
            endDate: toDateString(o.endDate),
            startMinutes: o.startMinutes,
            endMinutes: o.endMinutes,
            breakMinutes: o.breakMinutes,
            days: o.days.map(d => ({ weekday: d.weekday, startMinutes: d.startMinutes, endMinutes: d.endMinutes })),
        })),
    }
}

/** People who still work there: the archived and deleted hold no schedule. */
const WORKING = { notIn: ["ARCHIVED", "DELETED"] as ("ARCHIVED" | "DELETED")[] }

/**
 * Serializes writes that must see each other: two overrides on one schedule,
 * an assignment and an archive of the same schedule, two default changes in
 * one company. A transaction-scoped Postgres advisory lock, released at
 * commit; the overlap and in-use checks run after it.
 */
export async function serialize(tx: Prisma.TransactionClient, key: string) {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))::text`
}

export class AttendanceCalendarService {
    /** The company's "today", the date a new version defaults to being measured from. */
    static async today(companyId: string): Promise<string> {
        const company = await prisma.company.findUnique({ where: { id: companyId }, select: { timezone: true } })
        return calendarDateStr(new Date(), company?.timezone ?? undefined)
    }

    /**
     * Refuses when any of these dates falls in a payroll month that is
     * approved or paid (§6.1). Dates are the company's own calendar dates, so
     * their year and month are the payroll run's.
     */
    static async assertUnlocked(companyId: string, dates: readonly string[]) {
        const months = [...new Set(dates.map(d => d.slice(0, 7)))].map(ym => ({ year: Number(ym.slice(0, 4)), month: Number(ym.slice(5, 7)) }))
        if (months.length === 0) return
        const locked = await prisma.payrollRun.findFirst({
            where: { companyId, status: { in: ["APPROVED", "PAID"] }, OR: months },
            select: { id: true },
        })
        if (locked) fail("PAYROLL_MONTH_LOCKED")
    }

    /**
     * Refuses when any payroll month a dated change governs is approved or
     * paid: from its date up to the next change of the same kind, or onwards
     * when none follows. Checking the start date alone let a change starting
     * in an open month rewrite a later locked one (review on #10).
     */
    static async assertSpanUnlocked(companyId: string, span: { from: string; until: string | null }, client: Prisma.TransactionClient | typeof prisma = prisma) {
        const first = span.from.slice(0, 7)
        const last = span.until ? addDays(span.until, -1).slice(0, 7) : null
        if (last !== null && last < first) return
        const runs = await client.payrollRun.findMany({
            where: { companyId, status: { in: ["APPROVED", "PAID"] } },
            select: { year: true, month: true },
        })
        for (const r of runs) {
            const ym = `${r.year}-${String(r.month).padStart(2, "0")}`
            if (ym >= first && (last === null || ym <= last)) fail("PAYROLL_MONTH_LOCKED")
        }
    }

    /** Everything the Attendance settings tab shows, for one year of holidays. */
    static async calendar(companyId: string, year: number) {
        const from = DATE_ONLY(`${year}-01-01`), to = DATE_ONLY(`${year}-12-31`)
        const [schedules, assignments, users, central, exclusions, own, today, defaults] = await Promise.all([
            prisma.workSchedule.findMany({ where: { companyId }, include: SCHEDULE_INCLUDE, orderBy: [{ archivedAt: "asc" }, { name: "asc" }] }),
            prisma.userSchedule.findMany({
                // This company's schedules only: somebody moved here from
                // another company keeps their old rows for the old company's
                // history, and they mean nothing here (review on #10).
                where: { user: { companyId }, schedule: { companyId } },
                select: { id: true, userId: true, scheduleId: true, effectiveFrom: true },
                orderBy: { effectiveFrom: "asc" },
            }),
            prisma.user.findMany({
                where: { companyId, status: { notIn: ["ARCHIVED", "DELETED"] } },
                select: { id: true, firstName: true, lastName: true, role: true },
                orderBy: [{ firstName: "asc" }, { lastName: "asc" }],
            }),
            prisma.publicHoliday.findMany({ where: { country: "EG", date: { gte: from, lte: to } }, orderBy: { date: "asc" } }),
            prisma.companyHolidayExclusion.findMany({ where: { companyId }, select: { publicHolidayId: true } }),
            prisma.companyHoliday.findMany({ where: { companyId, date: { gte: from, lte: to } }, orderBy: { date: "asc" } }),
            this.today(companyId),
            prisma.scheduleDefault.findMany({ where: { companyId }, orderBy: { effectiveFrom: "asc" } }),
        ])
        // The company's working days are its policy's (§6.2), Sunday to
        // Thursday until it sets one.
        const { AttendancePolicyService } = await import("./attendance-policy.service")
        const { workWeekOn } = await import("@/lib/attendance/policy")
        const policies = await AttendancePolicyService.versions(companyId)
        const excluded = new Set(exclusions.map(e => e.publicHolidayId))
        return {
            today,
            companyWorkWeek: workWeekOn(policies, today),
            schedules: schedules.map(serializeSchedule),
            defaults: defaults.map(d => ({ id: d.id, scheduleId: d.scheduleId, effectiveFrom: toDateString(d.effectiveFrom) })),
            assignments: assignments.map(a => ({ ...a, effectiveFrom: toDateString(a.effectiveFrom) })),
            people: users.map(u => ({ id: u.id, name: `${u.firstName} ${u.lastName}`.trim(), role: u.role })),
            holidays: {
                year,
                public: central.map(h => ({ id: h.id, date: toDateString(h.date), name: h.name, nameAr: h.nameAr, observed: !excluded.has(h.id) })),
                own: own.map(h => ({ id: h.id, date: toDateString(h.date), name: h.name, isPaid: h.isPaid })),
            },
        }
    }

    static async scheduleOf(scheduleId: string) {
        return prisma.workSchedule.findUnique({ where: { id: scheduleId }, select: { id: true, companyId: true, name: true, archivedAt: true } })
    }

    /**
     * A schedule with its first version. The company's first schedule becomes
     * its default from that version's date; a later one is made the default,
     * from a date, with setDefault.
     */
    static async createSchedule(companyId: string, input: { name: string; version: VersionInput }, actorId: string) {
        const name = input.name.trim()
        if (!name) fail("SCHEDULE_NAME_REQUIRED")
        this.checkVersion(input.version)

        return prisma.$transaction(async tx => {
            await serialize(tx, `defaults:${companyId}`)
            if (await tx.workSchedule.findUnique({ where: { companyId_name: { companyId, name } } })) fail("SCHEDULE_NAME_TAKEN")
            // A new schedule changes nobody's hours until people are put on it,
            // or it becomes the default; only the first one does, from its date.
            const isDefault = (await tx.scheduleDefault.count({ where: { companyId } })) === 0
            if (isDefault) await this.assertSpanUnlocked(companyId, { from: input.version.effectiveFrom, until: null }, tx)
            const schedule = await tx.workSchedule.create({
                data: { companyId, name, versions: { create: this.versionData(input.version, actorId) } },
                include: SCHEDULE_INCLUDE,
            })
            if (isDefault) {
                await tx.scheduleDefault.create({ data: { companyId, scheduleId: schedule.id, effectiveFrom: DATE_ONLY(input.version.effectiveFrom), createdById: actorId } })
            }
            await AuditLogService.log("CREATE_WORK_SCHEDULE", "ATTENDANCE_CALENDAR", schedule.id, { tx, ...(await actorOf(tx, actorId)), details: { companyId, name, isDefault, effectiveFrom: input.version.effectiveFrom } })
            return serializeSchedule(schedule)
        })
    }

    static async updateSchedule(scheduleId: string, input: { name?: string }, actorId: string) {
        const schedule = await this.scheduleOf(scheduleId) ?? fail("SCHEDULE_NOT_FOUND")
        if (schedule.archivedAt) fail("SCHEDULE_ARCHIVED")

        return prisma.$transaction(async tx => {
            const data: Prisma.WorkScheduleUpdateInput = {}
            if (input.name !== undefined) {
                const name = input.name.trim()
                if (!name) fail("SCHEDULE_NAME_REQUIRED")
                const clash = await tx.workSchedule.findUnique({ where: { companyId_name: { companyId: schedule.companyId, name } } })
                if (clash && clash.id !== scheduleId) fail("SCHEDULE_NAME_TAKEN")
                data.name = name
            }
            const updated = await tx.workSchedule.update({ where: { id: scheduleId }, data, include: SCHEDULE_INCLUDE })
            await AuditLogService.log("UPDATE_WORK_SCHEDULE", "ATTENDANCE_CALENDAR", scheduleId, { tx, ...(await actorOf(tx, actorId)), details: {
                companyId: schedule.companyId,
                ...(data.name ? { name: { from: schedule.name, to: data.name } } : {}),
            } })
            return serializeSchedule(updated)
        })
    }

    /**
     * Makes a schedule the company's default from a date (review on #10).
     * Unassigned people move to it on that date and not before; a change on a
     * date that already has one replaces it.
     */
    static async setDefault(scheduleId: string, effectiveFrom: string, actorId: string) {
        if (!isDateString(effectiveFrom)) fail("INVALID_DATE")
        const schedule = await this.scheduleOf(scheduleId) ?? fail("SCHEDULE_NOT_FOUND")
        if (schedule.archivedAt) fail("SCHEDULE_ARCHIVED")
        const companyId = schedule.companyId
        await prisma.$transaction(async tx => {
            await serialize(tx, `defaults:${companyId}`)
            const rows = await tx.scheduleDefault.findMany({ where: { companyId }, select: { effectiveFrom: true } })
            const dates = rows.map(r => toDateString(r.effectiveFrom)).filter(d => d !== effectiveFrom)
            await this.assertSpanUnlocked(companyId, spanOf(dates, effectiveFrom), tx)
            await tx.scheduleDefault.upsert({
                where: { companyId_effectiveFrom: { companyId, effectiveFrom: DATE_ONLY(effectiveFrom) } },
                create: { companyId, scheduleId, effectiveFrom: DATE_ONLY(effectiveFrom), createdById: actorId },
                update: { scheduleId, createdById: actorId },
            })
            await AuditLogService.log("SET_DEFAULT_SCHEDULE", "ATTENDANCE_CALENDAR", scheduleId, {
                tx, ...(await actorOf(tx, actorId)), details: { companyId, name: schedule.name, effectiveFrom },
            })
        })
    }

    static async defaultOf(defaultId: string) {
        return prisma.scheduleDefault.findUnique({ where: { id: defaultId }, select: { id: true, companyId: true, scheduleId: true, effectiveFrom: true } })
    }

    /**
     * Withdraws a change of default, while payroll has not locked the span it
     * governs. The first one stays: without it, nobody unassigned works any
     * schedule.
     */
    static async withdrawDefault(defaultId: string, actorId: string) {
        const row = await this.defaultOf(defaultId) ?? fail("DEFAULT_NOT_FOUND")
        const effectiveFrom = toDateString(row.effectiveFrom)
        await prisma.$transaction(async tx => {
            await serialize(tx, `defaults:${row.companyId}`)
            const rows = await tx.scheduleDefault.findMany({ where: { companyId: row.companyId }, select: { effectiveFrom: true } })
            const dates = rows.map(r => toDateString(r.effectiveFrom))
            if (!dates.some(d => d < effectiveFrom)) fail("SCHEDULE_DEFAULT_REQUIRED")
            await this.assertSpanUnlocked(row.companyId, spanOf(dates, effectiveFrom), tx)
            await tx.scheduleDefault.delete({ where: { id: defaultId } })
            await AuditLogService.log("WITHDRAW_DEFAULT_SCHEDULE", "ATTENDANCE_CALENDAR", row.scheduleId, {
                tx, ...(await actorOf(tx, actorId)), details: { companyId: row.companyId, effectiveFrom },
            })
        })
    }

    /**
     * Retired rather than deleted: past days were measured against it. Not the
     * default now or from any later date, and nobody still working may be on
     * it now or later. Checked under the schedule's lock, so an assignment
     * cannot slip in between the check and the archive.
     */
    static async archiveSchedule(scheduleId: string, actorId: string) {
        const schedule = await this.scheduleOf(scheduleId) ?? fail("SCHEDULE_NOT_FOUND")
        if (schedule.archivedAt) return
        const today = await this.today(schedule.companyId)
        await prisma.$transaction(async tx => {
            await serialize(tx, `schedule:${scheduleId}`)
            const defaults = (await tx.scheduleDefault.findMany({ where: { companyId: schedule.companyId } }))
                .map(d => ({ scheduleId: d.scheduleId, effectiveFrom: toDateString(d.effectiveFrom) }))
            if (defaultOn(defaults, today) === scheduleId || defaults.some(d => d.effectiveFrom > today && d.scheduleId === scheduleId)) fail("SCHEDULE_IS_DEFAULT")
            if (await this.peopleOnSchedule(schedule.companyId, scheduleId, today, tx)) fail("SCHEDULE_IN_USE")
            await tx.workSchedule.update({ where: { id: scheduleId }, data: { archivedAt: new Date() } })
            await AuditLogService.log("ARCHIVE_WORK_SCHEDULE", "ATTENDANCE_CALENDAR", scheduleId, { tx, ...(await actorOf(tx, actorId)), details: { companyId: schedule.companyId, name: schedule.name } })
        })
    }

    /**
     * How many people still working here are on this schedule today or from a
     * later date. The archived and deleted do not count: they are not on the
     * screen to be moved, so they cannot be what holds a schedule open.
     */
    static async peopleOnSchedule(companyId: string, scheduleId: string, today: string, client: Prisma.TransactionClient | typeof prisma = prisma): Promise<number> {
        const rows = await client.userSchedule.findMany({
            where: { user: { companyId, status: WORKING }, schedule: { companyId } },
            select: { userId: true, scheduleId: true, effectiveFrom: true },
            orderBy: { effectiveFrom: "asc" },
        })
        const current = new Map<string, string>()
        const later = new Set<string>()
        for (const r of rows) {
            const from = toDateString(r.effectiveFrom)
            if (from <= today) current.set(r.userId, r.scheduleId)
            else if (r.scheduleId === scheduleId) later.add(r.userId)
        }
        for (const [userId, id] of current) if (id === scheduleId) later.add(userId)
        return later.size
    }

    /** New hours from a date (§6.1). Earlier days keep the hours they had. */
    static async addVersion(scheduleId: string, input: VersionInput, actorId: string) {
        const schedule = await this.scheduleOf(scheduleId) ?? fail("SCHEDULE_NOT_FOUND")
        if (schedule.archivedAt) fail("SCHEDULE_ARCHIVED")
        this.checkVersion(input)
        return prisma.$transaction(async tx => {
            await serialize(tx, `schedule:${scheduleId}`)
            const dates = (await tx.scheduleVersion.findMany({ where: { scheduleId }, select: { effectiveFrom: true } })).map(v => toDateString(v.effectiveFrom))
            await this.assertSpanUnlocked(schedule.companyId, spanOf(dates, input.effectiveFrom), tx)
            const taken = await tx.scheduleVersion.findUnique({ where: { scheduleId_effectiveFrom: { scheduleId, effectiveFrom: DATE_ONLY(input.effectiveFrom) } } })
            if (taken) fail("VERSION_DATE_TAKEN")
            await tx.scheduleVersion.create({ data: { scheduleId, ...this.versionData(input, actorId) } })
            await AuditLogService.log("CREATE_SCHEDULE_VERSION", "ATTENDANCE_CALENDAR", scheduleId, { tx, ...(await actorOf(tx, actorId)), details: {
                companyId: schedule.companyId, name: schedule.name, effectiveFrom: input.effectiveFrom,
                hours: `${formatMinutes(input.startMinutes)}–${formatMinutes(input.endMinutes)}`,
            } })
            return serializeSchedule(await tx.workSchedule.findUniqueOrThrow({ where: { id: scheduleId }, include: SCHEDULE_INCLUDE }))
        })
    }

    /** Withdraws a version not yet locked by payroll. A schedule keeps at least one. */
    static async deleteVersion(versionId: string, actorId: string) {
        const version = await prisma.scheduleVersion.findUnique({
            where: { id: versionId },
            select: { id: true, effectiveFrom: true, schedule: { select: { id: true, companyId: true, name: true, _count: { select: { versions: true } } } } },
        }) ?? fail("VERSION_NOT_FOUND")
        if (version.schedule._count.versions <= 1) fail("LAST_VERSION")
        const effectiveFrom = toDateString(version.effectiveFrom)
        await prisma.$transaction(async tx => {
            await serialize(tx, `schedule:${version.schedule.id}`)
            // Its span goes back to the version before it, up to the next one.
            const dates = (await tx.scheduleVersion.findMany({ where: { scheduleId: version.schedule.id }, select: { effectiveFrom: true } })).map(v => toDateString(v.effectiveFrom))
            await this.assertSpanUnlocked(version.schedule.companyId, spanOf(dates, effectiveFrom), tx)
            await tx.scheduleVersion.delete({ where: { id: versionId } })
            await AuditLogService.log("DELETE_SCHEDULE_VERSION", "ATTENDANCE_CALENDAR", version.schedule.id, { tx, ...(await actorOf(tx, actorId)), details: {
                companyId: version.schedule.companyId, name: version.schedule.name, effectiveFrom,
            } })
        })
    }

    static async versionOf(versionId: string) {
        return prisma.scheduleVersion.findUnique({ where: { id: versionId }, select: { schedule: { select: { companyId: true } } } })
    }

    /** Dated hours over a schedule: Ramadan (§7.1). Never two on one day. */
    static async createOverride(scheduleId: string, input: OverrideInput, actorId: string) {
        const schedule = await this.scheduleOf(scheduleId) ?? fail("SCHEDULE_NOT_FOUND")
        if (schedule.archivedAt) fail("SCHEDULE_ARCHIVED")
        this.checkOverride(input)
        await this.assertUnlocked(schedule.companyId, this.monthsBetween(input.startDate, input.endDate))
        return prisma.$transaction(async tx => {
            await serialize(tx, `schedule:${scheduleId}`)
            await this.assertNoOverlap(tx, scheduleId, input, null)
            const created = await tx.scheduleOverride.create({ data: { scheduleId, ...this.overrideData(input), createdById: actorId } })
            await AuditLogService.log("CREATE_SCHEDULE_OVERRIDE", "ATTENDANCE_CALENDAR", created.id, { tx, ...(await actorOf(tx, actorId)), details: {
                companyId: schedule.companyId, name: input.name.trim(), startDate: input.startDate, endDate: input.endDate,
            } })
            return serializeSchedule(await tx.workSchedule.findUniqueOrThrow({ where: { id: scheduleId }, include: SCHEDULE_INCLUDE }))
        })
    }

    static async overrideOf(overrideId: string) {
        return prisma.scheduleOverride.findUnique({
            where: { id: overrideId },
            select: { id: true, scheduleId: true, name: true, startDate: true, endDate: true, schedule: { select: { companyId: true } } },
        })
    }

    /**
     * Ramadan's dates are confirmed late, so an override stays editable until
     * payroll locks a month it touches — its old dates and its new ones.
     */
    static async updateOverride(overrideId: string, input: OverrideInput, actorId: string) {
        const existing = await this.overrideOf(overrideId) ?? fail("OVERRIDE_NOT_FOUND")
        this.checkOverride(input)
        const companyId = existing.schedule.companyId
        await this.assertUnlocked(companyId, [
            ...this.monthsBetween(toDateString(existing.startDate), toDateString(existing.endDate)),
            ...this.monthsBetween(input.startDate, input.endDate),
        ])
        return prisma.$transaction(async tx => {
            await serialize(tx, `schedule:${existing.scheduleId}`)
            await this.assertNoOverlap(tx, existing.scheduleId, input, overrideId)
            await tx.scheduleOverrideDay.deleteMany({ where: { overrideId } })
            await tx.scheduleOverride.update({ where: { id: overrideId }, data: this.overrideData(input) })
            await AuditLogService.log("UPDATE_SCHEDULE_OVERRIDE", "ATTENDANCE_CALENDAR", overrideId, { tx, ...(await actorOf(tx, actorId)), details: {
                companyId, name: input.name.trim(),
                startDate: { from: toDateString(existing.startDate), to: input.startDate },
                endDate: { from: toDateString(existing.endDate), to: input.endDate },
            } })
            return serializeSchedule(await tx.workSchedule.findUniqueOrThrow({ where: { id: existing.scheduleId }, include: SCHEDULE_INCLUDE }))
        })
    }

    static async deleteOverride(overrideId: string, actorId: string) {
        const existing = await this.overrideOf(overrideId) ?? fail("OVERRIDE_NOT_FOUND")
        const companyId = existing.schedule.companyId
        await this.assertUnlocked(companyId, this.monthsBetween(toDateString(existing.startDate), toDateString(existing.endDate)))
        await prisma.$transaction(async tx => {
            await tx.scheduleOverride.delete({ where: { id: overrideId } })
            await AuditLogService.log("DELETE_SCHEDULE_OVERRIDE", "ATTENDANCE_CALENDAR", overrideId, { tx, ...(await actorOf(tx, actorId)), details: {
                companyId, name: existing.name, startDate: toDateString(existing.startDate), endDate: toDateString(existing.endDate),
            } })
        })
    }

    /** Puts people on a schedule from a date. A second assignment on the same date replaces the first. */
    static async assign(companyId: string, input: { userIds: string[]; scheduleId: string; effectiveFrom: string }, actorId: string) {
        if (!isDateString(input.effectiveFrom)) fail("INVALID_DATE")
        const userIds = [...new Set(input.userIds)]
        if (userIds.length === 0) fail("NOBODY_TO_ASSIGN")
        const schedule = await this.scheduleOf(input.scheduleId)
        if (!schedule || schedule.companyId !== companyId) fail("SCHEDULE_NOT_FOUND")
        const people = await prisma.user.count({ where: { id: { in: userIds }, companyId } })
        if (people !== userIds.length) fail("USER_NOT_IN_COMPANY")

        const effectiveFrom = DATE_ONLY(input.effectiveFrom)
        await prisma.$transaction(async tx => {
            // Under the schedule's lock, and re-read under it: an archive that
            // committed a moment ago must be seen.
            await serialize(tx, `schedule:${input.scheduleId}`)
            const current = await tx.workSchedule.findUnique({ where: { id: input.scheduleId }, select: { archivedAt: true } })
            if (current?.archivedAt) fail("SCHEDULE_ARCHIVED")
            // Each person's move governs their dates up to their next one.
            const theirs = await tx.userSchedule.findMany({ where: { userId: { in: userIds }, schedule: { companyId } }, select: { userId: true, effectiveFrom: true } })
            for (const userId of userIds) {
                const dates = theirs.filter(a => a.userId === userId).map(a => toDateString(a.effectiveFrom)).filter(d => d !== input.effectiveFrom)
                await this.assertSpanUnlocked(companyId, spanOf(dates, input.effectiveFrom), tx)
            }
            for (const userId of userIds) {
                await tx.userSchedule.upsert({
                    where: { userId_effectiveFrom: { userId, effectiveFrom } },
                    create: { userId, scheduleId: input.scheduleId, effectiveFrom, createdById: actorId },
                    update: { scheduleId: input.scheduleId, createdById: actorId },
                })
            }
            await AuditLogService.log("ASSIGN_WORK_SCHEDULE", "ATTENDANCE_CALENDAR", input.scheduleId, { tx, ...(await actorOf(tx, actorId)), details: {
                companyId, name: schedule.name, effectiveFrom: input.effectiveFrom, people: userIds.length,
            } })
        })
    }

    static async assignmentOf(assignmentId: string) {
        return prisma.userSchedule.findUnique({
            where: { id: assignmentId },
            select: { id: true, userId: true, effectiveFrom: true, scheduleId: true, user: { select: { companyId: true } } },
        })
    }

    static async removeAssignment(assignmentId: string, actorId: string) {
        const existing = await this.assignmentOf(assignmentId) ?? fail("ASSIGNMENT_NOT_FOUND")
        const companyId = existing.user.companyId ?? fail("ASSIGNMENT_NOT_FOUND")
        const effectiveFrom = toDateString(existing.effectiveFrom)
        await prisma.$transaction(async tx => {
            // Its span falls back to the move before it, up to the next one.
            const dates = (await tx.userSchedule.findMany({ where: { userId: existing.userId }, select: { effectiveFrom: true } })).map(a => toDateString(a.effectiveFrom))
            await this.assertSpanUnlocked(companyId, spanOf(dates, effectiveFrom), tx)
            await tx.userSchedule.delete({ where: { id: assignmentId } })
            await AuditLogService.log("UNASSIGN_WORK_SCHEDULE", "ATTENDANCE_CALENDAR", existing.scheduleId, { tx, ...(await actorOf(tx, actorId)), details: { companyId, effectiveFrom } })
        })
    }

    /** A company's own holiday (§7.2). */
    static async addHoliday(companyId: string, input: { date: string; name: string; isPaid?: boolean }, actorId: string) {
        if (!isDateString(input.date)) fail("INVALID_DATE")
        const name = input.name.trim()
        if (!name) fail("HOLIDAY_NAME_REQUIRED")
        await this.assertUnlocked(companyId, [input.date])
        return prisma.$transaction(async tx => {
            if (await tx.companyHoliday.findUnique({ where: { companyId_date: { companyId, date: DATE_ONLY(input.date) } } })) fail("HOLIDAY_DATE_TAKEN")
            const created = await tx.companyHoliday.create({ data: { companyId, date: DATE_ONLY(input.date), name, isPaid: input.isPaid ?? true } })
            await AuditLogService.log("CREATE_COMPANY_HOLIDAY", "ATTENDANCE_CALENDAR", created.id, { tx, ...(await actorOf(tx, actorId)), details: { companyId, name, date: input.date, isPaid: created.isPaid } })
            return { id: created.id, date: input.date, name, isPaid: created.isPaid }
        })
    }

    static async holidayOf(holidayId: string) {
        return prisma.companyHoliday.findUnique({ where: { id: holidayId }, select: { id: true, companyId: true, date: true, name: true } })
    }

    static async deleteHoliday(holidayId: string, actorId: string) {
        const holiday = await this.holidayOf(holidayId) ?? fail("HOLIDAY_NOT_FOUND")
        const date = toDateString(holiday.date)
        await this.assertUnlocked(holiday.companyId, [date])
        await prisma.$transaction(async tx => {
            await tx.companyHoliday.delete({ where: { id: holidayId } })
            await AuditLogService.log("DELETE_COMPANY_HOLIDAY", "ATTENDANCE_CALENDAR", holidayId, { tx, ...(await actorOf(tx, actorId)), details: { companyId: holiday.companyId, name: holiday.name, date } })
        })
    }

    /**
     * Whether the company observes a central holiday. Stored as an exclusion
     * against the holiday, not its date, so a holiday moved by decree stays
     * opted out (§7.2).
     */
    static async setObserved(companyId: string, publicHolidayId: string, observed: boolean, actorId: string) {
        const holiday = await prisma.publicHoliday.findUnique({ where: { id: publicHolidayId }, select: { id: true, date: true, name: true } })
            ?? fail("HOLIDAY_NOT_FOUND")
        const date = toDateString(holiday.date)
        await this.assertUnlocked(companyId, [date])
        await prisma.$transaction(async tx => {
            const key = { companyId_publicHolidayId: { companyId, publicHolidayId } }
            if (observed) await tx.companyHolidayExclusion.deleteMany({ where: { companyId, publicHolidayId } })
            else await tx.companyHolidayExclusion.upsert({ where: key, create: { companyId, publicHolidayId }, update: {} })
            await AuditLogService.log(observed ? "OBSERVE_PUBLIC_HOLIDAY" : "SKIP_PUBLIC_HOLIDAY", "ATTENDANCE_CALENDAR", publicHolidayId, { tx, ...(await actorOf(tx, actorId)), details: { companyId, name: holiday.name, date } })
        })
    }

    // --- helpers -----------------------------------------------------------

    private static checkVersion(input: VersionInput) {
        if (!isDateString(input.effectiveFrom)) fail("INVALID_DATE")
        checkHours(input)
        const problem = workWeekProblem(input.workWeek ?? [], { allowEmpty: true })
        if (problem) fail(problem)
    }

    private static checkOverride(input: OverrideInput) {
        if (!input.name?.trim()) fail("OVERRIDE_NAME_REQUIRED")
        if (!isDateString(input.startDate) || !isDateString(input.endDate)) fail("INVALID_DATE")
        if (input.endDate < input.startDate) fail("OVERRIDE_ENDS_BEFORE_START")
        checkHours(input)
    }

    private static versionData(input: VersionInput, actorId: string) {
        return {
            effectiveFrom: DATE_ONLY(input.effectiveFrom),
            createdById: actorId,
            startMinutes: input.startMinutes,
            endMinutes: input.endMinutes,
            breakMinutes: input.breakMinutes ?? 0,
            workWeek: [...new Set(input.workWeek ?? [])].sort(),
            days: { create: (input.days ?? []).map(d => ({ weekday: d.weekday, startMinutes: d.startMinutes, endMinutes: d.endMinutes })) },
        }
    }

    private static overrideData(input: OverrideInput) {
        return {
            name: input.name.trim(),
            startDate: DATE_ONLY(input.startDate),
            endDate: DATE_ONLY(input.endDate),
            startMinutes: input.startMinutes,
            endMinutes: input.endMinutes,
            breakMinutes: input.breakMinutes ?? 0,
            days: { create: (input.days ?? []).map(d => ({ weekday: d.weekday, startMinutes: d.startMinutes, endMinutes: d.endMinutes })) },
        }
    }

    /** The first day of every month a span touches, for the payroll lock. */
    private static monthsBetween(start: string, end: string): string[] {
        const out: string[] = []
        let y = Number(start.slice(0, 4)), m = Number(start.slice(5, 7))
        const endY = Number(end.slice(0, 4)), endM = Number(end.slice(5, 7))
        while (y < endY || (y === endY && m <= endM)) {
            out.push(`${y}-${String(m).padStart(2, "0")}-01`)
            if (++m > 12) { m = 1; y++ }
            if (out.length > 120) break
        }
        return out
    }

    private static async assertNoOverlap(tx: Prisma.TransactionClient, scheduleId: string, input: OverrideInput, ignoreId: string | null) {
        const others = await tx.scheduleOverride.findMany({
            where: { scheduleId, ...(ignoreId ? { id: { not: ignoreId } } : {}) },
            select: { startDate: true, endDate: true },
        })
        for (const other of others) {
            if (overridesOverlap(input, { startDate: toDateString(other.startDate), endDate: toDateString(other.endDate) })) fail("OVERRIDE_OVERLAPS")
        }
    }

}

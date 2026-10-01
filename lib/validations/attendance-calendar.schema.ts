import { z } from "zod"

/**
 * Shapes only. Whether hours make a shift, a work week is real, or a date is
 * locked by payroll is the service's to say (lib/attendance/calendar.ts), in
 * the same words whichever route asks.
 */

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected a date as YYYY-MM-DD")
const minutes = z.number().int()
const day = z.object({ weekday: z.number().int(), startMinutes: minutes, endMinutes: minutes })

export const hoursSchema = z.object({
    startMinutes: minutes,
    endMinutes: minutes,
    breakMinutes: minutes.optional(),
})

export const versionSchema = hoursSchema.extend({
    effectiveFrom: date,
    workWeek: z.array(z.number().int()).max(7).optional(),
    days: z.array(day).max(7).optional(),
})

export const createScheduleSchema = z.object({
    companyId: z.string().optional(),
    name: z.string().min(1).max(80),
    version: versionSchema,
})

export const updateScheduleSchema = z.object({
    name: z.string().min(1).max(80).optional(),
})

/** Make a schedule the company's default from a date. */
export const setDefaultSchema = z.object({ effectiveFrom: date })

export const overrideSchema = hoursSchema.extend({
    name: z.string().min(1).max(80),
    startDate: date,
    endDate: date,
    days: z.array(day).max(7).optional(),
})

export const assignSchema = z.object({
    companyId: z.string().optional(),
    userIds: z.array(z.string().min(1)).min(1).max(1000),
    scheduleId: z.string().min(1),
    effectiveFrom: date,
})

export const companyHolidaySchema = z.object({
    companyId: z.string().optional(),
    date,
    name: z.string().min(1).max(120),
    isPaid: z.boolean().optional(),
})

export const observedSchema = z.object({
    companyId: z.string().optional(),
    publicHolidayId: z.string().min(1),
    observed: z.boolean(),
})

export const publicHolidaySchema = z.object({
    date,
    name: z.string().min(1).max(120),
    nameAr: z.string().max(120).nullable().optional(),
})

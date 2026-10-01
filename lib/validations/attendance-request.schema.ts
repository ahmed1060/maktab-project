import { z } from "zod"

/** Shapes only; the request service says what is allowed (lib/services/attendance-request.service.ts). */

const time = z.string().regex(/^\d{2}:\d{2}$/, "Expected a time as HH:MM")
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected a date as YYYY-MM-DD")

export const permissionRequestSchema = z.object({
    date,
    type: z.enum(["LATE_ARRIVAL", "EARLY_LEAVE", "MIDDAY"]),
    start: time,
    end: time,
    reason: z.string().max(500),
})

export const missingPunchSchema = z.object({
    at: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, "Expected a time as YYYY-MM-DDTHH:MM"),
    direction: z.enum(["IN", "OUT"]).nullable(),
    reason: z.string().max(500),
})

export const decisionSchema = z.object({
    approve: z.boolean(),
    reason: z.string().max(500).nullable().optional(),
})

export const overtimeDecisionSchema = z.object({
    companyId: z.string().optional(),
    userId: z.string().min(1),
    date,
    status: z.enum(["APPROVED", "REJECTED"]),
    minutes: z.number().int().min(1).max(1440).nullable().optional(),
    note: z.string().max(500).nullable().optional(),
})

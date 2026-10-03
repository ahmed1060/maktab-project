import { z } from "zod"

/** Shapes only; the punch service says what is allowed (lib/services/attendance-punch.service.ts). */

export const manualPunchSchema = z.object({
    companyId: z.string().optional(),
    userId: z.string().min(1),
    /** The wall-clock time where it happened: YYYY-MM-DDTHH:MM. */
    at: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/, "Expected a time as YYYY-MM-DDTHH:MM"),
    direction: z.enum(["IN", "OUT"]).nullable(),
    note: z.string().max(500),
})

export const reasonSchema = z.object({ reason: z.string().max(500) })

export const mapCodeSchema = z.object({
    companyId: z.string().optional(),
    code: z.string().min(1).max(40),
    userId: z.string().min(1),
})

const column = z.number().int().min(0).max(200)
export const columnMapSchema = z.object({ code: column, date: column, time: column.nullable(), direction: column.nullable() })

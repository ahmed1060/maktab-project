import { z } from "zod"

export const createDayOffSchema = z.object({
    date: z.string().refine((val) => !isNaN(Date.parse(val)), {
        message: "Invalid start date",
    }),
    endDate: z.string().optional().refine((val) => !val || !isNaN(Date.parse(val)), {
        message: "Invalid end date",
    }),
    type: z.enum(['REGULAR', 'SICK', 'EMERGENCY', 'UNPAID']),
    reason: z.string().max(100, "Reason must be 100 characters or less").optional(),
})


export const adminUpdateDayOffSchema = z.object({
    status: z.enum(['APPROVED', 'REJECTED']),
    daysToDeduct: z.union([z.number(), z.string()]).optional(),
    deductionType: z.enum(['CREDIT', 'SALARY']).optional(),
})

export type CreateDayOffInput = z.infer<typeof createDayOffSchema>
export type AdminUpdateDayOffInput = z.infer<typeof adminUpdateDayOffSchema>

import { z } from "zod"

export const createObligationSchema = z.object({
    title: z.string().min(3).max(100),
    description: z.string().min(10).max(1000),
    assigneeIds: z.array(z.string()).min(1, "At least one assignee required"),
    deadline: z.string().refine((val) => !isNaN(Date.parse(val)), { message: "Invalid date format" }),
    recurrence: z.enum(['ONE_TIME', 'DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY']).optional().default('ONE_TIME'),
    difficulty: z.coerce.number().min(0).max(10).optional().default(0),
    attachments: z.any().optional(),
})

export const updateObligationSchema = createObligationSchema.partial().extend({
    id: z.string().min(1, "Obligation ID is required"),
    status: z.enum(['PENDING', 'IN_PROGRESS', 'COMPLETED', 'ARCHIVED']).optional(),
})

export type CreateObligationInput = z.infer<typeof createObligationSchema>
export type UpdateObligationInput = z.infer<typeof updateObligationSchema>

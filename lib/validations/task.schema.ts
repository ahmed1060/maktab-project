import { z } from "zod"

/**
 * createTaskSchema
 * 
 * Shared validation logic for creating a new task.
 */
export const createTaskSchema = z.object({
    title: z.string()
        .min(3, "Title must be at least 3 characters")
        .max(100, "Title cannot exceed 100 characters"),
    description: z.string()
        .min(10, "Description must be at least 10 characters")
        .max(1000, "Description cannot exceed 1000 characters"),
    assigneeIds: z.array(z.string())
        .min(1, "At least one assignee is required"),
    deadline: z.string()
        .refine((val) => !isNaN(Date.parse(val)), {
            message: "Invalid deadline date format",
        }),
    difficulty: z.number()
        .min(0).max(10)
        .optional()
        .default(0),
    location: z.any().optional(),
    attachments: z.any().optional(), // Can be stringified JSON or array
})

export const updateTaskSchema = createTaskSchema.partial().extend({
    id: z.string().min(1, "Task ID is required"),
})

export type CreateTaskInput = z.infer<typeof createTaskSchema>
export type UpdateTaskInput = z.infer<typeof updateTaskSchema>

import { z } from "zod"
import { partialWithoutDefaults } from "./partial-update"

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
    // Typed by hand before locations; ignored now (CLIENTS_PLAN.md §2.3).
    // Still read by bulk import until its review screen picks locations too.
    location: z.any().optional(),
    // The task's client, if it has one, and where it's done: that client's
    // location or a shared one. TaskService checks both against the task's
    // company, and writes the location's name and map link as its text.
    clientId: z.string().optional().nullable(),
    locationId: z.string().min(1).optional(),
    attachments: z.any().optional(), // Can be stringified JSON or array
})

export const updateTaskSchema = partialWithoutDefaults(createTaskSchema).extend({
    id: z.string().min(1, "Task ID is required"),
})

export type CreateTaskInput = z.infer<typeof createTaskSchema>
export type UpdateTaskInput = z.infer<typeof updateTaskSchema>

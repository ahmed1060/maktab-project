import { z } from "zod"

export const createClientSchema = z.object({
    name: z.string().min(2, "Name must be at least 2 characters").max(100),
    companyId: z.string().optional(),
})

export const updateClientSchema = z.object({
    id: z.string().min(1, "Client ID is required"),
    name: z.string().min(2, "Name must be at least 2 characters").max(100),
})

export type CreateClientInput = z.infer<typeof createClientSchema>
export type UpdateClientInput = z.infer<typeof updateClientSchema>

import { z } from "zod"
import { placeSchema } from "./location.schema"

// Permissive on purpose — a phone number field that's too strict about
// format (country codes, spacing, dashes) rejects real numbers more often
// than it catches typos. Just bounds the length and blocks obviously wrong
// input (letters).
const mobileNumberSchema = z.string()
    .min(6, "Mobile number is too short")
    .max(20, "Mobile number is too long")
    .regex(/^[0-9+\-\s()]+$/, "Mobile number can only contain digits, spaces, and + - ( )")

export const createClientSchema = z.object({
    name: z.string().min(1, "Client name is required").max(100),
    ownerName: z.string().min(1, "Owner name is required").max(100),
    mobileNumber: mobileNumberSchema,
    /** Its HQ (CLIENTS_PLAN.md §2.1): every client has one, with its pin. */
    hq: placeSchema,
    companyId: z.string().optional(),
})

export const updateClientSchema = z.object({
    id: z.string().min(1, "Client ID is required"),
    name: z.string().min(1, "Client name is required").max(100).optional(),
    ownerName: z.string().min(1, "Owner name is required").max(100).optional(),
    mobileNumber: mobileNumberSchema.optional(),
    hq: placeSchema.optional(),
})

export type CreateClientInput = z.infer<typeof createClientSchema>
export type UpdateClientInput = z.infer<typeof updateClientSchema>

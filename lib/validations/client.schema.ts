import { z } from "zod"
import { placeSchema } from "./location.schema"
import { nameIn } from "./arabic-name.schema"
import { CLIENT_NAME_MAX, OWNER_NAME_MAX } from "@/lib/client-form"

// Permissive on purpose — a phone number field that's too strict about
// format (country codes, spacing, dashes) rejects real numbers more often
// than it catches typos. Just bounds the length and blocks obviously wrong
// input (letters).
const mobileNumberSchema = z.string()
    .min(6, "Mobile number is too short")
    .max(20, "Mobile number is too long")
    .regex(/^[0-9+\-\s()]+$/, "Mobile number can only contain digits, spaces, and + - ( )")

export const createClientSchema = z.object({
    // Its name and its owner's, each in English and in Arabic, both needed,
    // each in its own letters (LATER_CHANGES_PLAN.md §3.1, step 6a, PR 406;
    // DESIGN.md §5.3): its own up to 100 characters, as before, and its
    // owner's up to 60, the owner's answer of 2026-11-24 (lib/client-form.ts).
    name: nameIn("English", CLIENT_NAME_MAX),
    nameAr: nameIn("Arabic", CLIENT_NAME_MAX),
    ownerName: nameIn("English", OWNER_NAME_MAX),
    ownerNameAr: nameIn("Arabic", OWNER_NAME_MAX),
    mobileNumber: mobileNumberSchema,
    /** Its HQ (CLIENTS_PLAN.md §2.1): every client has one, with its pin. */
    hq: placeSchema,
    companyId: z.string().optional(),
})

export const updateClientSchema = z.object({
    id: z.string().min(1, "Client ID is required"),
    // Each as a new client's: a name's English with its Arabic, sent or kept,
    // is ClientService.update's to ask (PR 406); its Arabic alone may be added.
    name: nameIn("English", CLIENT_NAME_MAX).optional(),
    nameAr: nameIn("Arabic", CLIENT_NAME_MAX).optional(),
    ownerName: nameIn("English", OWNER_NAME_MAX).optional(),
    ownerNameAr: nameIn("Arabic", OWNER_NAME_MAX).optional(),
    mobileNumber: mobileNumberSchema.optional(),
    hq: placeSchema.optional(),
    /** Back from the archive (CLIENTS_PLAN.md §4.3); nothing else changes with it. */
    restore: z.literal(true).optional(),
})

export type CreateClientInput = z.infer<typeof createClientSchema>
export type UpdateClientInput = z.infer<typeof updateClientSchema>

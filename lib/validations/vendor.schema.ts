import { z } from "zod"

// Permissive on purpose — a phone number field that's too strict about
// format (country codes, spacing, dashes) rejects real numbers more often
// than it catches typos. Just bounds the length and blocks obviously wrong
// input (letters).
const mobileNumberSchema = z.string()
    .min(6, "Mobile number is too short")
    .max(20, "Mobile number is too long")
    .regex(/^[0-9+\-\s()]+$/, "Mobile number can only contain digits, spaces, and + - ( )")

export const createVendorSchema = z.object({
    name: z.string().min(1, "Vendor name is required").max(100),
    ownerName: z.string().min(1, "Owner name is required").max(100),
    mobileNumber: mobileNumberSchema,
    locationName: z.string().min(1, "Location is required").max(200),
    locationLink: z.string().url().optional().or(z.literal('')),
    companyId: z.string().optional(),
})

export const updateVendorSchema = z.object({
    id: z.string().min(1, "Vendor ID is required"),
    name: z.string().min(1, "Vendor name is required").max(100).optional(),
    ownerName: z.string().min(1, "Owner name is required").max(100).optional(),
    mobileNumber: mobileNumberSchema.optional(),
    locationName: z.string().min(1, "Location is required").max(200).optional(),
    locationLink: z.string().url().optional().or(z.literal('')),
})

export type CreateVendorInput = z.infer<typeof createVendorSchema>
export type UpdateVendorInput = z.infer<typeof updateVendorSchema>

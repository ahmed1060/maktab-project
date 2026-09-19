import { z } from "zod"

// Prices are entered as numbers in the form but stored as Decimal(12,2) — the
// same treatment CompanyPayment.cost already gets, so money never passes
// through a float in the database. Two decimal places is the storage precision,
// so anything finer is rejected here rather than silently rounded.
const priceSchema = z.number()
    .nonnegative("Price cannot be negative")
    .max(9_999_999_999, "Price is too large")
    // Deliberately not `Math.round(v * 100) === v * 100`, which was here and is
    // itself floating-point arithmetic: 2499.99 * 100 is 249998.99999999997 in
    // IEEE-754, so it failed its own check. So did 8.29, and so did seven cents.
    // The multiplication is the bug, not the rounding — toFixed formats the
    // value at two places without one, and parsing it back says whether
    // anything was lost.
    .refine(v => Number.isFinite(v) && Number(v.toFixed(2)) === v, {
        message: "Price cannot have more than two decimal places",
    })

const bundlesSchema = {
    hasCompanyManagement: z.boolean(),
    hasHR: z.boolean(),
}

// A package with neither bundle is Core only — a real thing to sell, since Core
// carries the directory, accounts, requests and notifications. It is allowed,
// but it is worth being deliberate about: see the service, which audit-logs it.
export const createPackageSchema = z.object({
    name: z.string().min(1, "Package name is required").max(80),
    description: z.string().max(500).optional().or(z.literal('')),
    isActive: z.boolean().optional().default(true),
    isPublic: z.boolean().optional().default(true),
    priceMonthly: priceSchema,
    priceAnnual: priceSchema,
    // Null means this package is not sold as a lifetime purchase at all, which
    // is a different statement from being sold for nothing.
    priceLifetime: priceSchema.nullable().optional(),
    ...bundlesSchema,
})

export const updatePackageSchema = z.object({
    id: z.string().min(1, "Package ID is required"),
    name: z.string().min(1).max(80).optional(),
    description: z.string().max(500).optional().or(z.literal('')),
    isActive: z.boolean().optional(),
    isPublic: z.boolean().optional(),
    priceMonthly: priceSchema.optional(),
    priceAnnual: priceSchema.optional(),
    priceLifetime: priceSchema.nullable().optional(),
    hasCompanyManagement: z.boolean().optional(),
    hasHR: z.boolean().optional(),
})

export type CreatePackageInput = z.infer<typeof createPackageSchema>
export type UpdatePackageInput = z.infer<typeof updatePackageSchema>

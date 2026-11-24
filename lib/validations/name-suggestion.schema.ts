import { z } from "zod"

/**
 * A name's suggestion, asked (LATER_CHANGES_PLAN.md §3.1, step 3b, PR 401):
 * the name typed, up to a client's name's 100 characters, the language it's
 * wanted in, and whether it's a person's name or a business's.
 */
export const nameSuggestionSchema = z.object({
    name: z.string().trim().min(1).max(100),
    to: z.enum(["en", "ar"]),
    kind: z.enum(["person", "business"]),
})

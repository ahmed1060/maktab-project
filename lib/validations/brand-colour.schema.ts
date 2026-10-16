import { z } from "zod"
import { readBrandHex } from "@/lib/brand-colour"

/**
 * A brand colour code (UI_PLAN.md §4.6), stored as #rrggbb in lower case. A
 * code typed with or without #, or in three digits, is read as that; anything
 * else is refused with a reason the form can show.
 */
export const brandColourSchema = z.string().transform((value, ctx) => {
    const hex = readBrandHex(value)
    if (!hex) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Not a colour code. Use one like #2563eb." })
        return z.NEVER
    }
    return hex
})

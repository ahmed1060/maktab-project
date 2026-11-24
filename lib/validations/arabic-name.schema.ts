import { z } from "zod"
import { hasArabic, writtenInArabic } from "@/lib/names"

/**
 * A name in Arabic, beside its English (LATER_CHANGES_PLAN.md §3, PR 398):
 * trimmed, in Arabic letters with no English ones, and as long as the
 * English may be.
 */
export const arabicName = (min: number, max: number) =>
    z.string().trim().min(min).max(max).refine(writtenInArabic, "Written in Arabic letters")

/**
 * A name in one language, asked for (LATER_CHANGES_PLAN.md §3.1, PR 404,
 * 406): needed, trimmed, from `min` characters (a company's from 2, PR 408)
 * up to `max`, and in that language's letters. What's wrong is said as a
 * form reads it: "Needed", "letters", "Too short", or else too long. Its
 * letters and length aren't asked of an empty one, which is only needed.
 */
export const nameIn = (language: "English" | "Arabic", max: number, min = 1) =>
    z.string({ error: `Needed in ${language}` }).trim()
        .min(1, `Needed in ${language}`)
        .max(max, "Too long")
        .refine(name => !name || name.length >= min, "Too short")
        .refine(name => !name || (language === "English" ? !hasArabic(name) : writtenInArabic(name)), `Written in ${language} letters`)

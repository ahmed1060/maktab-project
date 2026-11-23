import { z } from "zod"
import { writtenInArabic } from "@/lib/names"

/**
 * A name in Arabic, beside its English (LATER_CHANGES_PLAN.md §3, PR 398):
 * trimmed, in Arabic letters with no English ones, and as long as the
 * English may be.
 */
export const arabicName = (min: number, max: number) =>
    z.string().trim().min(min).max(max).refine(writtenInArabic, "Written in Arabic letters")

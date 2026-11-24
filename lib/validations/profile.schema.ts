import { z } from "zod"
import { NAME_MAX } from "@/lib/new-employee-form"
import { hasArabic, writtenInArabic } from "@/lib/names"

/**
 * A name asked for, in one language (LATER_CHANGES_PLAN.md §3.1, step 4c, PR
 * 404): needed, trimmed, up to a person's name's limit, and in that
 * language's letters. What's wrong is said as the profile's form reads it
 * (lib/profile-form.ts, askedNameRefused): "Needed", "letters", or else too
 * long. Its letters aren't asked of an empty one, which is only needed.
 */
const askedIn = (language: "English" | "Arabic", inItsLetters: (name: string) => boolean) =>
    z.string({ error: `Needed in ${language}` }).trim()
        .min(1, `Needed in ${language}`)
        .max(NAME_MAX, "Too long")
        .refine(name => !name || inItsLetters(name), `Written in ${language} letters`)

/** A request to change one's own name: each name in English and in Arabic. */
export const createProfileRequestSchema = z.object({
    newFirstName: askedIn("English", name => !hasArabic(name)),
    newFirstNameAr: askedIn("Arabic", writtenInArabic),
    newLastName: askedIn("English", name => !hasArabic(name)),
    newLastNameAr: askedIn("Arabic", writtenInArabic),
})

export type CreateProfileRequestInput = z.infer<typeof createProfileRequestSchema>

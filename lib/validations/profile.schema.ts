import { z } from "zod"
import { NAME_MAX } from "@/lib/new-employee-form"
import { nameIn } from "./arabic-name.schema"

/** A request to change one's own name: each name in English and in Arabic. */
export const createProfileRequestSchema = z.object({
    // Each up to a person's name's limit (PR 404), said as the profile's form
    // reads it (lib/profile-form.ts, askedNameRefused).
    newFirstName: nameIn("English", NAME_MAX),
    newFirstNameAr: nameIn("Arabic", NAME_MAX),
    newLastName: nameIn("English", NAME_MAX),
    newLastNameAr: nameIn("Arabic", NAME_MAX),
})

export type CreateProfileRequestInput = z.infer<typeof createProfileRequestSchema>

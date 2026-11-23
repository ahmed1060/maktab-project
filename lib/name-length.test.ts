import { describe, it, expect } from "vitest"
import { ar } from "./translations/ar"
import { en } from "./translations/en"
import { NAME_MAX } from "@/lib/new-employee-form"
import { createUserSchema, updateUserSchema } from "@/lib/validations/user.schema"
import { createProfileRequestSchema } from "@/lib/validations/profile.schema"

/**
 * How long an employee's first and last names may be: up to 40 characters
 * (the owner's answer of 2026-11-23, PR 397; it was 15). A name is usually
 * longer in English than in Arabic, its vowels written out: محمد عبد الرحمن
 * is 15 characters, and Mohamed Abdelrahman is 19. One rule, on the
 * screens before anything is sent and on the server, and the mistakes say
 * it in both languages.
 */

const forty = "a".repeat(40)
const fortyOne = "a".repeat(41)
const person = { firstName: "Mona", lastName: "Ali", email: "mona@example.com", password: "a".repeat(8) }

describe("a name, up to 40 characters", () => {
    it("is one rule", () => {
        expect(NAME_MAX).toBe(40)
    })

    it("is what the server takes when someone is added or changed", () => {
        expect(createUserSchema.safeParse({ ...person, firstName: "Mohamed Abdelrahman", lastName: forty }).success).toBe(true)
        expect(createUserSchema.safeParse({ ...person, firstName: fortyOne }).success).toBe(false)
        expect(createUserSchema.safeParse({ ...person, lastName: fortyOne }).success).toBe(false)
        expect(updateUserSchema.safeParse({ id: "u1", firstName: forty, lastName: forty }).success).toBe(true)
        expect(updateUserSchema.safeParse({ id: "u1", firstName: fortyOne }).success).toBe(false)
        expect(updateUserSchema.safeParse({ id: "u1", lastName: fortyOne }).success).toBe(false)
    })

    it("is what the server takes when someone asks for their own name to be changed", () => {
        expect(createProfileRequestSchema.safeParse({ newFirstName: forty, newLastName: forty }).success).toBe(true)
        expect(createProfileRequestSchema.safeParse({ newFirstName: fortyOne, newLastName: "Ali" }).success).toBe(false)
        expect(createProfileRequestSchema.safeParse({ newFirstName: "Mona", newLastName: fortyOne }).success).toBe(false)
    })

    it("is what a name too long is told, in both languages", () => {
        expect(en.profile_first_name_invalid).toBe("Enter a first name of up to 40 characters.")
        expect(en.profile_last_name_invalid).toBe("Enter a last name of up to 40 characters.")
        expect(ar.profile_first_name_invalid).toBe("يُرجى إدخال اسم أول من ٤٠ حرفاً على الأكثر.")
        expect(ar.profile_last_name_invalid).toBe("يُرجى إدخال اسم عائلة من ٤٠ حرفاً على الأكثر.")
    })
})

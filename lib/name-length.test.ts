import { describe, it, expect } from "vitest"
import { ar } from "./translations/ar"
import { en } from "./translations/en"
import { NAME_MAX } from "@/lib/new-employee-form"
import { createUserSchema, updateUserSchema } from "@/lib/validations/user.schema"
import { createProfileRequestSchema } from "@/lib/validations/profile.schema"

/**
 * How long an employee's first and last names may be: up to 30 characters
 * (the owner's answer of 2026-11-24, PR 402; it was 15, then 40 from PR
 * 397). A first or last name is mostly one word, and at worst a compound
 * of two, which fits even spaced: Abd El Moneim Abd El Ghaffar is 28. A
 * name is usually longer in English than in Arabic, its vowels written
 * out. One rule, on the screens before anything is sent and on the
 * server, and the mistakes say it in both languages.
 */

const thirty = "a".repeat(30)
const thirtyOne = "a".repeat(31)
const person = { firstName: "Mona", lastName: "Ali", email: "mona@example.com", password: "a".repeat(8) }

describe("a name, up to 30 characters", () => {
    it("is one rule", () => {
        expect(NAME_MAX).toBe(30)
    })

    it("is what the server takes when someone is added or changed", () => {
        expect(createUserSchema.safeParse({ ...person, firstName: "Abd El Moneim Abd El Ghaffar", lastName: thirty }).success).toBe(true)
        expect(createUserSchema.safeParse({ ...person, firstName: thirtyOne }).success).toBe(false)
        expect(createUserSchema.safeParse({ ...person, lastName: thirtyOne }).success).toBe(false)
        expect(updateUserSchema.safeParse({ id: "u1", firstName: thirty, lastName: thirty }).success).toBe(true)
        expect(updateUserSchema.safeParse({ id: "u1", firstName: thirtyOne }).success).toBe(false)
        expect(updateUserSchema.safeParse({ id: "u1", lastName: thirtyOne }).success).toBe(false)
    })

    it("is what the server takes when someone asks for their own name to be changed", () => {
        // Each in Arabic too (PR 404), as long as its English may be.
        const inArabic = { newFirstNameAr: "منى", newLastNameAr: "علي" }
        expect(createProfileRequestSchema.safeParse({ ...inArabic, newFirstName: thirty, newLastName: thirty }).success).toBe(true)
        expect(createProfileRequestSchema.safeParse({ ...inArabic, newFirstName: thirtyOne, newLastName: "Ali" }).success).toBe(false)
        expect(createProfileRequestSchema.safeParse({ ...inArabic, newFirstName: "Mona", newLastName: thirtyOne }).success).toBe(false)
    })

    it("is what a name too long is told, in both languages", () => {
        expect(en.profile_first_name_invalid).toBe("Enter a first name of up to 30 characters.")
        expect(en.profile_last_name_invalid).toBe("Enter a last name of up to 30 characters.")
        expect(ar.profile_first_name_invalid).toBe("يُرجى إدخال اسم أول من ٣٠ حرفاً على الأكثر.")
        expect(ar.profile_last_name_invalid).toBe("يُرجى إدخال اسم عائلة من ٣٠ حرفاً على الأكثر.")
    })
})

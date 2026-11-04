import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { USERNAME_PATTERN, changedUsername, usernameError, usernameFromEmail } from "@/lib/username-rules"
import { createUserSchema, updateUserSchema } from "@/lib/validations/user.schema"
import { superAdminSchema } from "@/lib/validations/super-admin.schema"

/**
 * What a username may be, the same wherever one is typed or made up: 2 to 30
 * letters, digits, dots, hyphens or underscores, starting with a letter or a
 * digit. Never an @ or a space, so signing in can tell one from an email.
 */

describe("a username", () => {
    it("is 2 to 30 letters, digits, dots, hyphens or underscores, starting with a letter or digit", () => {
        // The shapes already in use: made up, typed, and a leaver's.
        for (const ok of ["k0", "ds12", "nt.hana", "Mona", "a_b", "x-y", "deleted_1793778266568", "a".repeat(30)]) expect(usernameError(ok), ok).toBeNull()
        for (const wrong of ["", "k", "a b", "a@b.co", ".ab", "-ab", "_ab", "a".repeat(31), "مها", "a/b", "a%b"]) expect(usernameError(wrong), wrong).toBe("username_invalid")
        expect(USERNAME_PATTERN.test("  k0 ")).toBe(false)
        expect(usernameError("  k0 ")).toBeNull()
    })

    it("is checked the same way when an account is added, changed, or a Super Admin is added", () => {
        const person = { firstName: "A", lastName: "B", email: "a@b.co", password: "a-long-password-123" }
        expect(createUserSchema.safeParse({ ...person, username: "k0" }).success).toBe(true)
        expect(createUserSchema.safeParse({ ...person, username: "a@b" }).success).toBe(false)
        expect(updateUserSchema.safeParse({ id: "u1", username: "" }).success).toBe(false)
        expect(updateUserSchema.safeParse({ id: "u1", username: " nt.hana " }).data?.username).toBe("nt.hana")
        expect(superAdminSchema.safeParse({ ...person, username: "a b" }).success).toBe(false)
        expect(superAdminSchema.safeParse({ ...person, username: "ops" }).success).toBe(true)
    })

    it("is made up for a Super Admin from their email, when none is typed", () => {
        expect(usernameFromEmail("Ahmed.Hossam1060@gmail.com")).toBe("Ahmed.Hossam1060")
        expect(usernameFromEmail("o'brien+ops@x.co")).toBe("obrienops")
        expect(usernameFromEmail("_xy@y.co")).toBe("xy")
        // Too short to be one: a username of its own.
        expect(usernameFromEmail("x@y.co")).toBe("admin")
        expect(usernameFromEmail("@y.co")).toBe("admin")
        expect(usernameFromEmail(`${"a".repeat(40)}@y.co`)).toHaveLength(26)
        for (const email of ["Ahmed.Hossam1060@gmail.com", "o'brien+ops@x.co", "_xy@y.co", "x@y.co", "@y.co"]) expect(usernameError(usernameFromEmail(email)), email).toBeNull()
    })

    it("is sent from the profile form only when it's been changed", () => {
        expect(changedUsername("k0", "k0")).toBeUndefined()
        expect(changedUsername(" k0 ", "k0")).toBeUndefined()
        expect(changedUsername("K0", "k0")).toBe("K0")
        expect(changedUsername("mona", "k0")).toBe("mona")
        const form = readFileSync("components/EmployeeProfileForm.tsx", "utf8")
        // The Super Admin's alone, as the route takes it (lib/profile-access.ts, PR 193).
        expect(form).toContain("username: access.changeUsername ? changedUsername(username, savedUsername) : undefined,")
    })

    it("is typed as it is: not spell-checked, capitalised, filled in or translated by the browser", () => {
        const form = readFileSync("components/profile/ProfileForm.tsx", "utf8")
        const input = form.slice(form.indexOf('<TextInput {...p} name="username"'))
        const tag = input.slice(0, input.indexOf("/>"))
        for (const attribute of ['spellCheck={false}', 'autoCapitalize="none"', 'autoComplete="off"', 'translate="no"']) expect(tag, attribute).toContain(attribute)
    })
})

import { describe, it, expect } from "vitest"
import { ar } from "./translations/ar"
import { en } from "./translations/en"
import { PASSWORD_MIN, PASSWORD_MAX, newEmployeeErrors } from "@/lib/new-employee-form"
import { newPasswordErrors } from "@/lib/new-password-form"
import { profileErrors } from "@/lib/profile-form"
import { resetErrors } from "@/lib/sign-in-form"
import { sentPassword } from "@/lib/client-invitation"
import { sentPasswordChange } from "@/lib/client-password-change"
import { createUserSchema, updateUserSchema } from "@/lib/validations/user.schema"
import { superAdminSchema } from "@/lib/validations/super-admin.schema"
import { forgotPasswordConfirmSchema } from "@/lib/validations/forgot-password.schema"
import { addErrors } from "@/components/SuperAdminDialogs"
import { KNOWN_REFUSALS } from "@/lib/api-errors"

/**
 * How long a password must be, wherever one is set in Nizmo: 8 to 72
 * characters (the owner's answer of 2026-11-20, PR 341; it was 12). One
 * rule, on every screen before anything is sent and on the server, and
 * every hint and mistake says it, in both languages.
 */

const seven = "a".repeat(7)
const eight = "a".repeat(8)
const TOKEN = "t".repeat(43)

describe("a password, 8 to 72 characters", () => {
    it("is one rule", () => {
        expect(PASSWORD_MIN).toBe(8)
        expect(PASSWORD_MAX).toBe(72)
    })

    it("on the screens, before anything is sent", () => {
        const employee = (password: string) => newEmployeeErrors({ firstName: "Mona", firstNameAr: "منى", lastName: "Adel", lastNameAr: "عادل", email: "mona@example.com", password, company: { needed: false, id: "" } }).password
        expect(employee(seven)).toBe("emp_new_password_short")
        expect(employee(eight)).toBeUndefined()
        expect(newPasswordErrors({ newPassword: seven, confirmPassword: seven }).newPassword).toBe("change_password_short")
        expect(newPasswordErrors({ newPassword: eight, confirmPassword: eight })).toEqual({})
        expect(resetErrors({ code: "123456", newPassword: seven, confirmPassword: seven }).newPassword).toBe("change_password_short")
        expect(resetErrors({ code: "123456", newPassword: eight, confirmPassword: eight })).toEqual({})
        const profile = (password: string) => profileErrors({ firstName: "Mona", lastName: "Adel", email: "mona@example.com", username: "", salary: "", dayOffCredit: "", password } as any).password
        expect(profile(seven)).toBe("emp_new_password_short")
        expect(profile(eight)).toBeUndefined()
        const superAdmin = (password: string) => addErrors({ firstName: "Sara", lastName: "Nabil", email: "sara@example.com", username: "", password, gender: "FEMALE" } as any).password
        expect(superAdmin(seven)).toBe("super_admins_password_short")
        expect(superAdmin(eight)).toBeUndefined()
    })

    it("on the server", () => {
        const user = { firstName: "Mona", lastName: "Adel", email: "mona@example.com" }
        expect(createUserSchema.safeParse({ ...user, password: seven }).success).toBe(false)
        expect(createUserSchema.safeParse({ ...user, password: eight }).success).toBe(true)
        expect(updateUserSchema.safeParse({ id: "u1", password: seven }).success).toBe(false)
        expect(updateUserSchema.safeParse({ id: "u1", password: eight }).success).toBe(true)
        expect(superAdminSchema.safeParse({ ...user, password: seven }).success).toBe(false)
        expect(superAdminSchema.safeParse({ ...user, password: eight }).success).toBe(true)
        const reset = { email: "mona@example.com", code: "123456" }
        expect(forgotPasswordConfirmSchema.safeParse({ ...reset, newPassword: seven }).success).toBe(false)
        expect(forgotPasswordConfirmSchema.safeParse({ ...reset, newPassword: eight }).success).toBe(true)
        // The client area's: setting one from the invitation, and changing it.
        expect(sentPassword({ token: TOKEN, password: seven, confirmPassword: seven })).toEqual({ problem: "short" })
        expect(sentPassword({ token: TOKEN, password: eight, confirmPassword: eight })).toEqual({ token: TOKEN, password: eight })
        expect(sentPasswordChange({ currentPassword: "old", newPassword: seven, confirmPassword: seven })).toEqual({ problem: "short" })
        expect(sentPasswordChange({ currentPassword: "old", newPassword: eight, confirmPassword: eight })).toEqual({ current: "old", password: eight })
    })

    it("says so, in both languages, wherever it's said", () => {
        const KEYS = ["emp_new_password_short", "emp_new_password_hint", "profile_new_password_hint", "change_password_new_hint", "change_password_short", "super_admins_password_hint", "super_admins_password_short"] as const
        for (const key of KEYS) {
            expect(en[key], key).toMatch(/\b8\b/)
            expect(en[key], key).not.toMatch(/\b12\b/)
            expect(ar[key], key).toContain("٨")
            expect(ar[key], key).not.toContain("١٢")
        }
        expect(en.change_password_new_hint).toBe("8 to 72 characters.")
        expect(ar.change_password_new_hint).toBe("من ٨ إلى ٧٢ حرفاً.")
        expect(en.change_password_short).toBe("The password needs at least 8 characters.")
        expect(ar.change_password_short).toBe("تحتاج كلمة المرور إلى ٨ أحرف على الأقل.")
        // The server's refusals, as the screens fall back on them.
        expect(KNOWN_REFUSALS.INVITATION_PASSWORD_SHORT.message).toBe("The password needs at least 8 characters.")
        expect(KNOWN_REFUSALS.NEW_PASSWORD_SHORT.message).toBe("The password needs at least 8 characters.")
    })
})

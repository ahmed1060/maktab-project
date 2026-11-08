import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { ar } from "./translations/ar"
import { en } from "./translations/en"
import { ownPasswordRefusal } from "./profile-password"

/**
 * One's own current password, checked by the server (lib/own-password.db.
 * test.ts has why): the profile sends the one it asked for with a new
 * password of one's own, and says what the server answers. The password it
 * asks for before any save was checked only in the browser.
 */

const FORM = readFileSync("components/EmployeeProfileForm.tsx", "utf8")

describe("what the server answers about one's own password, in the page's language", () => {
    it("says too many wrong tries, and a wrong current password, by their codes", () => {
        expect(ownPasswordRefusal({ code: "OWN_PASSWORD_TRIES" })).toBe("own_password_tries")
        expect(ownPasswordRefusal({ code: "CURRENT_PASSWORD_WRONG" })).toBe("incorrect_password")
        expect(ownPasswordRefusal({ code: "SOMETHING_ELSE" })).toBeNull()
        expect(ownPasswordRefusal(null)).toBeNull()
    })
})

describe("the profile, sending the password it asked for", () => {
    const confirm = FORM.slice(FORM.indexOf("const confirmAndSave"), FORM.indexOf("// Someone else's profile is under their name"))
    const save = FORM.slice(FORM.indexOf("const executeSubmit"), FORM.indexOf("// Their role, as the form may change it"))

    it("keeps the one it was given for the save, and says too many tries under it", () => {
        expect(confirm).toContain("confirmed.current = password")
        expect(confirm.indexOf("confirmed.current = password")).toBeLessThan(confirm.indexOf("await executeSubmit()"))
        expect(confirm).toContain("const refused = ownPasswordRefusal(result)")
        expect(confirm.indexOf("ownPasswordRefusal(result)")).toBeLessThan(confirm.indexOf("t('profile_verify_failed')"))
        expect(FORM).toContain("const confirmed = useRef('')")
    })

    it("sends it only with a new password of one's own", () => {
        const payload = save.slice(save.indexOf("method: 'PUT'"), save.indexOf("reassignReportsTo: reassignTo"))
        expect(payload).toContain("currentPassword: own && access.changePassword && password ? confirmed.current : undefined,")
    })

    it("says the server's refusal of it above the buttons, and forgets it once it's saved", () => {
        expect(save).toContain("const ownRefused = ownPasswordRefusal(answer)")
        expect(save.indexOf("ownPasswordRefusal(answer)")).toBeLessThan(save.indexOf("const refused = refusedField(answer)"))
        expect(save).toContain("if (ownRefused) setFormError(t(ownRefused))")
        expect(save.indexOf("confirmed.current = ''")).toBeGreaterThan(save.indexOf("setChanged(false)"))
    })
})

describe("its words", () => {
    it("say too many tries as signing in does, in both languages, asking nothing in the masculine", () => {
        expect(en.own_password_tries).toBe("Too many wrong tries for this account. You can try again within 15 minutes, or your company's Admin can unlock it now.")
        expect(ar.own_password_tries).toBe("محاولات خاطئة كثيرة لهذا الحساب. يمكن المحاولة مرة أخرى خلال ١٥ دقيقة، أو يمكن لمسؤول الشركة فتحه الآن.")
        expect(ar.own_password_tries).not.toMatch(/(^|\s)(أدخل|اختر|حاول|اكتب|انسخ|تحقق)(\s|$)|هل أنت متأكد|هل تريد/)
    })
})

describe("the Change password page, on the forced change", () => {
    const PAGE = readFileSync("app/(dashboard)/dashboard/change-password/page.tsx", "utf8")

    // Not asked for the temporary password it was just signed in with. From a
    // session the temporary password ended, the server asks for it, and its
    // English answer was shown as it came.
    it("sends no current password, and says the server's refusal of it in the page's language", () => {
        expect(PAGE).toContain("body: JSON.stringify({ id: viewer?.id, password: newPassword }),")
        expect(PAGE).toContain("const refused = ownPasswordRefusal(answer)")
        expect(PAGE).toContain("setError(refused ? t(refused) : apiErrorText(text, t('change_password_failed')))")
    })
})

describe("giving a temporary password, confirmed with one's own", () => {
    it("is answered too many tries by its code, and the dialog says so", () => {
        const route = readFileSync("app/api/users/[id]/reset-password/route.ts", "utf8")
        expect(route).toContain("if (error.message === 'OWN_PASSWORD_TRIES') return ApiResponse.refused(429, OWN_PASSWORD_TRIES, 'OWN_PASSWORD_TRIES')")
        const reset = FORM.slice(FORM.indexOf("const resetPassword"), FORM.indexOf("const confirmAndSave"))
        expect(reset).toContain("if (!res.ok || !result?.success) return t(ownPasswordRefusal(result) ?? resetRefusal(result?.error))")
    })
})

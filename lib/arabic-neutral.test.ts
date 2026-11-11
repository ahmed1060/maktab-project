import { describe, it, expect } from "vitest"
import { ar as arabic } from "./translations/ar"
import { en as english } from "./translations/en"

/**
 * The app's Arabic speaks to no one in the masculine (`DESIGN.md` §3.4; the
 * product owner, 2026-11-11). A command has no neutral form in Arabic:
 * "اختر" asks a man, "اختاري" a woman. So the app asks with "يُرجى" and a
 * verbal noun, a search box says "البحث", and a button or a picker's prompt
 * is a verbal noun.
 *
 * The screens move over in parts (`UI_PLAN.md` §5). This file checks what's
 * moved, across every string: part 1, searching, picking and trying again.
 */

const ar = arabic as Record<string, string>
const en = english as Record<string, string>
const keys = Object.keys(ar)

/** A word on its own, perhaps after "و" or "ف": between spaces, punctuation or the string's ends. */
const word = (words: string) => new RegExp(`(^|[\\s،.:—(«])(?:و|ف)?(${words})(?=[\\s،.:—)»؟!…]|$)`)

describe("the app's Arabic, part 1: searching, picking and trying again", () => {
    it("asks no one to search, pick or try again in the masculine", () => {
        const masculine = word("ابحث|اختر|اختره|اخترها|حاول|لترى")
        for (const key of keys) expect([key, masculine.test(ar[key])], ar[key]).toEqual([key, false])
    })

    it("says البحث in every search box", () => {
        const boxes = keys.filter(key => (key.endsWith("_search") && key !== "clear_search") || key === "who_can_find_person" || key === "records_find_client")
        expect(boxes.length).toBeGreaterThanOrEqual(20)
        for (const key of boxes) expect([key, ar[key].startsWith("البحث ")], ar[key]).toEqual([key, true])
    })

    it("names a picker's prompt and the Try again button with a verbal noun", () => {
        expect(ar.try_again).toBe("إعادة المحاولة")
        expect(ar.select_client_placeholder).toBe("اختيار...")
        expect(ar.select_company_placeholder).toBe("اختيار شركة…")
        expect(ar.select_employee_placeholder).toBe("اختيار الموظف")
        expect(ar.punch_choose_file).toBe("اختيار ملف")
        expect(ar.change_person).toBe("اختيار شخص آخر")
    })

    it("asks with يُرجى where it said اختر or حاول", () => {
        expect(ar.payroll_pick_company_hint).toBe("يُرجى اختيار شركة من الأعلى لعرض كشف رواتبها.")
        expect(ar.requests_day_off_passed).toBe("مضى هذا اليوم. يُرجى اختيار يوم من اليوم فصاعدًا.")
        expect(ar.punch_failed).toBe("لم تنجح العملية. يُرجى المحاولة مرة أخرى.")
        expect(ar.face_ci_not_available).toBe("التحقق من الوجه غير متاح الآن. يُرجى المحاولة لاحقًا.")
    })

    it("leaves no other masculine command or 'his' in the sentences it changed", () => {
        const changed = [
            "location_pin_required", "location_failed_denied", "location_failed_unavailable",
            "ci_location_denied", "ci_location_unavailable", "face_ci_models_failed", "face_ci_camera_denied",
            "backup_trigger_failed", "restore_trigger_failed", "transfer_task_msg", "who_can_pick_person",
            "team_leader_has_reports", "day_truncated", "requests_permission_date_missing", "roles_copy_source_required",
        ]
        const masculine = word("حدّد|حدد|الصق|استخدم|اسمح|انتقل|فعّله|تحقق|ابدأه|ابدأها|تريد|تحتاج|تنسخ|يستطيع|فريقه|شهره")
        for (const key of changed) expect([key, masculine.test(ar[key])], ar[key]).toEqual([key, false])
        expect(ar.location_pin_required).toBe("يُرجى تحديد موقعه: بلصق الإحداثيات، أو باستخدام موقعك الحالي، أو باختياره على الخريطة.")
        expect(ar.who_can_pick_person).toBe("يُرجى البحث عن شخص ثم اختيار الاسم لعرض الصلاحيات الممنوحة.")
    })

    it("changes nothing in English", () => {
        expect(en.try_again).toBe("Try again")
        expect(en.select_company_placeholder).toBe("Select a company…")
        expect(en.tasks_search).toBe("Search tasks")
    })
})

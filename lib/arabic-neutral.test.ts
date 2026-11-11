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
 * moved, across every string: part 1, searching, picking and trying again;
 * part 2, entering, typing, setting, adding, saying and leaving empty; part
 * 3, every other command in a hint, a message or a notice.
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

describe("the app's Arabic, part 2: entering, typing, setting and adding", () => {
    it("asks no one to enter, type, set, add, say or leave empty in the masculine", () => {
        const masculine = word("(?:أدخل|ادخل|اكتب|حدد|حدّد|أضف|اذكر|اترك|الصق|ألصق)(?:ه|ها|هم)?")
        for (const key of keys) expect([key, masculine.test(ar[key])], ar[key]).toEqual([key, false])
    })

    it("asks with يُرجى and a verbal noun where a field is wrong or missing", () => {
        expect(ar.payments_amount_required).toBe("يُرجى إدخال المبلغ.")
        expect(ar.number_whole_between_or_empty).toBe("يُرجى كتابة عدد صحيح من {min} إلى {max}، أو تركه فارغًا.")
        expect(ar.requests_role_reason_required).toBe("يُرجى ذكر سبب الرفض.")
        expect(ar.points_required).toBe("يُرجى تحديد نقاطها، من ٠ إلى ١٠")
        expect(ar.health_type_word).toBe("يُرجى كتابة {word} للتأكيد.")
    })

    it("says a field may be left empty in the passive", () => {
        expect(ar.attendance_no_cap_hint).toBe("يُترك فارغًا بلا حد.")
        expect(ar.packages_lifetime_hint).toBe("يُترك فارغًا إن لم تكن تُباع مدى الحياة.")
    })

    it("names a placeholder and an audit entry with a verbal noun", () => {
        expect(ar.note_placeholder).toBe("إضافة ملاحظة عن العمل…")
        expect(ar.username_placeholder).toBe("إدخال اسم المستخدم...")
        expect(ar.audit_action_SET_SERVICE_FEE).toBe("تحديد رسوم الخدمة لمستحق")
        expect(ar.audit_action_COLLECT_CHARGES).toBe("تحديد مستحقات عميل كمحصّلة")
    })

    it("leaves no other masculine command, 'you' or 'his' in the sentences it changed", () => {
        const changed = [
            "obligation_assignee_deleted_msg", "payroll_cannot_compute", "requests_details_placeholder",
            "verified_unclear_hint", "punch_withdraw_import_hint", "punch_numbers_waiting_hint",
            "att_term_code_hint", "sod_acknowledge_required", "who_can_more_people",
        ]
        const masculine = word("أعد|احذفه|راجعها|افتح|استخدمه|ألغِ|تحتاجه|لتجد|مكلفًا|بصماته")
        for (const key of changed) expect([key, masculine.test(ar[key])], ar[key]).toEqual([key, false])
    })

    it("changes nothing in English", () => {
        expect(en.payments_amount_required).toBe("Enter the amount.")
        expect(en.attendance_no_cap_hint).toBe("Leave it empty for no limit.")
    })
})

describe("the app's Arabic, part 3: every other command", () => {
    // Past-tense verbs said of someone else (أكّد، وافق، أرسل، عدّل، غيّر،
    // أوقف، حدّث، حمّل، صحّح) are written like commands; they're part 5's.
    const commands = "أرفق|ارفع|اضغط|انقر|تأكد|تأكّد|انتظر|أعد|راجع|استخدم|اطلب|احذف|افتح|اتصل|تواصل|سجّل|ادفع|اسحب|امسح|انسخ|شارك|اطبع|احفظ|ألغِ|ارجع|تابع|جرّب|جرب|خفّض|ثبّت|فعّل|اسمح|انتقل|ابدأ|شغّل|اضبط|اقرأ|انظر|اجعل|أكمل|قم|أغلق|أبقِ|اسأل|أنشئ|اربط|اعرض|اعتمد|ارفض|انقل|أعطِ|اتبع|اختبر|خصّص|استعد|قارن|أبلغ|اقبل|ذكّر|افحص|اعذر"

    it("asks no one in the masculine to do anything else", () => {
        const masculine = word(`(?:${commands})(?:ه|ها|هم)?|تحقق من|لا تفعّل(?:ه|ها)?`)
        for (const key of keys) expect([key, masculine.test(ar[key])], ar[key]).toEqual([key, false])
    })

    it("asks with يُرجى, or says what can be done, in a hint or a notice", () => {
        expect(ar.ci_key_failed).toBe("تعذّر استخدام المفتاح الآمن لهذا الهاتف. يُرجى تسجيل الهاتف من جديد.")
        expect(ar.notice_att_day_incomplete).toBe("هناك بصمة ناقصة يوم {date}. يُرجى الإبلاغ عن الوقت المنسي ليُحسب اليوم.")
        expect(ar.my_payslips_hint).toBe("كل قسيمة راتب صدرت لك، الأحدث أولاً. يمكن فتح أي منها لقراءتها أو طباعتها.")
        expect(ar.maintenance_mode_description).toContain("يُستخدم أثناء عمل قد يعطّل المنصة")
    })

    it("names a button with a verbal noun", () => {
        expect(ar.exc_accept).toBe("قبول")
        expect(ar.exc_excuse).toBe("قبول العذر")
        expect(ar.punch_check_file).toBe("فحص الملف")
        expect(ar.face_rekey_run).toBe("إعادة التشفير بالمفتاح الجديد")
        expect(ar.attendance_make_default).toBe("جعله افتراضيًا")
    })

    it("leaves no other masculine command, 'you' or 'his' in the sentences it changed", () => {
        const changed = [
            "task_assignee_deleted_msg", "costs_pay_by_name", "requests_role_leads_team", "punch_import_hint",
            "ci_other_phone", "face_queue_hint", "face_overdue_hint", "face_people_hint", "face_sys_hint",
            "face_ci_needs_app", "confirm_maintenance_on_msg", "notice_att_day_absent", "notice_face_review",
        ]
        const masculine = word("لتدفع|تختار|تضغط|تعرفه|تسجّل|غيّر|أوقف|أوقفه|حدّث|أرسل|مكلفًا|غائبًا|دوره|ملفه|فريقه|بصورته|وجهه")
        for (const key of changed) expect([key, masculine.test(ar[key])], ar[key]).toEqual([key, false])
    })

    it("keeps the direction marks and the names of keys and files as they were", () => {
        expect(ar.punch_import_hint).toContain("(\u200E.xlsx أو \u200E.csv)")
        expect(ar.face_rekey_same_key).toContain("FACE_PHOTO_KEY على Vercel")
        expect(ar.face_sys_hint).toContain("(يُنظر ATTENDANCE_PLAN.md §10)")
    })

    it("changes nothing in English", () => {
        expect(en.exc_accept).toBe("Accept")
        expect(en.ci_key_failed).toBe("This phone's secure key couldn't be used. Register the phone again.")
    })
})

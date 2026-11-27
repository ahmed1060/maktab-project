import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { readFileSync } from "node:fs"
import { ar } from "./translations/ar"
import { en } from "./translations/en"

/**
 * When permission hours may be asked for (LATER_CHANGES_PLAN.md §7.4, 4b;
 * DESIGN.md §5.5, Asking for permission hours): before, or within the
 * policy's hours after, as before; or any day from the first day not paid,
 * never before the 1st of last month, to a month ahead.
 */

const state = { locale: "en" as "en" | "ar" }
vi.mock("@/context/LanguageContext", () => ({
    useLanguage: () => ({ locale: state.locale, t: (key: string) => (state.locale === "ar" ? ar : en)[key as keyof typeof en] ?? key }),
}))
vi.mock("@/context/ToastContext", () => ({ useToast: () => ({ showToast: () => {} }) }))
vi.mock("@/lib/useHydrated", () => ({ useHydrated: () => true }))
beforeEach(() => { vi.stubGlobal("document", { body: {} }) })
afterEach(() => { vi.unstubAllGlobals(); state.locale = "en" })

const enT = (key: string) => en[key as keyof typeof en] ?? key
const arT = (key: string) => ar[key as keyof typeof ar] ?? key

describe("the attendance policy's when", () => {
    it("is around the day or any day, and a version saved before it is around the day", async () => {
        const { permissionHoursSchema, policyBodySchema, STANDARD_OFFICE, PERMISSION_WHEN } = await import("./attendance/policy")
        expect(PERMISSION_WHEN).toEqual(["AROUND_THE_DAY", "ANY_DAY"])
        expect(STANDARD_OFFICE.permissionHours.when).toBe("AROUND_THE_DAY")
        const before: Record<string, unknown> = { ...STANDARD_OFFICE.permissionHours }
        delete before.when
        expect(permissionHoursSchema.parse(before).when).toBe("AROUND_THE_DAY")
        expect(policyBodySchema.parse({ ...STANDARD_OFFICE, permissionHours: before }).permissionHours.when).toBe("AROUND_THE_DAY")
        expect(permissionHoursSchema.safeParse({ ...STANDARD_OFFICE.permissionHours, when: "ANY_DAY" }).success).toBe(true)
        expect(permissionHoursSchema.safeParse({ ...STANDARD_OFFICE.permissionHours, when: "ANYTIME" }).success).toBe(false)
    })

    it("is kept through the policy's dialog, and the hours after are read only around the day", async () => {
        const { bodyFromForm, formFromBody } = await import("@/components/attendance-policy/policy-form")
        const { STANDARD_OFFICE } = await import("./attendance/policy")
        const any = { ...STANDARD_OFFICE, permissionHours: { ...STANDARD_OFFICE.permissionHours, when: "ANY_DAY" as const } }
        const form = formFromBody(any)
        expect(form.permissionHours.when).toBe("ANY_DAY")
        expect(bodyFromForm(form, any)).toEqual({ ok: true, body: any })
        // Not shown, the hours after aren't read: what was there is kept.
        expect(bodyFromForm({ ...form, permissionHours: { ...form.permissionHours, afterTheFactHours: "x" } }, any)).toEqual({ ok: true, body: any })
        // Shown, they are.
        const around = formFromBody(STANDARD_OFFICE)
        expect(bodyFromForm({ ...around, permissionHours: { ...around.permissionHours, afterTheFactHours: "x" } }, STANDARD_OFFICE).ok).toBe(false)
        expect(bodyFromForm({ ...around, permissionHours: { ...around.permissionHours, when: "ANY_DAY" } }, STANDARD_OFFICE)).toEqual({ ok: true, body: any })
    })

    it("is asked in the dialog after the row of its limits, a choice between two, with the hours after only around the day", () => {
        const dialog = readFileSync("components/attendance-policy/PolicyDialog.tsx", "utf8")
        // Radio buttons, as a choice between a few options is (DESIGN.md §5.3): both seen, their words wrapping on a phone.
        expect(dialog).toContain("<Choice legend={t('attendance_permission_when')} name=\"permissionHours.when\" value={ph.when}")
        expect(dialog).toContain("options={PERMISSION_WHEN.map(w => ({ value: w, label: w === 'ANY_DAY'")
        // Any day says under it how its days are counted.
        expect(dialog).toContain("? <span className=\"ui-choice-text\">{t('attendance_permission_when_ANY_DAY')}<span className=\"ui-hint\">{t('attendance_permission_when_any_hint')}</span></span>")
        expect(dialog).toContain(": t('attendance_permission_when_AROUND_THE_DAY') }))} />")
        expect(dialog).toContain("{ph.when === 'AROUND_THE_DAY' && (")
        const when = dialog.indexOf("t('attendance_permission_when')")
        expect(when).toBeGreaterThan(dialog.indexOf("t('attendance_permission_max_requests')"))
        // Out of the row, so not squeezed beside a number.
        expect(dialog.lastIndexOf("</div>", when)).toBeGreaterThan(dialog.indexOf("t('attendance_permission_max_requests')"))
        expect(when).toBeLessThan(dialog.indexOf("t('attendance_permission_after')"))
    })

    it("is said on the policy's card, under the hours a month", async () => {
        const { permissionWhenLine } = await import("./attendance/permission-when")
        const rules = (when: "AROUND_THE_DAY" | "ANY_DAY", afterTheFactHours: number) => ({ when, afterTheFactHours })
        expect(permissionWhenLine(enT as never, "en", rules("AROUND_THE_DAY", 24))).toBe("Before, or up to 24 hours after")
        expect(permissionWhenLine(enT as never, "en", rules("AROUND_THE_DAY", 1))).toBe("Before, or up to 1 hour after")
        expect(permissionWhenLine(enT as never, "en", rules("AROUND_THE_DAY", 0))).toBe("Only in advance")
        expect(permissionWhenLine(enT as never, "en", rules("ANY_DAY", 24))).toBe("Any day, from last month to a month ahead")
        expect(permissionWhenLine(arT as never, "ar", rules("AROUND_THE_DAY", 24))).toBe("قبله، أو حتى ٢٤ ساعة بعده")
        expect(permissionWhenLine(arT as never, "ar", rules("AROUND_THE_DAY", 0))).toBe("مسبقًا فقط")
        expect(permissionWhenLine(arT as never, "ar", rules("ANY_DAY", 0))).toBe("أي يوم، من الشهر الماضي حتى شهر مقدمًا")
        const panel = readFileSync("components/AttendancePolicyPanel.tsx", "utf8")
        expect(panel).toContain("? lines([t('attendance_permission_line').replace('{hours}', countOf(t, locale, shown.body.permissionHours.monthlyAllowanceMinutes / 60, 'hours')), permissionWhenLine(t, locale, shown.body.permissionHours)])")
    })

    it("says so in both languages", () => {
        expect(en.attendance_permission_when).toBe("Can be asked for")
        expect(en.attendance_permission_when_AROUND_THE_DAY).toBe("Before, or up to some hours after")
        expect(en.attendance_permission_when_ANY_DAY).toBe("Any day, from last month to a month ahead")
        expect(en.attendance_permission_when_any_hint).toBe("Counted from today, and never a day in a month whose payroll is approved.")
        expect(en.attendance_permission_when_around_line).toBe("Before, or up to {hours} after")
        expect(en.attendance_permission_when_ahead_line).toBe("Only in advance")
        expect(en.requests_permission_range).toBe("Permission hours can be asked for from {from} to {to}.")
        expect(ar.attendance_permission_when).toBe("يمكن طلب الإذن")
        expect(ar.attendance_permission_when_AROUND_THE_DAY).toBe("قبله، أو حتى عدد من الساعات بعده")
        expect(ar.attendance_permission_when_ANY_DAY).toBe("أي يوم، من الشهر الماضي حتى شهر مقدمًا")
        expect(ar.attendance_permission_when_any_hint).toBe("تُحسب من اليوم، ولا تشمل أبدًا يومًا في شهر اعتُمدت رواتبه.")
        expect(ar.attendance_permission_when_around_line).toBe("قبله، أو حتى {hours} بعده")
        expect(ar.attendance_permission_when_ahead_line).toBe("مسبقًا فقط")
        expect(ar.requests_permission_range).toBe("يمكن طلب ساعات الإذن من {from} إلى {to}.")
    })
})

describe("asking for permission hours", () => {
    it("offers only the days the day's balance sends, wherever the form opens", () => {
        const dialogs = readFileSync("app/(dashboard)/dashboard/requests/AttendanceDialogs.tsx", "utf8")
        expect(dialogs).toContain("type Balance = { enabled: boolean; types: string[]; remainingMinutes: number; minPerRequestMinutes: number; maxPerRequestMinutes: number; days: DayOffDays | null }")
        expect(dialogs).toContain("<DatePickerSingle label={t('date_label')} value={date} minDate={balance?.days?.from} maxDate={balance?.days?.to} error={errors.date}")
    })

    it("says under the date which days may be asked for, when a day outside them is refused", async () => {
        const dialogs = readFileSync("app/(dashboard)/dashboard/requests/AttendanceDialogs.tsx", "utf8")
        expect(dialogs).toContain("if (body.code === 'PERMISSION_OUT_OF_RANGE' && body.from && body.to) {")
        expect(dialogs).toContain("setErrors(x => ({ ...x, date: daysText(t, locale, { from: body.from, to: body.to }, 'requests_permission_range') }))")
        const { daysText } = await import("@/lib/day-off-window")
        expect(daysText(enT as never, "en", { from: "2026-11-01", to: "2026-12-27" }, "requests_permission_range")).toBe("Permission hours can be asked for from 1 November to 27 December.")
        expect(daysText(arT as never, "ar", { from: "2026-11-01", to: "2026-12-27" }, "requests_permission_range")).toBe("يمكن طلب ساعات الإذن من ١ نوفمبر إلى ٢٧ ديسمبر.")
        // Day off's, as before.
        expect(daysText(enT as never, "en", { from: "2026-11-01", to: "2026-12-27" })).toBe("Days off can be asked for from 1 November to 27 December.")
    })

    it("is answered with the days by the server, and the day's balance sends them", () => {
        const route = readFileSync("app/api/attendance/permissions/route.ts", "utf8")
        expect(route).toContain("if (error instanceof PermissionOutOfRange) return ApiResponse.refused(400, `Permission hours can be asked for from ${error.from} to ${error.to}.`, error.message, { from: error.from, to: error.to })")
        const balance = readFileSync("app/api/attendance/permissions/balance/route.ts", "utf8")
        expect(balance).toContain("days: await AttendanceRequestService.permissionDays(self.companyId)")
    })
})

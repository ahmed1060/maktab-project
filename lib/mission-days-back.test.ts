import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { readFileSync } from "node:fs"
import { ar } from "./translations/ar"
import { en } from "./translations/en"

/**
 * How far back a mission may be asked for (LATER_CHANGES_PLAN.md §7.20;
 * DESIGN.md §5.5, Asking for a mission): from the payroll month's first day,
 * as every request, to a year ahead as before. The policy's days back (4c)
 * are gone, the owner's choice.
 */

vi.mock("@/context/LanguageContext", () => ({ useLanguage: () => ({ locale: "en", t: (key: string) => en[key as keyof typeof en] ?? key }) }))
vi.mock("@/context/ToastContext", () => ({ useToast: () => ({ showToast: () => {} }) }))
beforeEach(() => { vi.stubGlobal("document", { body: {} }) })
afterEach(() => { vi.unstubAllGlobals() })

const enT = (key: string) => en[key as keyof typeof en] ?? key
const arT = (key: string) => ar[key as keyof typeof ar] ?? key

describe("the attendance policy's missions, with no days back of their own", () => {
    it("follow the payroll month: a version saved with days back still reads, without them", async () => {
        const { policyBodySchema, STANDARD_OFFICE, MEASURE_ONLY } = await import("./attendance/policy")
        expect(STANDARD_OFFICE.missions).not.toHaveProperty("daysBack")
        expect(MEASURE_ONLY.missions).not.toHaveProperty("daysBack")
        // Saved with them (LATER_CHANGES_PLAN.md §7.4, 4c), before §7.20.
        const saved = policyBodySchema.parse({ ...STANDARD_OFFICE, missions: { ...STANDARD_OFFICE.missions, daysBack: 3 } })
        expect(saved.missions).toEqual(STANDARD_OFFICE.missions)
    })

    it("are neither asked in the policy's dialog nor said on its card", async () => {
        const dialog = readFileSync("components/attendance-policy/PolicyDialog.tsx", "utf8")
        expect(dialog).not.toContain("attendance_mission_days_back")
        expect(dialog).not.toContain("missions.daysBack")
        const panel = readFileSync("components/AttendancePolicyPanel.tsx", "utf8")
        expect(panel).toContain("value: lines([shown.body.missions.enabled ? t('attendance_missions_line') : t('attendance_missions_off_line'), ...allowanceLines(shown.body.missions.allowance)])")
        const { bodyFromForm, formFromBody } = await import("@/components/attendance-policy/policy-form")
        const { STANDARD_OFFICE } = await import("./attendance/policy")
        expect(formFromBody(STANDARD_OFFICE).missions).not.toHaveProperty("daysBack")
        expect(bodyFromForm(formFromBody(STANDARD_OFFICE), STANDARD_OFFICE)).toEqual({ ok: true, body: STANDARD_OFFICE })
        for (const key of ["attendance_mission_days_back", "attendance_mission_days_back_hint", "attendance_mission_days_back_line", "attendance_mission_from_today_line"]) {
            expect(en).not.toHaveProperty(key)
            expect(ar).not.toHaveProperty(key)
        }
    })

    it("say which days in both languages", () => {
        expect(en.requests_mission_range).toBe("Missions can be asked for from {from} to {to}.")
        expect(en.requests_mission_out_of_range).toBe("Missions can't be asked for on those dates. Pick days the calendar offers.")
        expect(ar.requests_mission_range).toBe("يمكن طلب المأموريات من {from} إلى {to}.")
        expect(ar.requests_mission_out_of_range).toBe("لا يمكن طلب مأمورية في هذه التواريخ. يُرجى اختيار أيام مما يعرضه التقويم.")
    })
})

describe("the days a mission may be asked for", () => {
    it("run from the first day a request may be asked for to a year ahead (§7.20)", async () => {
        const { missionDays } = await import("./attendance/missions")
        expect(missionDays("2026-11-01", "2026-11-27")).toEqual({ from: "2026-11-01", to: "2027-11-27" })
        // Across the year's end.
        expect(missionDays("2026-12-01", "2027-01-03")).toEqual({ from: "2026-12-01", to: "2028-01-03" })
    })

    it("are what the form's calendars offer, wherever the Requests page opens it", () => {
        const page = readFileSync("app/(dashboard)/dashboard/requests/page.tsx", "utf8")
        expect(page).toContain("const missionDays = mayAskMission ? await MissionRequestService.window(viewer.companyId!) : null")
        expect(page).toContain("missionDays={missionDays}")
        const client = readFileSync("app/(dashboard)/dashboard/requests/RequestsClient.tsx", "utf8")
        expect(client).toContain("<AskMission today={today} days={missionDays} onCancel={close} onAsked={asked} />")
        const dialogs = readFileSync("app/(dashboard)/dashboard/requests/AttendanceDialogs.tsx", "utf8")
        expect(dialogs).toContain("<DateRangePicker label={t('dates_label')} dateFrom={from} dateTo={to} minDate={days.from} maxDate={days.to} error={errors.dates}")
        expect(dialogs).toContain("<DatePickerSingle label={t('date_label')} value={from} minDate={days.from} maxDate={days.to} error={errors.dates}")
    })

    it("are said under the dates when one outside them is refused", async () => {
        const dialogs = readFileSync("app/(dashboard)/dashboard/requests/AttendanceDialogs.tsx", "utf8")
        expect(dialogs).toContain("if (body.code === 'MISSION_OUT_OF_RANGE' && body.from && body.to) {")
        expect(dialogs).toContain("setErrors(x => ({ ...x, dates: daysText(t, locale, { from: body.from, to: body.to }, 'requests_mission_range') }))")
        const { daysText } = await import("@/lib/day-off-window")
        expect(daysText(enT as never, "en", { from: "2026-11-20", to: "2027-11-27" }, "requests_mission_range")).toBe("Missions can be asked for from 20 November 2026 to 27 November 2027.")
        expect(daysText(arT as never, "ar", { from: "2026-11-20", to: "2027-11-27" }, "requests_mission_range")).toBe("يمكن طلب المأموريات من ٢٠ نوفمبر ٢٠٢٦ إلى ٢٧ نوفمبر ٢٠٢٧.")
    })

    it("are answered by the server with the refusal", () => {
        const route = readFileSync("app/api/attendance/missions/route.ts", "utf8")
        expect(route).toContain("if (error instanceof MissionOutOfRange) return ApiResponse.refused(400, `Missions can be asked for from ${error.from} to ${error.to}.`, error.message, { from: error.from, to: error.to })")
    })
})

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { readFileSync } from "node:fs"
import { ar } from "./translations/ar"
import { en } from "./translations/en"

/**
 * How far back a mission may be asked for (LATER_CHANGES_PLAN.md §7.4, 4c;
 * DESIGN.md §5.5, Asking for a mission): the policy's days back, 7 unless
 * changed, to a year ahead as before.
 */

vi.mock("@/context/LanguageContext", () => ({ useLanguage: () => ({ locale: "en", t: (key: string) => en[key as keyof typeof en] ?? key }) }))
vi.mock("@/context/ToastContext", () => ({ useToast: () => ({ showToast: () => {} }) }))
beforeEach(() => { vi.stubGlobal("document", { body: {} }) })
afterEach(() => { vi.unstubAllGlobals() })

const enT = (key: string) => en[key as keyof typeof en] ?? key
const arT = (key: string) => ar[key as keyof typeof ar] ?? key

describe("the attendance policy's days back for missions", () => {
    it("are 0 to 365, 7 to start, and a version saved before them reads 7", async () => {
        const { policyBodySchema, STANDARD_OFFICE, MEASURE_ONLY, MISSION_DAYS_BACK, MISSION_DAYS_BACK_MAX } = await import("./attendance/policy")
        expect(MISSION_DAYS_BACK).toBe(7)
        expect(MISSION_DAYS_BACK_MAX).toBe(365)
        expect(STANDARD_OFFICE.missions.daysBack).toBe(7)
        expect(MEASURE_ONLY.missions.daysBack).toBe(7)
        // Saved before them, with missions or without.
        expect(policyBodySchema.parse({ ...STANDARD_OFFICE, missions: { enabled: true } }).missions.daysBack).toBe(7)
        const none: Record<string, unknown> = { ...STANDARD_OFFICE }
        delete none.missions
        expect(policyBodySchema.parse(none).missions.daysBack).toBe(7)
        const at = (daysBack: number) => policyBodySchema.safeParse({ ...STANDARD_OFFICE, missions: { ...STANDARD_OFFICE.missions, daysBack } }).success
        expect([0, 1, 30, 365].map(at)).toEqual([true, true, true, true])
        expect([-1, 366, 1.5].map(at)).toEqual([false, false, false])
    })

    it("are kept through the policy's dialog, read only while missions may be asked for", async () => {
        const { bodyFromForm, formFromBody } = await import("@/components/attendance-policy/policy-form")
        const { STANDARD_OFFICE } = await import("./attendance/policy")
        const form = formFromBody(STANDARD_OFFICE)
        expect(form.missions.daysBack).toBe("7")
        expect(bodyFromForm(form, STANDARD_OFFICE)).toEqual({ ok: true, body: STANDARD_OFFICE })
        // A version saying otherwise is shown and kept as it says.
        const back3 = { ...STANDARD_OFFICE, missions: { ...STANDARD_OFFICE.missions, daysBack: 3 } }
        expect(formFromBody(back3).missions.daysBack).toBe("3")
        expect(bodyFromForm(formFromBody(back3), back3)).toEqual({ ok: true, body: back3 })
        const typed = (daysBack: string, enabled = true) => bodyFromForm({ ...form, missions: { ...form.missions, daysBack, enabled } }, STANDARD_OFFICE)
        const three = typed("3")
        expect(three.ok && three.body.missions.daysBack).toBe(3)
        const zero = typed("0")
        expect(zero.ok && zero.body.missions.daysBack).toBe(0)
        for (const wrong of ["x", "366", "-1", "1.5", ""]) {
            const out = typed(wrong)
            expect(!out.ok && out.errors["missions.daysBack"], wrong).toEqual({ key: "number_whole_between", min: 0, max: 365 })
        }
        // Not shown, not read: what was there is kept.
        const off = typed("x", false)
        expect(off.ok && off.body.missions).toEqual({ ...STANDARD_OFFICE.missions, enabled: false })
    })

    it("are asked under Employees can ask for missions, while it's ticked", () => {
        const dialog = readFileSync("components/attendance-policy/PolicyDialog.tsx", "utf8")
        expect(dialog).toContain("{m.enabled && (")
        expect(dialog).toContain("<Field label={t('attendance_mission_days_back')} hint={t('attendance_mission_days_back_hint')} error={errorOf('missions.daysBack')}>")
        expect(dialog).toContain("min={0} max={MISSION_DAYS_BACK_MAX} name=\"missions.daysBack\" value={m.daysBack}")
        expect(dialog).toContain("onChange={e => setMissions({ daysBack: e.target.value }, 'missions.daysBack')}")
        const field = dialog.indexOf("t('attendance_mission_days_back')")
        expect(field).toBeGreaterThan(dialog.indexOf("t('attendance_missions_on')"))
        expect(field).toBeLessThan(dialog.indexOf("t('attendance_mission_allowance')"))
    })

    it("are said on the policy's card, under the missions' line, while they may be asked for", async () => {
        const { missionDaysBackLine } = await import("./attendance/missions")
        expect(missionDaysBackLine(enT as never, "en", 7)).toBe("Can be asked for up to 7 days back")
        expect(missionDaysBackLine(enT as never, "en", 1)).toBe("Can be asked for up to 1 day back")
        expect(missionDaysBackLine(enT as never, "en", 0)).toBe("Can be asked for from today on")
        expect(missionDaysBackLine(arT as never, "ar", 7)).toBe("يمكن طلبها بأثر رجعي حتى ٧ أيام")
        expect(missionDaysBackLine(arT as never, "ar", 1)).toBe("يمكن طلبها بأثر رجعي حتى يوم واحد")
        expect(missionDaysBackLine(arT as never, "ar", 0)).toBe("يمكن طلبها من اليوم فصاعدًا")
        const panel = readFileSync("components/AttendancePolicyPanel.tsx", "utf8")
        expect(panel).toContain("value: lines([shown.body.missions.enabled ? t('attendance_missions_line') : t('attendance_missions_off_line'), ...(shown.body.missions.enabled ? [missionDaysBackLine(t, locale, shown.body.missions.daysBack)] : []), ...allowanceLines(shown.body.missions.allowance)])")
    })

    it("say so in both languages", () => {
        expect(en.attendance_mission_days_back).toBe("Can be asked for up to this many days back")
        expect(en.attendance_mission_days_back_hint).toBe("Counted from today. With 0, from today on.")
        expect(en.attendance_mission_days_back_line).toBe("Can be asked for up to {days} back")
        expect(en.attendance_mission_from_today_line).toBe("Can be asked for from today on")
        expect(en.requests_mission_range).toBe("Missions can be asked for from {from} to {to}.")
        expect(en.requests_mission_out_of_range).toBe("Missions can't be asked for on those dates. Pick days the calendar offers.")
        expect(ar.attendance_mission_days_back).toBe("يمكن طلبها بأثر رجعي حتى هذا العدد من الأيام")
        expect(ar.attendance_mission_days_back_hint).toBe("تُحسب من اليوم. مع ٠، من اليوم فصاعدًا.")
        expect(ar.attendance_mission_days_back_line).toBe("يمكن طلبها بأثر رجعي حتى {days}")
        expect(ar.attendance_mission_from_today_line).toBe("يمكن طلبها من اليوم فصاعدًا")
        expect(ar.requests_mission_range).toBe("يمكن طلب المأموريات من {from} إلى {to}.")
        expect(ar.requests_mission_out_of_range).toBe("لا يمكن طلب مأمورية في هذه التواريخ. يُرجى اختيار أيام مما يعرضه التقويم.")
    })
})

describe("the days a mission may be asked for", () => {
    it("run from today less the days back to a year ahead", async () => {
        const { missionDays } = await import("./attendance/missions")
        expect(missionDays("2026-11-27", 7)).toEqual({ from: "2026-11-20", to: "2027-11-27" })
        expect(missionDays("2026-11-27", 0)).toEqual({ from: "2026-11-27", to: "2027-11-27" })
        // Across the year's end.
        expect(missionDays("2027-01-03", 7)).toEqual({ from: "2026-12-27", to: "2028-01-03" })
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

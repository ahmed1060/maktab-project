import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { ar } from "./translations/ar"
import { en } from "./translations/en"
import { daysText, dayOffWindow } from "./day-off-window"
import { missionDays } from "./attendance/missions"

/**
 * Every request from the payroll month's first day (LATER_CHANGES_PLAN.md
 * §7.20; DESIGN.md §5.5, How far back a request may be asked for): a day off,
 * permission hours any day, a mission and a missing punch alike start there,
 * or at last month's until its payroll is approved (lib/request-days.db.test.ts),
 * each with its own ahead. Here: the windows built from it, and the missing
 * punch's form, route and button on Attendance.
 */

const enT = (key: string) => en[key as keyof typeof en] ?? key
const arT = (key: string) => ar[key as keyof typeof ar] ?? key
const dialogs = () => readFileSync("app/(dashboard)/dashboard/requests/AttendanceDialogs.tsx", "utf8")

describe("the days built from the first day a request may be asked for", () => {
    it("start on it, a day off and permission hours to their months ahead, a mission to a year", () => {
        expect(dayOffWindow("2026-11-28", 1, "2026-11-01")).toEqual({ from: "2026-11-01", to: "2026-12-28" })
        expect(dayOffWindow("2026-11-28", 3, "2026-10-01")).toEqual({ from: "2026-10-01", to: "2027-02-28" })
        // The month ahead ends on its last day where it's shorter.
        expect(dayOffWindow("2027-01-31", 1, "2027-01-01")).toEqual({ from: "2027-01-01", to: "2027-02-28" })
        expect(missionDays("2026-11-01", "2026-11-28")).toEqual({ from: "2026-11-01", to: "2027-11-28" })
    })
})

describe("reporting a missing punch", () => {
    it("is sent the first day it may be reported for, with the day's balance", () => {
        const route = readFileSync("app/api/attendance/permissions/balance/route.ts", "utf8")
        expect(route).toContain("requestsFrom: (await AttendanceRequestService.requestDays(self.companyId)).from,")
    })

    it("offers the days from it to today", () => {
        const source = dialogs()
        expect(source).toContain("const from: string | undefined = days?.data?.requestsFrom ?? undefined")
        expect(source).toContain("<DatePickerSingle label={t('date_label')} value={date} minDate={from} maxDate={today} error={errors.date}")
    })

    it("is refused before it by the server, with the days", () => {
        const route = readFileSync("app/api/attendance/missing-punches/route.ts", "utf8")
        expect(route).toContain("if (error instanceof MissingPunchOutOfRange) return ApiResponse.refused(400, `Missing punches can be reported from ${error.from} to ${error.to}.`, error.message, { from: error.from, to: error.to })")
        const service = readFileSync("lib/services/attendance-request.service.ts", "utf8")
        expect(service).toContain("if (date < days.from) throw new MissingPunchOutOfRange(days.from, days.today)")
    })

    it("says the days under the date when refused, and goes to it", () => {
        const source = dialogs()
        expect(source).toContain("if (body.code === 'MISSING_PUNCH_OUT_OF_RANGE' && body.from && body.to) {")
        expect(source).toContain("setErrors(x => ({ ...x, date: daysText(t, locale, { from: body.from, to: body.to }, 'requests_missing_range') }))")
        const refusal = source.slice(source.indexOf("'MISSING_PUNCH_OUT_OF_RANGE'"))
        expect(refusal.slice(0, refusal.indexOf("return"))).toContain("form.querySelector<HTMLElement>('.ui-date-trigger')?.focus()")
    })

    it("says so in both languages", () => {
        expect(daysText(enT as never, "en", { from: "2026-11-01", to: "2026-11-28" }, "requests_missing_range")).toBe("Missing punches can be reported from 1 November to 28 November.")
        expect(daysText(arT as never, "ar", { from: "2026-11-01", to: "2026-11-28" }, "requests_missing_range")).toBe("يمكن الإبلاغ عن البصمات الناقصة من ١ نوفمبر إلى ٢٨ نوفمبر.")
    })

    it("is offered on Attendance only where the day the form opens on may be reported for", () => {
        const page = readFileSync("app/(dashboard)/dashboard/attendance/page.tsx", "utf8")
        expect(page).toContain("const reportable = (date: string) => !balanceBody?.data?.requestsFrom || date >= balanceBody.data.requestsFrom")
        expect(page).toContain("const reportOn = checkoutDate(d.date, d.expectedEndMinutes)")
        expect(page).toContain("const missing = (d.status === 'INCOMPLETE' || d.status === 'TO_CONFIRM') && reportable(reportOn)")
        expect(page).toContain("onClick={() => setReporting(reportOn)}")
    })
})

describe("missions' days back", () => {
    it("are gone from the policy, its dialog and its card", () => {
        for (const file of ["lib/attendance/policy.ts", "components/attendance-policy/policy-form.ts", "components/attendance-policy/PolicyDialog.tsx", "components/AttendancePolicyPanel.tsx", "lib/attendance/missions.ts"]) {
            expect(readFileSync(file, "utf8"), file).not.toMatch(/daysBack|DAYS_BACK|days_back/)
        }
        for (const words of [en, ar]) expect(Object.keys(words).filter(k => k.startsWith("attendance_mission_days_back") || k === "attendance_mission_from_today_line")).toEqual([])
    })
})

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { createElement as h } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { readFileSync } from "node:fs"
import { ar } from "./translations/ar"
import { en } from "./translations/en"

/**
 * Asking for a day off within its days (LATER_CHANGES_PLAN.md §7.4, 4a;
 * DESIGN.md §5.5, Asking for a day off): which days may be asked for, the
 * attendance policy's months ahead, and the form that offers only them,
 * with the balance under the dates.
 */

const state = { locale: "en" as "en" | "ar" }
vi.mock("@/context/LanguageContext", () => ({
    useLanguage: () => ({ locale: state.locale, t: (key: string) => (state.locale === "ar" ? ar : en)[key as keyof typeof en] ?? key }),
}))
vi.mock("@/context/ToastContext", () => ({ useToast: () => ({ showToast: () => {} }) }))
vi.mock("@/lib/useHydrated", () => ({ useHydrated: () => true }))
vi.mock("react-dom", async (importOriginal) => ({ ...(await importOriginal<typeof import("react-dom")>()), createPortal: (node: unknown) => node }))
beforeEach(() => { vi.stubGlobal("document", { body: {} }) })
afterEach(() => { vi.unstubAllGlobals(); state.locale = "en" })

describe("the days a day off may be asked for", () => {
    it("run from the 1st of last month, or the day after an approved payroll's period, to today plus the months ahead", async () => {
        const { dayOffWindow } = await import("./day-off-window")
        expect(dayOffWindow("2026-11-26", 1, null)).toEqual({ from: "2026-10-01", to: "2026-12-26" })
        // An approved month's period ending later than the 1st of last month: the day after it.
        expect(dayOffWindow("2026-11-26", 1, "2026-11-25")).toEqual({ from: "2026-11-25", to: "2026-12-26" })
        // One ending before it: never before the 1st of last month.
        expect(dayOffWindow("2026-11-26", 1, "2026-09-26")).toEqual({ from: "2026-10-01", to: "2026-12-26" })
        // Last month across the year.
        expect(dayOffWindow("2027-01-10", 1, null).from).toBe("2026-12-01")
        expect(dayOffWindow("2026-11-26", 12, null).to).toBe("2027-11-26")
    })

    it("end on that month's last day where it has fewer days (decided on 26 November)", async () => {
        const { dayOffWindow } = await import("./day-off-window")
        expect(dayOffWindow("2027-01-31", 1, null).to).toBe("2027-02-28")
        expect(dayOffWindow("2028-01-31", 1, null).to).toBe("2028-02-29")
        expect(dayOffWindow("2026-03-31", 1, null).to).toBe("2026-04-30")
        expect(dayOffWindow("2026-12-31", 2, null).to).toBe("2027-02-28")
        expect(dayOffWindow("2026-11-30", 3, null).to).toBe("2027-02-28")
    })

    it("count the days asked for as approving counts them", async () => {
        const { overBalance } = await import("./day-off-window")
        // Friday the 4th isn't counted, as approving doesn't: three days.
        expect(overBalance("2026-12-03", "2026-12-06", 3)).toBe(false)
        expect(overBalance("2026-12-03", "2026-12-06", 2.5)).toBe(true)
        expect(overBalance("2026-12-03", "2026-12-03", 0)).toBe(true)
        expect(overBalance("", "", 0)).toBe(false)
    })
})

describe("the attendance policy's months ahead", () => {
    it("is 1 to 12, and a version saved before it reads as 1", async () => {
        const { policyBodySchema, STANDARD_OFFICE, DAY_OFF_MONTHS_AHEAD } = await import("./attendance/policy")
        expect(DAY_OFF_MONTHS_AHEAD).toBe(1)
        expect(STANDARD_OFFICE.dayOffMonthsAhead).toBe(1)
        const before: Record<string, unknown> = { ...STANDARD_OFFICE }
        delete before.dayOffMonthsAhead
        expect(policyBodySchema.parse(before).dayOffMonthsAhead).toBe(1)
        expect(policyBodySchema.safeParse({ ...STANDARD_OFFICE, dayOffMonthsAhead: 12 }).success).toBe(true)
        expect(policyBodySchema.safeParse({ ...STANDARD_OFFICE, dayOffMonthsAhead: 0 }).success).toBe(false)
        expect(policyBodySchema.safeParse({ ...STANDARD_OFFICE, dayOffMonthsAhead: 13 }).success).toBe(false)
        expect(policyBodySchema.safeParse({ ...STANDARD_OFFICE, dayOffMonthsAhead: 1.5 }).success).toBe(false)
    })

    it("is kept through the policy's dialog", async () => {
        const { bodyFromForm, formFromBody } = await import("@/components/attendance-policy/policy-form")
        const { STANDARD_OFFICE } = await import("./attendance/policy")
        const form = formFromBody({ ...STANDARD_OFFICE, dayOffMonthsAhead: 4 })
        expect(form.dayOffMonthsAhead).toBe(4)
        expect(bodyFromForm({ ...form, dayOffMonthsAhead: 7 }, STANDARD_OFFICE)).toEqual({ ok: true, body: { ...STANDARD_OFFICE, dayOffMonthsAhead: 7 } })
        const dialog = readFileSync("components/attendance-policy/PolicyDialog.tsx", "utf8")
        expect(dialog).toContain("label={t('attendance_day_off_ahead')} hint={t('attendance_day_off_ahead_hint')}")
        expect(dialog).toContain("DAY_OFF_MONTHS.map(m => ({ value: String(m), label: t('attendance_day_off_ahead_option').replace('{months}', countOf(t, locale, m, 'months')) }))")
        // After Absence, before permission hours.
        expect(dialog.indexOf("attendance_day_off_ahead")).toBeGreaterThan(dialog.indexOf("attendance_absence_label"))
        expect(dialog.indexOf("attendance_day_off_ahead")).toBeLessThan(dialog.indexOf("attendance_permission_allowance"))
        const panel = readFileSync("components/AttendancePolicyPanel.tsx", "utf8")
        expect(panel).toContain("{ label: t('attendance_day_off'), value: t('attendance_day_off_line').replace('{months}', countOf(t, locale, shown.body.dayOffMonthsAhead, 'months')) }")
    })

    it("says so in both languages", () => {
        expect(en.attendance_day_off_ahead).toBe("Day off can be asked for")
        expect(en.attendance_day_off_ahead_option).toBe("Up to {months} ahead")
        expect(en.attendance_day_off_ahead_hint).toBe("Counted from today. The first day is never in a month whose payroll is approved.")
        expect(en.attendance_day_off).toBe("Day off")
        expect(en.attendance_day_off_line).toBe("Can be asked for up to {months} ahead")
        expect(ar.attendance_day_off_ahead).toBe("يمكن طلب الإجازة")
        expect(ar.attendance_day_off_ahead_option).toBe("حتى {months} مقدمًا")
        expect(ar.attendance_day_off_ahead_hint).toBe("تُحسب من اليوم، ولا يقع أول يوم أبدًا في شهر اعتُمدت رواتبه.")
        expect(ar.attendance_day_off).toBe("الإجازات")
        expect(ar.attendance_day_off_line).toBe("يمكن طلبها حتى {months} مقدمًا")
    })
})

describe("asking for a day off", () => {
    const ask = async (balance: number) => {
        const { AskDayOff } = await import("@/app/(dashboard)/dashboard/requests/DayOffDialogs")
        return renderToStaticMarkup(h(AskDayOff, { onCancel: () => {}, onAsked: () => {}, days: { from: "2026-11-01", to: "2026-12-27" }, balance }))
    }

    it("offers only the days that may be asked for, with the balance under the dates", async () => {
        expect(await ask(12)).toContain('class="ui-hint">Your balance: 12 days.</span>')
        state.locale = "ar"
        expect(await ask(1)).toContain('class="ui-hint">رصيدك: يوم واحد.</span>')
        const dialogs = readFileSync("app/(dashboard)/dashboard/requests/DayOffDialogs.tsx", "utf8")
        // Both pickers, a range and one day.
        expect(dialogs.split("minDate={days.from} maxDate={days.to}").length - 1).toBe(2)
        expect(dialogs).not.toContain("function today()")
    })

    it("warns when the days are more than the balance, and still sends it", async () => {
        const dialogs = readFileSync("app/(dashboard)/dashboard/requests/DayOffDialogs.tsx", "utf8")
        expect(dialogs).toContain("const short = overBalance(from, to, balance)")
        expect(dialogs).toContain("{short && <p className=\"ui-error\" role=\"status\">{t('requests_day_off_over_balance')}</p>}")
        expect(en.requests_day_off_over_balance).toBe("That's more than your balance, so if it's approved, it may come out of your pay.")
        expect(ar.requests_day_off_over_balance).toBe("هذا أكثر من رصيدك، لذا قد يُخصم من الراتب إذا تمت الموافقة عليه.")
        expect(en.requests_day_off_balance).toBe("Your balance: {days}.")
        expect(ar.requests_day_off_balance).toBe("رصيدك: {days}.")
    })

    it("says under the dates which days may be asked for, when a day outside them is refused", async () => {
        const { daysText } = await import("@/app/(dashboard)/dashboard/requests/DayOffDialogs")
        const t = (key: string) => en[key as keyof typeof en] ?? key
        expect(daysText(t as never, "en", { from: "2026-11-01", to: "2026-12-27" })).toBe("Days off can be asked for from 1 November to 27 December.")
        // Across the year, with both years.
        expect(daysText(t as never, "en", { from: "2026-12-01", to: "2027-01-31" })).toBe("Days off can be asked for from 1 December 2026 to 31 January 2027.")
        const ta = (key: string) => ar[key as keyof typeof ar] ?? key
        expect(daysText(ta as never, "ar", { from: "2026-11-01", to: "2026-12-27" })).toBe("يمكن طلب الإجازات من ١ نوفمبر إلى ٢٧ ديسمبر.")
        const dialogs = readFileSync("app/(dashboard)/dashboard/requests/DayOffDialogs.tsx", "utf8")
        expect(dialogs).toContain("if (body.code === 'DAY_OFF_OUT_OF_RANGE' && body.from && body.to) {")
        expect(dialogs).toContain("setDateError(daysText(t, locale, { from: body.from, to: body.to }))")
        expect(dialogs).not.toContain("DATE_IN_PAST")
    })
})

describe("the Requests page", () => {
    it("sends the form the days and the balance, as the server reads them", () => {
        const page = readFileSync("app/(dashboard)/dashboard/requests/page.tsx", "utf8")
        expect(page).toContain("const dayOffAsk = mayAskDayOff ? { days: await DayOffService.window(viewer.companyId ?? null), balance: (await prisma.user.findUnique({ where: { id: viewer.id }, select: { dayOffCredit: true } }))?.dayOffCredit ?? 0 } : null")
        const client = readFileSync("app/(dashboard)/dashboard/requests/RequestsClient.tsx", "utf8")
        expect(client).toContain("? <AskDayOff days={dayOffAsk.days} balance={dayOffAsk.balance} onCancel={close} onAsked={asked} />")
        expect(client).toContain("(k === 'dayOff' && !!dayOffAsk)")
    })

    it("answers a day outside them with the days that may be asked for", () => {
        const route = readFileSync("app/api/day-off-requests/route.ts", "utf8")
        expect(route).toContain("if (error instanceof DayOffOutOfRange) return ApiResponse.refused(400, `Leave can be asked for from ${error.from} to ${error.to}.`, error.message, { from: error.from, to: error.to })")
    })
})

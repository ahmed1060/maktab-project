import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { ar } from "./translations/ar"
import { en } from "./translations/en"
import { countOf } from "./plural"

/**
 * Permission hours' calendar offers only the days they may be asked for
 * (LATER_CHANGES_PLAN.md §7.20; DESIGN.md §5.5, Asking for permission hours):
 * around the day, from the day the hours after reach back to, saying how
 * long after, and hours ended too long ago refused under To in those words;
 * any day, its days, from the company's first policy at the earliest.
 */

const dialogs = () => readFileSync("app/(dashboard)/dashboard/requests/AttendanceDialogs.tsx", "utf8")
const enT = (key: string) => en[key as keyof typeof en] ?? key
const arT = (key: string) => ar[key as keyof typeof ar] ?? key

describe("asking for permission hours, around the day", () => {
    it("is sent the first day that may be asked for, with the day's balance", () => {
        const route = readFileSync("app/api/attendance/permissions/balance/route.ts", "utf8")
        expect(route).toContain("days: await AttendanceRequestService.permissionDays(self.companyId),")
        expect(route).toContain("earliest: await AttendanceRequestService.permissionEarliest(self.companyId, self.userId),")
    })

    it("offers the days from it, or any day's days, wherever the form opens", () => {
        const source = dialogs()
        expect(source).toContain("afterTheFactHours: number; days: DayOffDays | null; earliest: string | null; leftShown?: boolean }")
        expect(source).toContain("<DatePickerSingle label={t('date_label')} value={date} minDate={balance?.days?.from ?? balance?.earliest ?? undefined} maxDate={balance?.days?.to} error={errors.date} hint={when}")
    })

    it("says under the date how long after, only around the day", () => {
        const source = dialogs()
        expect(source).toContain("const when = balance?.enabled && !balance.days ? afterWords(balance.afterTheFactHours, 'requests_permission_when_around', 'requests_permission_when_ahead') : undefined")
    })

    it("refuses hours ended too long ago under To, in the hint's words, and goes to To", () => {
        const source = dialogs()
        expect(source).toContain("if (body.code === 'PERMISSION_TOO_LATE' && balance) {")
        expect(source).toContain("setErrors(x => ({ ...x, end: afterWords(balance.afterTheFactHours, 'requests_permission_too_late_hours', 'requests_permission_too_late_ahead') }))")
        expect(source).toContain("requestAnimationFrame(() => form.querySelector<HTMLElement>('input[name=\"end\"]')?.focus())")
    })

    it("says so in both languages, the hours counted as the language counts them", () => {
        expect(en.requests_permission_when_around.replace("{hours}", countOf(enT as never, "en", 24, "hours"))).toBe("Can be asked for ahead, or up to 24 hours after they end.")
        expect(en.requests_permission_when_ahead).toBe("Can be asked for only ahead.")
        expect(en.requests_permission_too_late_hours.replace("{hours}", countOf(enT as never, "en", 1, "hours"))).toBe("Too late for these hours: they can be asked for up to 1 hour after they end.")
        expect(en.requests_permission_too_late_ahead).toBe("Too late for these hours: they can be asked for only ahead.")
        expect(ar.requests_permission_when_around.replace("{hours}", countOf(arT as never, "ar", 24, "hours"))).toBe("يمكن طلبها مسبقًا، أو حتى ٢٤ ساعة بعد انتهائها.")
        expect(ar.requests_permission_when_ahead).toBe("يمكن طلبها مسبقًا فقط.")
        expect(ar.requests_permission_too_late_hours).toContain("{hours}")
        expect(ar.requests_permission_too_late_ahead).toBe("فات وقت طلب هذه الساعات: يمكن طلبها مسبقًا فقط.")
    })
})

describe("asking for permission hours from a day on Attendance", () => {
    it("is offered only on a day the form's calendar offers", () => {
        const page = readFileSync("app/(dashboard)/dashboard/attendance/page.tsx", "utf8")
        expect(page).toContain("const offered = (date: string) => offeredDay(date, balanceBody?.data)")
        expect(page).toContain("const ask = offered(d.date) ? askFor(d) : null")
    })

    it("reads the days as the form does", async () => {
        const { offeredDay } = await import("./day-off-window")
        // Any day: within its days.
        const anyDay = { days: { from: "2026-11-01", to: "2026-12-27" }, earliest: null }
        expect(offeredDay("2026-10-31", anyDay)).toBe(false)
        expect(offeredDay("2026-11-01", anyDay)).toBe(true)
        expect(offeredDay("2026-12-28", anyDay)).toBe(false)
        // Around the day: from its first, with no last.
        const around = { days: null, earliest: "2026-11-26" }
        expect(offeredDay("2026-11-25", around)).toBe(false)
        expect(offeredDay("2027-03-01", around)).toBe(true)
        // Before the balance has come, nothing is held back.
        expect(offeredDay("2026-01-01", undefined)).toBe(true)
    })
})

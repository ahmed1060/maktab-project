import { describe, it, expect } from "vitest"
import { endOfDayInEgypt } from "./time"

// Egypt is UTC+02:00 in winter and UTC+03:00 in summer — daylight saving was
// reintroduced in 2023, so a hardcoded offset is wrong for half of every year.
// End of a Cairo day is therefore 21:59:59.999Z in winter and 20:59:59.999Z in
// summer, and these assert the runtime's own timezone data agrees.

describe("endOfDayInEgypt", () => {
    it("winter: a day ends at 21:59:59.999Z", () => {
        expect(endOfDayInEgypt(new Date("2026-01-15T10:00:00Z")).toISOString())
            .toBe("2026-01-15T21:59:59.999Z")
    })

    it("summer: a day ends at 20:59:59.999Z", () => {
        expect(endOfDayInEgypt(new Date("2026-07-15T10:00:00Z")).toISOString())
            .toBe("2026-07-15T20:59:59.999Z")
    })

    it("is idempotent — the end of a day is still in that day", () => {
        const end = endOfDayInEgypt(new Date("2026-10-08T06:57:51Z"))
        expect(endOfDayInEgypt(end).toISOString()).toBe(end.toISOString())
    })

    it("extends rather than truncates: it is always at or after the instant given", () => {
        for (const iso of [
            "2026-01-01T00:00:00Z", "2026-06-30T23:00:00Z", "2026-10-08T08:57:51Z",
            "2027-09-08T16:21:31Z", "2026-03-15T12:00:00Z",
        ]) {
            const at = new Date(iso)
            expect(endOfDayInEgypt(at).getTime(), iso).toBeGreaterThanOrEqual(at.getTime())
        }
    })

    it("a late-evening UTC instant still belongs to the Cairo day it falls in", () => {
        // 22:30Z on 7 October is already 00:30 on 8 October in Cairo, so it
        // ends at the end of the 8th — not the 7th.
        expect(endOfDayInEgypt(new Date("2026-10-07T22:30:00Z")).toISOString())
            .toBe("2026-10-08T20:59:59.999Z")
    })

    it("gives a real subscription its whole last day", () => {
        // The live one: endDate 2026-10-08T08:57:51Z. A raw comparison would
        // expire it at 08:57 Cairo — mid-morning on the customer's last day.
        const raw = new Date("2026-10-08T08:57:51.760Z")
        const effective = endOfDayInEgypt(raw)
        expect(effective.getTime() - raw.getTime()).toBeGreaterThan(12 * 60 * 60 * 1000)
        expect(effective.toISOString()).toBe("2026-10-08T20:59:59.999Z")
    })
})

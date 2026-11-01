import { describe, it, expect } from "vitest"
import { countOf } from "./plural"
import { en } from "./translations/en"
import { ar } from "./translations/ar"

/** Counts in both languages (DESIGN.md §7): the word follows the number's plural form. */

const tEn = (k: string) => (en as Record<string, string>)[k] ?? k
const tAr = (k: string) => (ar as Record<string, string>)[k] ?? k

describe("a count with its word", () => {
    it("in English: one and other", () => {
        expect([0, 1, 2, 1.5, 12].map(n => countOf(tEn as any, "en", n, "days"))).toEqual(["0 days", "1 day", "2 days", "1.5 days", "12 days"])
        expect([1, 3].map(n => countOf(tEn as any, "en", n, "pts"))).toEqual(["1 pt", "3 pts"])
    })

    it("in Arabic: all six forms, in Arabic-Indic digits, with one and two written out", () => {
        expect([0, 1, 2, 3, 11, 100].map(n => countOf(tAr as any, "ar", n, "days"))).toEqual(["٠ يوم", "يوم واحد", "يومان", "٣ أيام", "١١ يومًا", "١٠٠ يوم"])
        expect([1, 2, 5, 20].map(n => countOf(tAr as any, "ar", n, "pts"))).toEqual(["نقطة واحدة", "نقطتان", "٥ نقاط", "٢٠ نقطة"])
        expect(countOf(tAr as any, "ar", 0.5, "days")).toBe("٠٫٥ يوم")
    })

    it("keeps a negative count's sign, in both languages", () => {
        // -1 and -2 take the one and two forms, which write 1 and 2 out.
        expect([-1, -2, -5].map(n => countOf(tEn as any, "en", n, "pts"))).toEqual(["-1 pts", "-2 pts", "-5 pts"])
        expect([-1, -2, -3, -11].map(n => countOf(tAr as any, "ar", n, "pts"))).toEqual(["\u061c-١ نقطة", "\u061c-٢ نقطة", "\u061c-٣ نقاط", "\u061c-١١ نقطة"])
    })

    it("says how many check-ins a new phone holds, in both languages (UI_PLAN.md §2.3, part 4b)", () => {
        expect([1, 3].map(n => countOf(tEn as any, "en", n, "held"))).toEqual(["1 check-in held", "3 check-ins held"])
        expect([1, 2, 3, 11, 100].map(n => countOf(tAr as any, "ar", n, "held"))).toEqual(["تسجيل حضور واحد معلّق", "تسجيلا حضور معلّقان", "٣ تسجيلات حضور معلّقة", "١١ تسجيل حضور معلّقًا", "١٠٠ تسجيل حضور معلّق"])
    })

    it("says how many companies work through a public holiday, in both languages (PR 146)", () => {
        expect([1, 3].map(n => countOf(tEn as any, "en", n, "companies"))).toEqual(["1 company", "3 companies"])
        expect([1, 2, 3, 11, 100].map(n => countOf(tAr as any, "ar", n, "companies"))).toEqual(["شركة واحدة", "شركتان", "٣ شركات", "١١ شركةً", "١٠٠ شركة"])
    })

    it("picks the form for the number as shown, to the places it's shown to (review on PR 149)", () => {
        // A deduction's days shown to four places: 1.0004 isn't "1 day", nor 1.9999 "يومان".
        expect(countOf(tEn as any, "en", 1.0004, "days", 4)).toBe("1.0004 days")
        expect(countOf(tAr as any, "ar", 1.9999, "days", 4)).toBe("١٫٩٩٩٩ يوم")
        // And to the two places shown by default, what shows as 1 is one.
        expect(countOf(tEn as any, "en", 1.004, "days")).toBe("1 day")
    })

    it("has every form in both languages, so none falls back to its key", () => {
        for (const word of ["days", "pts", "employees", "requests", "records", "files", "held", "companies"]) for (const form of ["zero", "one", "two", "few", "many", "other"]) {
            expect(en).toHaveProperty(`count_${word}_${form}`)
            expect(ar).toHaveProperty(`count_${word}_${form}`)
        }
    })
})

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

    it("has every form in both languages, so none falls back to its key", () => {
        for (const word of ["days", "pts", "employees"]) for (const form of ["zero", "one", "two", "few", "many", "other"]) {
            expect(en).toHaveProperty(`count_${word}_${form}`)
            expect(ar).toHaveProperty(`count_${word}_${form}`)
        }
    })
})

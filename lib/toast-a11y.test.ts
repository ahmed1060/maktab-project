import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { toastLifetime } from "@/context/ToastContext"

/**
 * "Saved", "Deleted" and error toasts had no live region, so screen readers
 * never announced them, and every one vanished after five seconds, even
 * while being read (WCAG 4.1.3, 2.2.1; accessibility audit of 4 October
 * 2026, M1).
 */
const SRC = readFileSync("context/ToastContext.tsx", "utf8")

describe("toasts", () => {
    it("an error stays until it is dismissed; the others go after five seconds", () => {
        expect(toastLifetime("error")).toBeNull()
        expect(toastLifetime("success")).toBe(5000)
        expect(toastLifetime("info")).toBe(5000)
        expect(toastLifetime("warning")).toBe(5000)
    })

    it("are announced: errors in an alert region, the rest in a status region, both always present", () => {
        expect(SRC).toMatch(/<div role="alert"[^>]*>\s*\{toasts\.filter\(t => t\.type === 'error'\)/)
        expect(SRC).toMatch(/<div role="status"[^>]*>\s*\{toasts\.filter\(t => t\.type !== 'error'\)/)
    })

    it("stop their clock while the pointer or focus is on them", () => {
        for (const h of ["onMouseEnter={() => setPaused(true)}", "onMouseLeave={() => setPaused(false)}", "onFocus={() => setPaused(true)}", "onBlur={() => setPaused(false)}"]) {
            expect(SRC).toContain(h)
        }
    })

    it("have a dismiss button that says what it does", () => {
        expect(SRC).toContain("aria-label={t('close')}")
    })
})

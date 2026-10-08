import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { toastLifetime, withToast, MAX_TOASTS, type Toast } from "@/context/ToastContext"

/**
 * "Saved", "Deleted" and error toasts had no live region, so screen readers
 * never announced them, and every one vanished after five seconds, even
 * while being read (WCAG 4.1.3, 2.2.1; accessibility audit of 4 October
 * 2026, M1). Errors then stayed until closed, over a phone's buttons.
 */
const SRC = readFileSync("context/ToastContext.tsx", "utf8")

describe("toasts", () => {
    it("an error stays long enough to read, longer for a longer message; the others go after five seconds", () => {
        // It closes on its own: it used to stay until the ✕ was found, over the screen's buttons on a phone.
        expect(toastLifetime("error", "Couldn't save")).toBe(10_000)
        const reference = "We couldn't complete that action. Please try again — if it keeps happening, share this reference with your admin: B762F306"
        expect(toastLifetime("error", reference)).toBeGreaterThan(10_000)
        expect(toastLifetime("error", reference)).toBeLessThanOrEqual(20_000)
        expect(toastLifetime("error", "x".repeat(2000))).toBe(20_000)
        expect(toastLifetime("success")).toBe(5000)
        expect(toastLifetime("info")).toBe(5000)
        expect(toastLifetime("warning")).toBe(5000)
    })

    it("are announced: errors in an alert region, the rest in a status region, both always present", () => {
        expect(SRC).toMatch(/<div role="alert"[^>]*>\s*\{toasts\.filter\(t => t\.type === 'error'\)/)
        expect(SRC).toMatch(/<div role="status"[^>]*>\s*\{toasts\.filter\(t => t\.type !== 'error'\)/)
        // Only the new toast is read, not every one still showing (Codex review on #37).
        expect(SRC).toContain('<div role="alert" aria-atomic="false"')
        expect(SRC).toContain('<div role="status" aria-atomic="false"')
    })

    it("stop their clock while the pointer, a finger or focus is on them, and restart only when both have left", () => {
        // One shared flag let leaving with the pointer restart the clock while
        // focus was still on the toast, and the other way round (Codex review on #37).
        // Pointer events, not mouse events: on a phone a finger holds it too.
        for (const h of ["onPointerEnter={() => setHovered(true)}", "onPointerLeave={() => setHovered(false)}", "onFocus={() => setFocused(true)}"]) {
            expect(SRC).toContain(h)
        }
        expect(SRC).toContain("const paused = hovered || focused")
        expect(SRC).toMatch(/onBlur=\{e => \{ if \(!e\.currentTarget\.contains\(e\.relatedTarget/)
    })

    it("have a dismiss button that says what it does", () => {
        expect(SRC).toContain("aria-label={t('close')}")
    })

    it("never pile up: a repeated message replaces itself, and only the newest few show (Codex review on #37)", () => {
        const err = (id: string, message = "Couldn't save"): Toast => ({ id, message, type: "error" })
        // The same failure again: one toast, the newest.
        expect(withToast([err("a")], err("b")).map(t => t.id)).toEqual(["b"])
        // A different message, or the same words as a different kind, both stay.
        expect(withToast([err("a")], err("b", "Other")).map(t => t.id)).toEqual(["a", "b"])
        expect(withToast([err("a")], { id: "b", message: "Couldn't save", type: "info" }).length).toBe(2)
        // Past the limit, the oldest goes.
        let list: Toast[] = []
        for (let i = 0; i < MAX_TOASTS + 3; i++) list = withToast(list, err(`e${i}`, `m${i}`))
        expect(list.length).toBe(MAX_TOASTS)
        expect(list[0].id).toBe("e3")
        expect(SRC).toContain("maxHeight: 'calc(100vh - 40px)'")
    })
})

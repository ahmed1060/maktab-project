import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { afterMovingOn, toastLifetime, withToast, MAX_TOASTS, type Toast } from "@/context/ToastContext"

/**
 * "Saved", "Deleted" and error toasts had no live region, so screen readers
 * never announced them, and every one vanished after five seconds, even
 * while being read (WCAG 4.1.3, 2.2.1; accessibility audit of 4 October
 * 2026, M1). Errors then stayed until closed, over a phone's buttons; they
 * now go when the person moves on, with no clock.
 */
const SRC = readFileSync("context/ToastContext.tsx", "utf8")

describe("toasts", () => {
    it("an error has no clock, which a screen reader's virtual cursor wouldn't stop (review on #49); the others go after five seconds", () => {
        expect(toastLifetime("error")).toBeNull()
        expect(toastLifetime("success")).toBe(5000)
        expect(toastLifetime("info")).toBe(5000)
        expect(toastLifetime("warning")).toBe(5000)
    })

    it("an error goes once the person moves on: a tap anywhere but on a toast, or another page", () => {
        const list: Toast[] = [{ id: "a", message: "Couldn't save", type: "error" }, { id: "b", message: "Saved", type: "success" }]
        // It used to stay until its ✕ was found, over a phone's buttons.
        expect(afterMovingOn(list).map(t => t.id)).toEqual(["b"])
        // Nothing to take away: the same list, so nothing renders again.
        const calm = [list[1]]
        expect(afterMovingOn(calm)).toBe(calm)
        expect(SRC).toContain("document.addEventListener('pointerdown', onDown, true)")
        expect(SRC).toContain("if (!region.current?.contains(e.target as Node)) setToasts(afterMovingOn)")
    })

    it("goes on another page, the query included: a tab or a filter moved to with the keyboard, or Back (review on #49)", () => {
        // The page is its path and its query; the provider hears of a change to either.
        expect(SRC).toContain("const page = `${usePathname()}?${useSearchParams().toString()}`")
        expect(SRC).toMatch(/if \(page === shown\.current\) return\s*shown\.current = page\s*onMove\(\)/)
        expect(SRC).toContain("const movedOn = useCallback(() => setToasts(afterMovingOn), [])")
        // In its own Suspense boundary, so reading the query doesn't hold the whole app back.
        expect(SRC).toContain("<Suspense fallback={null}><PageChanges onMove={movedOn} /></Suspense>")
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

    it("never pile up: a repeated message counts on the one showing, and only the newest few show (Codex review on #37)", () => {
        const err = (id: string, message = "Couldn't save"): Toast => ({ id, message, type: "error" })
        // The same failure again: one toast.
        expect(withToast([err("a")], err("b")).length).toBe(1)
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

    it("keep a repeated toast where it is, under its own key, so focus on its ✕ stays (review on #37)", () => {
        // Replaced by a new one, it was taken down and put up again, and a keyboard
        // user's focus on its ✕ fell back to the page.
        const err = (id: string, message = "Couldn't save"): Toast => ({ id, message, type: "error" })
        const list = [err("a"), err("b", "Other")]
        const again = withToast(list, err("c"))
        expect(again.map(t => t.id)).toEqual(["a", "b"])
        expect(again[0].repeat).toBe(1)
        expect(withToast(again, err("d"))[0].repeat).toBe(2)
        // Its text is put up again, keyed by the repeat, so it is read out again,
        // and its clock starts again.
        expect(SRC).toContain("<div key={repeat} style={{ color: '#1e293b'")
        expect(SRC).toContain("if (counted.current !== repeat) { counted.current = repeat; remaining.current = lifetime }")
    })
})

describe("the skip link's target (review on #37)", () => {
    it("stops below the sticky header, not under it", () => {
        const css = readFileSync("app/globals.css", "utf8")
        const shell = readFileSync("components/DashboardShell.tsx", "utf8")
        const header = readFileSync("components/DashboardHeader.tsx", "utf8")
        // The header: 72px tall, sticky at the top, and 1rem down once the page has scrolled.
        expect(header).toContain("height: '72px'")
        expect(shell).toContain("position: 'sticky'")
        expect(shell).toContain("marginTop: isScrolled ? '1rem' : '0'")
        expect(css).toMatch(/#main-content \{\s*scroll-margin-top: calc\(72px \+ 1rem\);/)
    })
})

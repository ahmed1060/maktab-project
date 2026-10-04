import { describe, it, expect, vi } from "vitest"
import { dialogKeyDown, focusables, trapTab } from "./focus-trap"

/**
 * Tab stays inside an open dialog: from the last element it goes to the
 * first and back. Before, it walked into the page behind the overlay
 * (accessibility audit, 4 October 2026, C2).
 */
function el(name: string, extra: Partial<{ tabIndex: number; disabled: boolean; type: string; hidden: boolean; ariaHidden: boolean }> = {}) {
    return {
        name, tabIndex: extra.tabIndex ?? 0, disabled: extra.disabled ?? false, type: extra.type,
        focus: vi.fn(),
        hasAttribute: (a: string) => a === "hidden" && !!extra.hidden,
        getAttribute: (a: string) => (a === "aria-hidden" && extra.ariaHidden ? "true" : null),
    }
}
const box = (items: ReturnType<typeof el>[]) => ({ querySelectorAll: () => items })
const key = (shiftKey = false) => ({ key: "Tab", shiftKey, preventDefault: vi.fn() })

describe("keeping Tab inside a dialog", () => {
    const first = el("first"), middle = el("middle"), last = el("last")
    const panel = box([first, el("off", { disabled: true }), middle, el("skip", { tabIndex: -1 }), el("gone", { hidden: true }), last])

    it("knows which elements Tab can reach", () => {
        expect(focusables(panel).map(e => (e as unknown as { name: string }).name)).toEqual(["first", "middle", "last"])
    })

    it("goes from the last to the first, and from the first back to the last", () => {
        const forward = key()
        expect(trapTab(forward, panel, last)).toBe(true)
        expect(forward.preventDefault).toHaveBeenCalled()
        expect(first.focus).toHaveBeenCalled()

        const back = key(true)
        expect(trapTab(back, panel, first)).toBe(true)
        expect(last.focus).toHaveBeenCalled()
    })

    it("leaves Tab alone in the middle", () => {
        const k = key()
        expect(trapTab(k, panel, middle)).toBe(false)
        expect(k.preventDefault).not.toHaveBeenCalled()
    })

    it("brings focus back in if it was outside", () => {
        const outside = el("page")
        const f = el("f"), l = el("l")
        expect(trapTab(key(), box([f, l]), outside)).toBe(true)
        expect(f.focus).toHaveBeenCalled()
    })

    it("ignores other keys, and keeps focus put when nothing inside can take it", () => {
        expect(trapTab({ key: "Enter", shiftKey: false, preventDefault: vi.fn() }, panel, last)).toBe(false)
        const k = key()
        expect(trapTab(k, box([]), null)).toBe(true)
        expect(k.preventDefault).toHaveBeenCalled()
    })
})

describe("a dialog's keys", () => {
    const a = el("a"), b = el("b")
    const inside = { name: "inside" }
    const panel = { ...box([a, b]), contains: (n: unknown) => n === inside || n === a || n === b }
    const ev = (key: string, target: unknown, shiftKey = false) => ({ key, shiftKey, target, preventDefault: vi.fn(), stopPropagation: vi.fn() })

    it("Escape inside closes it", () => {
        const close = vi.fn()
        expect(dialogKeyDown(ev("Escape", inside), panel, inside, close)).toBe("closed")
        expect(close).toHaveBeenCalled()
    })

    it("Escape does nothing when it can't be closed", () => {
        expect(dialogKeyDown(ev("Escape", inside), panel, inside, undefined)).toBe("ignored")
    })

    it("Tab inside wraps", () => {
        expect(dialogKeyDown(ev("Tab", b), panel, b, undefined)).toBe("trapped")
    })

    it("leaves alone keys from a pop-up opened from it, drawn elsewhere on the page", () => {
        // A date picker's calendar or a confirmation inside the dialog in React,
        // but elsewhere in the page: its Tab and Escape are its own.
        const inPicker = { name: "picker day" }
        const close = vi.fn()
        const tab = ev("Tab", inPicker)
        expect(dialogKeyDown(tab, panel, inPicker, close)).toBe("ignored")
        expect(tab.preventDefault).not.toHaveBeenCalled()
        expect(dialogKeyDown(ev("Escape", inPicker), panel, inPicker, close)).toBe("ignored")
        expect(close).not.toHaveBeenCalled()
    })
})

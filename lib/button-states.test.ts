import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"

/**
 * Every button shows what it is doing. Before, nothing in the stylesheet
 * styled a disabled button, so the 232 buttons that switch themselves off
 * while they save looked unchanged, and a click seemed to do nothing.
 */
const css = readFileSync("app/globals.css", "utf8")
const rule = (selector: string) => {
    const at = css.indexOf(`\n${selector} {`)
    return at < 0 ? null : css.slice(at, css.indexOf("}", at))
}

describe("button states, for every button", () => {
    it("a disabled button looks disabled, inline styles or not", () => {
        // Plain `button`, not only .btn: half the buttons are styled inline.
        const r = rule("button:disabled")
        expect(r).not.toBeNull()
        expect(r).toMatch(/cursor: not-allowed !important/)
        expect(r).toMatch(/opacity: 0\.6 !important/)
        expect(r).toMatch(/transform: none !important/)
    })

    it("a click is answered at once with a press", () => {
        expect(rule("button:not(:disabled):active")).toMatch(/transform:/)
    })

    it("a busy button turns a ring and says it is working", () => {
        expect(rule("button[aria-busy=\"true\"]")).toMatch(/cursor: progress/)
        expect(rule("button[aria-busy=\"true\"]::after")).toMatch(/animation: spin/)
        expect(css).toMatch(/@keyframes spin/)
    })
})

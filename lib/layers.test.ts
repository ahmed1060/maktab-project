import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { LAYER } from "./layers"

/**
 * The code a high-risk action asks for (ROLES_PLAN.md §6.15) opens over the
 * confirmation that sent the action, "Pay 7 costs, 3,450 EGP" or "Collect 7
 * charges", which stays open and busy until the answer comes. Drawn under
 * it, the code's Confirm couldn't be clicked, so the action couldn't go on.
 */
const css = readFileSync("components/ui/ui.css", "utf8")
const layer = (selector: string) => {
    const start = css.indexOf(`\n${selector} {`)
    return Number(css.slice(start, css.indexOf("}", start)).match(/z-index: (\d+);/)?.[1])
}

describe("the code prompt", () => {
    it("is above a confirmation, which is above a dialog", () => {
        expect(LAYER.codePrompt).toBeGreaterThan(LAYER.confirm)
        expect(LAYER.confirm).toBeGreaterThan(layer(".ui-dialog-backdrop"))
    })

    it("is drawn on its layer, and each confirmation and dialog on theirs", () => {
        // Both of its dialogs, the code and "set up two-factor sign-in first", are the building
        // blocks', above every other one (PR 217): they were the older pages' windows on this layer.
        const prompt = readFileSync("components/StepUpInterceptor.tsx", "utf8")
        expect(prompt.match(/<Dialog open\b[^>]*\baboveAll\b/g)).toHaveLength(2)
        // A dialog opened over another, as a new location over a task's edit window, sits on the
        // confirmations' layer, under the code. The older pages' window, and its layer under this
        // one, went in PR 222.
        expect(layer(".ui-dialog-backdrop.is-over-modal")).toBe(LAYER.confirm)
        expect(layer(".ui-dialog-backdrop.is-above-all")).toBe(LAYER.codePrompt)
        // And the toasts over them all (DESIGN.md §5.5, Toast).
        expect(layer(".ui-toasts")).toBeGreaterThan(LAYER.codePrompt)
    })
})

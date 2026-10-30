import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { LAYER } from "./layers"

/**
 * The code a high-risk action asks for (ROLES_PLAN.md §6.15) opens over the
 * confirmation that sent the action, "Pay 7 costs, 3,450 EGP" or "Collect 7
 * charges", which stays open and busy until the answer comes. Drawn under
 * it, the code's Confirm couldn't be clicked, so the action couldn't go on.
 */
describe("the code prompt", () => {
    it("is above a confirmation, which is above an older page's modal", () => {
        expect(LAYER.codePrompt).toBeGreaterThan(LAYER.confirm)
        expect(LAYER.confirm).toBeGreaterThan(LAYER.modal)
    })

    it("is drawn on its layer, and each confirmation and dialog on theirs", () => {
        const prompt = readFileSync("components/StepUpInterceptor.tsx", "utf8")
        // Both of its windows: the code, and "set up two-factor sign-in first".
        expect(prompt.match(/<Modal\b.*zIndex=\{LAYER\.codePrompt\}/g)).toHaveLength(2)
        expect(readFileSync("components/ConfirmModal.tsx", "utf8")).toMatch(/zIndex: LAYER\.confirm\b/)
        expect(readFileSync("components/Modal.tsx", "utf8")).toMatch(/zIndex = LAYER\.modal\b/)
        // A building-block dialog over an older page's modal sits with the confirmations, under the code.
        const over = readFileSync("components/ui/ui.css", "utf8").match(/\.ui-dialog-backdrop\.is-over-modal \{\s*z-index: (\d+);/)
        expect(Number(over?.[1])).toBeLessThan(LAYER.codePrompt)
    })
})

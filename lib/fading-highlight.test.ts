import { describe, it, expect } from "vitest"
import { createElement } from "react"
import { renderToString } from "react-dom/server"
import { readFileSync } from "node:fs"
import { stripComments } from "./strip-comments"
import { useFadingHighlight } from "./useFadingHighlight"

/**
 * ?highlight= handling, done once.
 *
 * Five screens copied the URL value into state inside an effect. That gives a
 * first render with no highlight and a second one with it — the double render
 * the React Compiler's set-state-in-effect rule flags. Server rendering runs
 * no effects at all, which makes it a clean way to see the first render on
 * its own.
 */

function Probe({ id }: { id: string | null }) {
    return createElement("span", null, String(useFadingHighlight(id, 6000)))
}

describe("the first render already agrees with the URL", () => {
    it("shows the highlighted id immediately", () => {
        // The effect-based version rendered "null" here and only caught up
        // on the second pass.
        expect(renderToString(createElement(Probe, { id: "abc" }))).toContain("abc")
    })

    it("shows nothing when there is nothing to highlight", () => {
        expect(renderToString(createElement(Probe, { id: null }))).toContain("null")
    })
})

describe("no screen goes back to copying it by hand", () => {
    const SCREENS = [
        "app/(dashboard)/dashboard/day-off-requests/page.tsx",
        "app/(dashboard)/dashboard/employees/[id]/history/page.tsx",
        "app/(dashboard)/dashboard/requests/history/RequestsHistoryClient.tsx",
        "components/requests/RequestsSection.tsx",
    ]
    for (const path of SCREENS) {
        it(path, () => {
            const src = stripComments(readFileSync(path, "utf8"))
            expect(src).toContain("useFadingHighlight(")
            expect(src).not.toMatch(/\bset(Visual)?HighlightId\b/)
        })
    }
})

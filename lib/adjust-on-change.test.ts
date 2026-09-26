import { describe, it, expect } from "vitest"
import { createElement, useState } from "react"
import { renderToString } from "react-dom/server"
import { readFileSync } from "node:fs"
import { stripComments } from "./strip-comments"
import { useAdjustOnChange } from "./useAdjustOnChange"

/**
 * useAdjustOnChange, and the screens that reset their pager with it.
 *
 * Server rendering runs no effects but does replay a component that sets
 * state while rendering, which is exactly the path this hook relies on. A
 * probe that moves its own value once during render shows both halves: the
 * first render does not adjust, the change does, once, and it settles.
 */

function Probe({ moveTo }: { moveTo: number | null }) {
    const [value, setValue] = useState(0)
    const [adjustments, setAdjustments] = useState(0)
    if (moveTo !== null && value !== moveTo) setValue(moveTo)
    useAdjustOnChange([value], () => setAdjustments(n => n + 1))
    return createElement("span", null, `value=${value} adjustments=${adjustments}`)
}

describe("useAdjustOnChange", () => {
    it("does nothing on the first render", () => {
        expect(renderToString(createElement(Probe, { moveTo: null }))).toContain("value=0 adjustments=0")
    })

    it("adjusts once, in the same pass, when the value changes", () => {
        // Before anything is committed: the output already reflects both the
        // new value and the adjustment, with no intermediate pass shown.
        expect(renderToString(createElement(Probe, { moveTo: 5 }))).toContain("value=5 adjustments=1")
    })
})

describe("list screens reset to page 1 during render, not in an effect", () => {
    // The effect version fetched the old page of the new results first and
    // page 1 second; if those answered out of order the list and the pager
    // disagreed.
    const SCREENS = [
        "app/(dashboard)/dashboard/all-users/page.tsx",
        "app/(dashboard)/dashboard/requests/history/RequestsHistoryClient.tsx",
        "components/requests/RequestsSection.tsx",
    ]
    for (const path of SCREENS) {
        it(path, () => {
            const src = stripComments(readFileSync(path, "utf8"))
            expect(src).toMatch(/useAdjustOnChange\(\[[^\]]*\bfilters\b[^\]]*\],\s*\(\)\s*=>\s*setPage\(1\)\)/)
            expect(src).not.toMatch(/useEffect\(\(\)\s*=>\s*\{?\s*setPage\(1\)/)
        })
    }
})

import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { stripComments } from "@/lib/strip-comments"
import { withChanges } from "@/components/filters/address"

/**
 * The Employee costs tab's search is sent once typing pauses. A filter
 * picked in that pause was undone when it was sent: its timer had the
 * address as the render that started it saw, without the filter, and sent
 * that back with the search (found by Codex on PR 117). Each change now
 * builds on the address as last changed.
 */

describe("the address a change is made to", () => {
    it("keeps a filter picked while the search waits", () => {
        let address = "page=1"
        // An employee picked; then the search typed before it is sent.
        address = withChanges(address, { employeeId: "u2" })
        address = withChanges(address, { search: "gate" })
        expect(Object.fromEntries(new URLSearchParams(address))).toEqual({ page: "1", employeeId: "u2", search: "gate" })
    })

    it("clears what's emptied, and goes back to the first page unless the page is what changes", () => {
        expect(withChanges("page=3&employeeId=u2&search=gate", { search: "" })).toBe("page=1&employeeId=u2")
        expect(withChanges("page=1&employeeId=u2", { page: "2" })).toBe("page=2&employeeId=u2")
    })

    it("is what the tab builds each change on, not the address of the render that made it", () => {
        const tab = stripComments(readFileSync("app/(dashboard)/dashboard/costs/CostsClient.tsx", "utf8"))
        // Built on what's picked last, by an update whichever render's timer makes it (lib/costs-picked-filters.test.ts).
        expect(tab).toContain("setShown(p => changed(p, changes))")
        expect(tab).not.toContain("new URLSearchParams(searchParams.toString())")
    })
})

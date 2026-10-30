import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { stripComments } from "@/lib/strip-comments"
import { arrived, changed, type Picked } from "@/components/filters/address"

/**
 * The Employee costs tab's filters show what was picked at once, and the
 * address follows. They were read from the address, which changes only
 * once its navigation lands, so the date range picker read its start back
 * from there for the end: picking the 10th and then the 20th before the
 * first navigation landed ended on ?dateTo=…-20 alone (found by Codex on
 * PR 117).
 */

const start = (address: string): Picked => ({ latest: address, sent: [] })
const params = (p: Picked) => Object.fromEntries(new URLSearchParams(p.latest))

describe("what's picked, ahead of the address", () => {
    it("has the start of a range for its end, before any navigation lands", () => {
        let p = start("page=1")
        p = changed(p, { dateFrom: "2026-10-10", dateTo: "2026-10-10" })
        // The picker reads its start from here for the end.
        p = changed(p, { dateFrom: params(p).dateFrom, dateTo: "2026-10-20" })
        expect(params(p)).toEqual({ page: "1", dateFrom: "2026-10-10", dateTo: "2026-10-20" })
    })

    it("keeps what's picked since as each of its own navigations lands", () => {
        let p = changed(changed(start("page=1"), { employeeId: "u2" }), { search: "gate" })
        p = arrived(p, "page=1&employeeId=u2")
        expect(params(p)).toEqual({ page: "1", employeeId: "u2", search: "gate" })
        p = arrived(p, p.latest)
        expect(p.sent).toEqual([])
    })

    it("takes the address when it changes some other way, as going back", () => {
        const p = arrived(changed(start("page=1"), { employeeId: "u2" }), "page=2&clientId=c1")
        expect(p).toEqual({ latest: "page=2&clientId=c1", sent: [] })
    })

    it("is what the tab's filters show", () => {
        const tab = stripComments(readFileSync("app/(dashboard)/dashboard/costs/CostsClient.tsx", "utf8"))
        expect(tab).toContain("const picked = new URLSearchParams(shown.latest)")
        expect(tab).toContain("setShown(p => changed(p, changes))")
    })
})

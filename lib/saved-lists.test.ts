import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { costNamed, pickIn, titleNamed, withCostNamed } from "./saved-lists"

/** The saved lists' rules both sides share (CLIENTS_PLAN.md §5). */

describe("a name picked from a company's list", () => {
    const picked = { name: { text: "Monthly inspection", entryId: "a-1" }, company: "A" }

    it("stays picked in the company it was picked in", () => {
        expect(pickIn(picked, "A")).toEqual({ text: "Monthly inspection", entryId: "a-1" })
    })

    it("is only its text once a Super Admin switches company, so the task isn't refused for another company's name", () => {
        expect(pickIn(picked, "B")).toEqual({ text: "Monthly inspection", entryId: null })
        expect(pickIn(picked, null)).toEqual({ text: "Monthly inspection", entryId: null })
        // Switched back, it's the first company's name again.
        expect(pickIn(picked, "A").entryId).toBe("a-1")
    })

    it("leaves a name typed as it is, whichever company", () => {
        const typed = { name: { text: "Fix the gate", entryId: null }, company: "A" }
        expect(pickIn(typed, "B")).toBe(typed.name)
    })

    it("is how New task holds its title, and what it sends", () => {
        const src = readFileSync("app/(dashboard)/dashboard/tasks/new/page.tsx", "utf8")
        expect(src).toContain("const titleName = pickIn(titlePick, selectedCompanyId)")
        expect(src).toContain("setTitlePick({ name: next, company: selectedCompanyId })")
        expect(src).toContain("titleEntryId: titleName.entryId ?? undefined")
    })
})

describe("a filter by a saved name (§5.9)", () => {
    const transport = { id: "n1", name: "Transport", companyId: "c1" }

    it("keeps what was picked as it, or typed the same, ignoring capitals, in its company", () => {
        expect(titleNamed(transport)).toEqual({ companyId: "c1", OR: [{ titleEntryId: "n1" }, { title: { equals: "Transport", mode: "insensitive" } }] })
        expect(costNamed(transport)).toEqual({ OR: [{ nameEntryId: "n1" }, { description: { equals: "Transport", mode: "insensitive" } }] })
        expect(withCostNamed(transport)).toEqual({ companyId: "c1", costs: { some: costNamed(transport) } })
    })

    it("takes a name's %, _ and \\ as typed: Prisma matches it with ILIKE", () => {
        const odd = { id: "n2", name: "50%_off\\net", companyId: "c1" }
        expect(costNamed(odd)).toEqual({ OR: [{ nameEntryId: "n2" }, { description: { equals: "50\\%\\_off\\\\net", mode: "insensitive" } }] })
        expect(titleNamed(odd)).toMatchObject({ OR: [{ titleEntryId: "n2" }, { title: { equals: "50\\%\\_off\\\\net" } }] })
    })

    it("keeps nothing for a name its viewer's company hasn't", () => {
        expect(titleNamed(null)).toEqual({ id: "__no_match__" })
        expect(withCostNamed(null)).toEqual({ id: "__no_match__" })
    })
})

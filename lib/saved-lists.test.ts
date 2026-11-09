import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { costNamed, nameOnList, pickIn, titleNamed, withCostNamed } from "./saved-lists"

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

describe("a cost's name where the company keeps them to its saved list (CLIENTS_PLAN.md §6.9; DESIGN.md §5.3)", () => {
    const LIST = [{ id: "n-train", name: "TRAIN" }, { id: "n-fare", name: "Train fare" }, { id: "n-taxi", name: "Taxi" }]
    // As /api/lists suggests: the names containing what's typed, capitals aside.
    const suggest = async (typed: string) => LIST.filter(n => n.name.toLowerCase().includes(typed.toLowerCase()))

    it("is the name picked, as picked", async () => {
        expect(await nameOnList({ text: "Taxi", entryId: "n-taxi" }, suggest)).toEqual({ name: { text: "Taxi", entryId: "n-taxi" } })
    })

    it("takes a name typed in full as the list has it, capitals and spaces aside, as if picked", async () => {
        expect(await nameOnList({ text: "train", entryId: null }, suggest)).toEqual({ name: { text: "TRAIN", entryId: "n-train" } })
        expect(await nameOnList({ text: "  train   FARE ", entryId: null }, suggest)).toEqual({ name: { text: "Train fare", entryId: "n-fare" } })
    })

    it("says a name is needed when none is typed", async () => {
        expect(await nameOnList({ text: "   ", entryId: null }, suggest)).toEqual({ problem: "needed", typed: "" })
    })

    it("says a name isn't on the list, as typed, when it's only part of one, or not there", async () => {
        expect(await nameOnList({ text: "Tra", entryId: null }, suggest)).toEqual({ problem: "not_listed", typed: "Tra" })
        expect(await nameOnList({ text: "Taxi  home", entryId: null }, suggest)).toEqual({ problem: "not_listed", typed: "Taxi home" })
        // A pattern is text, as the server matches it.
        expect(await nameOnList({ text: "%", entryId: null }, async () => LIST)).toEqual({ problem: "not_listed", typed: "%" })
    })
})

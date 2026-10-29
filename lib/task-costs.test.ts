import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { stripComments } from "@/lib/strip-comments"
import { cents, costEntry, costLines, readDescription } from "@/lib/task-costs"

/**
 * A task's costs (CLIENTS_PLAN.md §4.4, §4.5): which it has, its comments
 * say, as the release before reads and writes them; each one's id and
 * description are its row's.
 */
describe("a task's costs", () => {
    const at = "2026-10-22T10:00:00.000Z"
    const entry = (over: Record<string, unknown>) => ({ type: "COST_ADDITION", text: "Added cost: 1.00 EGP", amount: 1, author: "Ehab One", authorId: "e1", date: at, ...over })

    it("are the cost entries, in order, each with its row's id and description", () => {
        const comments = [
            entry({ amount: 150, costId: "r1" }),
            { type: "SUBMISSION_NOTE", text: "Done", date: at },
            entry({ amount: 40.5, costId: "r2", description: "From the entry" }),
        ]
        expect(costLines(comments, [{ id: "r2", description: "Parking" }, { id: "r1", description: "Taxi" }])).toEqual([
            { id: "r1", date: at, amount: 150, description: "Taxi", author: "Ehab One", authorId: "e1" },
            { id: "r2", date: at, amount: 40.5, description: "Parking", author: "Ehab One", authorId: "e1" },
        ])
    })

    it("include one the release before added, with no row, to remove by when it was added", () => {
        expect(costLines([entry({ amount: 75 })], [])).toEqual([{ id: null, date: at, amount: 75, description: null, author: "Ehab One", authorId: "e1" }])
    })

    it("leave out a row whose entry the release before removed", () => {
        expect(costLines([entry({ costId: "r1" })], [{ id: "r1", description: null }, { id: "gone", description: "Removed meanwhile" }]).map(c => c.id)).toEqual(["r1"])
    })

    it("are only entries for an amount above nothing, as the migration has it", () => {
        expect(costLines([entry({ amount: 0 }), entry({ amount: "12" }), entry({ amount: 0.004 }), entry({ amount: 0.01 })], []).map(c => c.amount)).toEqual([0.01])
    })

    it("are none for comments that aren't a list", () => {
        expect(costLines(null, [])).toEqual([])
        expect(costLines({ type: "COST_ADDITION" }, [])).toEqual([])
    })

    it("write each entry naming its row, with its description for the release before to show", () => {
        expect(costEntry({ id: "r1", amount: 150, description: "Taxi", author: "Ehab One", authorId: "e1", date: at })).toEqual({
            type: "COST_ADDITION", text: "Added cost: 150.00 EGP", amount: 150, costId: "r1", description: "Taxi", author: "Ehab One", authorId: "e1", date: at,
        })
        expect(costEntry({ id: "r2", amount: 5, description: null, author: null, authorId: "e1", date: at })).not.toHaveProperty("description")
    })

    it("keep a description up to 200 characters, trimmed, and refuse a longer one", () => {
        expect(readDescription("  Taxi  ")).toBe("Taxi")
        expect(readDescription("   ")).toBeNull()
        expect(readDescription(undefined)).toBeNull()
        expect(readDescription(42)).toBeNull()
        expect(readDescription("x".repeat(200))).toHaveLength(200)
        expect(() => readDescription("x".repeat(201))).toThrow("COST_DESCRIPTION_TOO_LONG")
    })

    it("keep amounts to the cent", () => {
        expect(cents(12.345)).toBe(12.35)
        expect(cents(0.004)).toBe(0)
        expect(cents(0.1 + 0.2)).toBe(0.3)
    })
})

describe("removing a cost the server refuses for good (CLIENTS_PLAN.md §4.2)", () => {
    // A cost whose person is paid stays, whatever's pressed again: the
    // window closes, and the page shows the task as it is now.
    const page = stripComments(readFileSync("app/(dashboard)/dashboard/tasks/[id]/client.tsx", "utf8"))
    const remove = page.slice(page.indexOf("const confirmDeleteItem"), page.indexOf("const confirmDeleteLocation"))
    const refused = remove.slice(remove.indexOf("if (!res.ok)"), remove.indexOf("return", remove.indexOf("if (!res.ok)")))

    it("closes the window and shows the task again", () => {
        expect(refused).toMatch(/res\.status === 409\)\s*\{\s*setItemToDelete\(null\);?\s*router\.refresh\(\)/)
    })
})

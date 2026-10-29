import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { stripComments } from "@/lib/strip-comments"
import { cents, costEntry, costLines, readDescription } from "@/lib/task-costs"

/**
 * A task's costs (CLIENTS_PLAN.md §4.4, §4.5): its rows, each with its id
 * and description, and an entry in its comments for the release before.
 */
describe("a task's costs", () => {
    const at = "2026-10-22T10:00:00.000Z"
    const entry = (over: Record<string, unknown>) => ({ type: "COST_ADDITION", text: "Added cost: 1.00 EGP", amount: 1, author: "Ehab One", authorId: "e1", date: at, ...over })

    const row = (id: string, over: Record<string, unknown> = {}) => ({ id, amount: 1, description: null, authorId: "e1", authorName: "Ehab One", createdAt: at, ...over })

    it("are the task's rows, each with its description, in the order they were added", () => {
        const later = "2026-10-22T11:00:00.000Z"
        expect(costLines([row("r2", { amount: 25, createdAt: later, description: "Parking" }), row("r1", { amount: 150, description: "Taxi" })], [])).toEqual([
            { id: "r1", date: at, amount: 150, description: "Taxi", author: "Ehab One", authorId: "e1" },
            { id: "r2", date: later, amount: 25, description: "Parking", author: "Ehab One", authorId: "e1" },
        ])
    })

    it("put those added together in the order their entries are in", () => {
        const comments = [{ type: "SUBMISSION_NOTE", text: "Done", date: at }, entry({ costId: "b" }), entry({ costId: "a" }), entry({ costId: "c" })]
        expect(costLines([row("a"), row("c"), row("b")], comments).map(c => c.id)).toEqual(["b", "a", "c"])
    })

    it("are the rows, whatever the comments hold", () => {
        expect(costLines([row("r1")], null).map(c => c.id)).toEqual(["r1"])
        expect(costLines([], [entry({ costId: "gone" }), entry({ amount: 75 })])).toEqual([])
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
        // Half a cent up, by its decimal digits, as Postgres's round() takes it:
        // 1.005 is a hair under in binary, and rounded down (Codex on #103).
        expect([cents(1.005), cents(10.075), cents(2.675), cents(1.255)]).toEqual([1.01, 10.08, 2.68, 1.26])
        expect([cents(1.004), cents(1e-7), cents(45.5)]).toEqual([1, 0, 45.5])
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

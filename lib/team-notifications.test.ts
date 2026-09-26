import { describe, it, expect } from "vitest"
import { planTeamNotifications, type TeamMove } from "./team-notifications"

const names = new Map([
    ["e-1", "Laila Fouad"], ["e-2", "Omar Said"], ["e-3", "Nour Adel"],
    ["tl-1", "Hana Ali"], ["tl-2", "Karim Farid"],
])

const forRecipient = (plan: ReturnType<typeof planTeamNotifications>, id: string) =>
    plan.filter(p => p.userId === id)

describe("one person moves", () => {
    const plan = planTeamNotifications([{ userId: "e-1", from: "tl-1", to: "tl-2" }], names)

    it("tells them who their leader is now", () => {
        expect(forRecipient(plan, "e-1")[0].message).toBe("Your team leader is now Karim Farid.")
    })

    it("tells the new leader by name", () => {
        expect(forRecipient(plan, "tl-2")[0].message).toBe("Laila Fouad joined your team.")
    })

    it("tells the old leader by name", () => {
        expect(forRecipient(plan, "tl-1")[0].message).toBe("Laila Fouad left your team.")
    })

    it("sends exactly three and nothing else", () => {
        expect(plan).toHaveLength(3)
    })
})

describe("a bulk move does not become a storm", () => {
    const moves: TeamMove[] = ["e-1", "e-2", "e-3"].map(id => ({ userId: id, from: null, to: "tl-1" }))
    const plan = planTeamNotifications(moves, names)

    it("reaches the leader once, with a count", () => {
        // Forty notifications to one person is how the first bulk assignment
        // teaches every leader to ignore the bell.
        const mine = forRecipient(plan, "tl-1")
        expect(mine).toHaveLength(1)
        expect(mine[0].message).toBe("3 people joined your team.")
    })

    it("reaches each employee once", () => {
        for (const id of ["e-1", "e-2", "e-3"]) expect(forRecipient(plan, id)).toHaveLength(1)
    })

    it("never sends one recipient two messages about one change", () => {
        const counts = new Map<string, number>()
        for (const p of plan) counts.set(p.userId, (counts.get(p.userId) ?? 0) + 1)
        expect([...counts.values()].every(n => n === 1)).toBe(true)
    })
})

describe("a leader who gains and loses in the same change", () => {
    it("gets one message that says both", () => {
        // A swap: e-1 moves tl-1 -> tl-2 while e-2 moves tl-2 -> tl-1.
        const plan = planTeamNotifications([
            { userId: "e-1", from: "tl-1", to: "tl-2" },
            { userId: "e-2", from: "tl-2", to: "tl-1" },
        ], names)
        const mine = forRecipient(plan, "tl-1")
        expect(mine).toHaveLength(1)
        expect(mine[0].message).toBe("Omar Said joined and Laila Fouad left your team.")
    })
})

describe("unassignment", () => {
    it("tells the employee what it means for them", () => {
        const plan = planTeamNotifications([{ userId: "e-1", from: "tl-1", to: null }], names)
        expect(forRecipient(plan, "e-1")[0].message).toMatch(/no longer assigned/)
        // Nobody to notify on the "to" side.
        expect(plan).toHaveLength(2)
    })
})

describe("nothing happened", () => {
    it("says nothing when somebody is moved to where they already are", () => {
        expect(planTeamNotifications([{ userId: "e-1", from: "tl-1", to: "tl-1" }], names)).toEqual([])
    })

    it("says nothing for an empty change", () => {
        expect(planTeamNotifications([], names)).toEqual([])
    })
})

import { describe, it, expect, vi, beforeEach } from "vitest"

/**
 * The sender's two promises: one notification per recipient per change, and
 * never failing a change that has already happened.
 */

const db = {
    people: [] as any[],
    written: null as any[] | null,
    fail: false,
}

vi.mock("@/lib/prisma", () => ({
    prisma: {
        user: { findMany: async () => db.people },
        notification: {
            createMany: async ({ data }: any) => {
                if (db.fail) throw new Error("database is down")
                db.written = data
                return { count: data.length }
            },
        },
    },
}))

beforeEach(() => {
    db.people = [
        { id: "e-1", firstName: "Laila", lastName: "Fouad" },
        { id: "e-2", firstName: "Omar", lastName: "Said" },
        { id: "tl-1", firstName: "Hana", lastName: "Ali" },
    ]
    db.written = null
    db.fail = false
})

async function send(moves: any[]) {
    const { notifyTeamMoves } = await import("@/lib/services/team-notify.service")
    return notifyTeamMoves(moves)
}

describe("what gets written", () => {
    it("one row per recipient, typed so the bell can route it", async () => {
        await send([
            { userId: "e-1", from: null, to: "tl-1" },
            { userId: "e-2", from: null, to: "tl-1" },
        ])
        expect(db.written).toHaveLength(3)
        expect(db.written!.every(r => r.type === "TEAM_CHANGED")).toBe(true)
        expect(db.written!.filter(r => r.userId === "tl-1")).toHaveLength(1)
    })

    it("uses real names, loaded rather than guessed", async () => {
        await send([{ userId: "e-1", from: null, to: "tl-1" }])
        expect(db.written!.find(r => r.userId === "e-1")!.message).toBe("Your team leader is now Hana Ali.")
    })

    it("writes nothing when nothing moved", async () => {
        await send([{ userId: "e-1", from: "tl-1", to: "tl-1" }])
        expect(db.written).toBeNull()
    })
})

describe("never fails the change it is reporting on", () => {
    it("swallows a failure rather than rejecting", async () => {
        // By the time this runs the change has committed. Rejecting would tell
        // the Admin it failed, and a retried bulk move is a second round of
        // everything.
        db.fail = true
        await expect(send([{ userId: "e-1", from: null, to: "tl-1" }])).resolves.toBeUndefined()
    })
})

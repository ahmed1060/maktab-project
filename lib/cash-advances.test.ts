import { describe, it, expect } from "vitest"
import { CASH_ADVANCE_MAX, balanceAfter, cashAdvancesInUse, dayOf, forOf, heldPartKey, partsToPick, paysFirst, signedAmount, type HeldPart } from "./cash-advances"

/** Cash advances' rules as the screens and the server both take them (CLIENTS_PLAN.md §7). */
describe("cash advances", () => {
    it("are used while the Super Admin allows them and the Admin has them on (§7.6)", () => {
        expect(cashAdvancesInUse({ cashAdvancesAllowed: true, cashAdvancesOn: true })).toBe(true)
        expect(cashAdvancesInUse({ cashAdvancesAllowed: true, cashAdvancesOn: false })).toBe(false)
        expect(cashAdvancesInUse({ cashAdvancesAllowed: false, cashAdvancesOn: true })).toBe(false)
        expect(cashAdvancesInUse(null)).toBe(false)
    })

    it("sign each entry's amount as the balance takes it, to the piastre (§7.4)", () => {
        expect(signedAmount("GIVEN", "1000")).toBe(1000)
        expect(signedAmount("GIVEN", 0.105)).toBe(0.11)
        expect(signedAmount("RETURNED", 300)).toBe(-300)
        expect(signedAmount("CORRECTION", -20.5)).toBe(-20.5)
        expect(signedAmount("CORRECTION", 20.5)).toBe(20.5)
        expect(signedAmount("GIVEN", CASH_ADVANCE_MAX)).toBe(CASH_ADVANCE_MAX)
    })

    it("refuse amounts that can't be one", () => {
        for (const raw of [0, 0.004, -1, "", " ", "x", null, undefined, NaN, Infinity, CASH_ADVANCE_MAX + 0.01]) {
            expect(signedAmount("GIVEN", raw), String(raw)).toBeNull()
        }
        expect(signedAmount("RETURNED", -5)).toBeNull()
        expect(signedAmount("CORRECTION", 0)).toBeNull()
        expect(signedAmount("CORRECTION", -CASH_ADVANCE_MAX - 1)).toBeNull()
    })

    it("never take a balance below zero", () => {
        expect(balanceAfter(700, -700)).toBe(0)
        expect(balanceAfter(0.3, -0.1)).toBe(0.2)
        expect(balanceAfter(700, -700.01)).toBeNull()
        expect(balanceAfter(0, 50)).toBe(50)
    })

    it("are for one task or one client, or neither (§7.9)", () => {
        expect(forOf({})).toEqual({ taskId: null, clientId: null })
        expect(forOf({ forTaskId: "", forClientId: null })).toEqual({ taskId: null, clientId: null })
        expect(forOf({ forTaskId: "k1" })).toEqual({ taskId: "k1", clientId: null })
        expect(forOf({ forClientId: "c1" })).toEqual({ taskId: null, clientId: "c1" })
        expect(forOf({ forTaskId: "k1", forClientId: "c1" })).toBeNull()
        expect(forOf({ forTaskId: 7 })).toBeNull()
        expect(forOf({ forClientId: "x".repeat(65) })).toBeNull()
    })

    it("pay a cost from the money for its task, then its client, then the running balance, as Add cost says (§7.9)", () => {
        const held = [
            { forTask: { id: "k1", title: "Fix the gate" }, forClient: null, amount: 400 },
            { forTask: { id: "k2", title: "Elsewhere" }, forClient: null, amount: 90 },
            { forTask: null, forClient: { id: "c1", name: "Nile Foods" }, amount: 300 },
            { forTask: null, forClient: { id: "c2", name: "Delta" }, amount: 70 },
        ]
        expect(paysFirst(held, 665, { taskId: "k1", clientId: "c1" })).toEqual([
            { kind: "task", amount: 400 },
            { kind: "client", name: "Nile Foods", amount: 300 },
            { kind: "running", amount: 665 },
        ])
        // Another task or client's money never pays it; nothing held for this one, it isn't said.
        expect(paysFirst(held, 665, { taskId: "k3", clientId: null })).toEqual([{ kind: "running", amount: 665 }])
        expect(paysFirst(held, 0, { taskId: "k3", clientId: "c2" })).toEqual([{ kind: "client", name: "Delta", amount: 70 }])
        expect(paysFirst([], 0, { taskId: "k1", clientId: "c1" })).toEqual([])
    })

    it("take a day only as a real day of the calendar", () => {
        expect(dayOf("2026-10-30")).toBe("2026-10-30")
        expect(dayOf("2028-02-29")).toBe("2028-02-29")
        for (const raw of ["2026-02-30", "2026-13-01", "30/10/2026", "2026-10-30T00:00", "", null, 20261030]) expect(dayOf(raw), String(raw)).toBeNull()
    })

    // Record return and Correction are drawn again while open (REALTIME_PLAN.md,
    // part 4a). A part picked there, then spent or moved elsewhere, leaves
    // what's held; the amount typed was then saved against the running
    // balance instead (found by Codex on PR 252).
    describe("the parts a return or a correction can be on (§7.9)", () => {
        const gate: HeldPart = { forTask: { id: "t1", title: "Fix the gate" }, forClient: null, amount: 400 }
        const nile: HeldPart = { forTask: null, forClient: { id: "c1", name: "Nile Foods" }, amount: 300 }

        it("are told apart as the From field picks them, the running balance as nothing", () => {
            expect(heldPartKey(gate)).toBe("task:t1")
            expect(heldPartKey(nile)).toBe("client:c1")
            expect(heldPartKey({ forTask: null, forClient: null })).toBe("")
        })

        it("are what's held, while the one picked is among them, or none is", () => {
            expect(partsToPick([gate, nile], "", null)).toEqual([gate, nile])
            expect(partsToPick([gate, nile], "task:t1", gate)).toEqual([gate, nile])
            // Held for less now: as it's held, not as it was picked.
            expect(partsToPick([{ ...gate, amount: 150 }, nile], "task:t1", gate)).toEqual([{ ...gate, amount: 150 }, nile])
        })

        it("keep the one picked, holding nothing, once it's gone, so no amount can be saved against it", () => {
            const parts = partsToPick([nile], "task:t1", gate)
            expect(parts).toEqual([nile, { ...gate, amount: 0 }])
            const picked = parts.find(part => heldPartKey(part) === "task:t1")!
            expect(balanceAfter(picked.amount, signedAmount("RETURNED", 10)!)).toBeNull()
            // The last part held, gone: the field is still there to pick another.
            expect(partsToPick([], "client:c1", nile)).toEqual([{ ...nile, amount: 0 }])
        })
    })
})

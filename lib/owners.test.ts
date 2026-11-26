import { describe, it, expect } from "vitest"
import { ownerIn, ownerSince, planOwner, ownerRefusal, notOwnerIn } from "./owners"

/**
 * Owners (LATER_CHANGES_PLAN.md §7.3, step 3a, PR 426): each time someone
 * is an owner, from the start of the month they're marked to the start of
 * the month they're no longer one; whether they're one in a month, and
 * what marking them, or taking it off, does to their periods.
 */

const at = (iso: string) => new Date(iso)
const OCT = at("2026-09-30T21:00:00Z"), NOV = at("2026-10-31T22:00:00Z"), DEC = at("2026-11-30T22:00:00Z"), JAN = at("2026-12-31T22:00:00Z")

describe("whether someone is an owner in a month", () => {
    it("is from the month their period starts, until the month it ends", () => {
        const periods = [{ id: "p1", startsAt: NOV, endsAt: JAN }]
        expect(ownerIn(periods, OCT)).toBe(false)
        expect(ownerIn(periods, NOV)).toBe(true)
        expect(ownerIn(periods, DEC)).toBe(true)
        expect(ownerIn(periods, JAN)).toBe(false)
    })

    it("is every month from its start while it's open, and in any of their periods", () => {
        expect(ownerIn([{ id: "p1", startsAt: NOV, endsAt: null }], JAN)).toBe(true)
        expect(ownerIn([{ id: "p1", startsAt: OCT, endsAt: NOV }, { id: "p2", startsAt: DEC, endsAt: null }], NOV)).toBe(false)
        expect(ownerIn([{ id: "p1", startsAt: OCT, endsAt: NOV }, { id: "p2", startsAt: DEC, endsAt: null }], OCT)).toBe(true)
        expect(ownerIn([], NOV)).toBe(false)
    })

    it("asks the database the same, for the people who aren't", () => {
        expect(notOwnerIn(NOV)).toEqual({ NOT: { ownerPeriods: { some: { startsAt: { lte: NOV }, OR: [{ endsAt: null }, { endsAt: { gt: NOV } }] } } } })
    })

    it("says since when they're one now, from their open period", () => {
        expect(ownerSince([{ id: "p1", startsAt: OCT, endsAt: NOV }, { id: "p2", startsAt: DEC, endsAt: null }])).toEqual(DEC)
        expect(ownerSince([{ id: "p1", startsAt: OCT, endsAt: NOV }])).toBeNull()
    })
})

describe("marking someone as an owner, or taking it off", () => {
    it("starts a period this month", () => {
        expect(planOwner([], NOV, true)).toEqual({ ok: true, action: "create" })
        expect(planOwner([{ id: "p1", startsAt: OCT, endsAt: NOV }], DEC, true)).toEqual({ ok: true, action: "create" })
    })

    it("carries on the period taken off this month, rather than start another", () => {
        expect(planOwner([{ id: "p1", startsAt: OCT, endsAt: NOV }], NOV, true)).toEqual({ ok: true, action: "reopen", id: "p1" })
    })

    it("ends the open period this month, the months before staying an owner's", () => {
        expect(planOwner([{ id: "p1", startsAt: OCT, endsAt: null }], DEC, false)).toEqual({ ok: true, action: "close", id: "p1" })
    })

    it("takes off a period started this month as if it never was", () => {
        expect(planOwner([{ id: "p1", startsAt: NOV, endsAt: null }], NOV, false)).toEqual({ ok: true, action: "delete", id: "p1" })
    })

    it("refuses what they are already", () => {
        expect(planOwner([{ id: "p1", startsAt: OCT, endsAt: null }], NOV, true)).toEqual({ ok: false, refusal: "ALREADY_OWNER" })
        expect(planOwner([{ id: "p1", startsAt: OCT, endsAt: NOV }], DEC, false)).toEqual({ ok: false, refusal: "NOT_OWNER" })
        expect(planOwner([], DEC, false)).toEqual({ ok: false, refusal: "NOT_OWNER" })
    })
})

describe("what's refused, in words", () => {
    it("says each, and nothing for what isn't one", () => {
        expect(ownerRefusal("OWNER_OPEN_WORK")).toBe("owner_open_work")
        expect(ownerRefusal("PAYROLL_MONTH_LOCKED")).toBe("owner_month_locked")
        expect(ownerRefusal("ALREADY_OWNER")).toBe("owner_already")
        expect(ownerRefusal("NOT_OWNER")).toBe("owner_not")
        expect(ownerRefusal("NO_COMPANY")).toBe("owner_no_company")
        expect(ownerRefusal("SOMETHING_ELSE")).toBeNull()
        expect(ownerRefusal(undefined)).toBeNull()
    })
})

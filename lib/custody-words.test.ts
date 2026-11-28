import { describe, it, expect } from "vitest"
import { en as english } from "./translations/en"
import { ar as arabic } from "./translations/ar"
import { KNOWN_REFUSALS } from "./api-errors"

/**
 * Custody, not an advance (LATER_CHANGES_PLAN.md §7.5, step 1; DESIGN.md
 * §3.4): money given to an employee up front, to pay task costs from, is
 * Custody in English, as it's العُهدة in Arabic. "Advance" is left for the
 * Salary advance (سلفة), a loan paid back from payslips, so the two never
 * share a word. Only the words change: keys, addresses and codes stay.
 */

const en = english as Record<string, unknown>
const ar = arabic as Record<string, string>

/**
 * What a string says once "in advance" (ahead of time) and the Salary
 * advance, the word's own now (§7.5, step 2, PR 445), are set aside, and its
 * placeholders, such as {advance}, which the reader sees as an amount.
 */
const saidOf = (text: string) => text.replace(/\{[^}]*\}/g, "").replace(/\bin advance\b/gi, "").replace(/\bsalary advances?\b/gi, "")
const sayAdvance = (text: string) => /\badvances?\b/i.test(saidOf(text))

describe("Custody in English", () => {
    it("no English string calls it an advance", () => {
        const said = Object.entries(en).filter(([, v]) => typeof v === "string" && sayAdvance(v)).map(([k, v]) => `${k}: ${v}`)
        expect(said).toEqual([])
    })

    it("no refusal the server gives calls it an advance", () => {
        const said = Object.entries(KNOWN_REFUSALS).filter(([, r]) => sayAdvance(r.message)).map(([k, r]) => `${k}: ${r.message}`)
        expect(said).toEqual([])
    })

    it("is Custody on the Costs page, in the side bar and in Company Settings", () => {
        expect(en.costs_tab_advances).toBe("Custody")
        expect(en.my_cash_advance).toBe("My custody")
        expect(en.advances_settings_title).toBe("Custody")
        expect(en.advances_allow).toBe("Allow custody")
        expect(en.advances_use_label).toBe("Use custody")
    })

    it("is given, held and confirmed as custody", () => {
        expect(en.advances_give).toBe("Give custody")
        expect(en.advances_give_title).toBe("Give {name} custody")
        expect(en.advances_given_done).toBe("Custody given")
        expect(en.advances_kind_given).toBe("Custody given")
        expect(en.advances_filter_holding).toBe("Holding custody")
        expect(en.advances_from_advance).toBe("From custody")
        expect(en.advances_add_cost_hint).toBe("Your custody: {amount}. Costs you add are paid from it first.")
    })

    it("is custody in the permissions, the audit log and the debts", () => {
        expect(en.perm_cash_advances_view).toBe("See custody")
        expect(en.perm_cash_advances_give).toBe("Give and settle custody")
        expect(en.audit_action_GIVE_CASH_ADVANCE).toBe("Gave custody")
        expect(en.debt_source_CASH_ADVANCE).toBe("Custody")
    })

    it("names the tab a contract's end points to by its own name", () => {
        expect(en.end_contract_advance_stays).toContain(en.costs_tab_advances as string)
    })
})

describe("the Arabic, already العُهد, stays as it was", () => {
    it("says عهدة where English now says custody", () => {
        expect(ar.costs_tab_advances).toBe("العُهد")
        expect(ar.my_cash_advance).toBe("عهدتي")
        expect(ar.advances_give).toBe("صرف عهدة")
        expect(ar.perm_cash_advances_view).toBe("عرض العُهد")
        expect(ar.debt_source_CASH_ADVANCE).toBe("عهدة")
    })

    it("never says سلفة, the Salary advance's word, for custody", () => {
        const said = Object.entries(ar).filter(([k, v]) => /سلف/.test(v) && (k.startsWith("advances_") || k.includes("cash_advance") || k.includes("CASH_ADVANCE")))
        expect(said).toEqual([])
    })
})

import { describe, it, expect } from "vitest"
import { contractStartRange, inContractStartRange, planContractStart, startMovedBetween } from "./contract-start"

/**
 * The contract start date (LATER_CHANGES_PLAN.md §7.2, step 1): the days it
 * may be set to, and what changing it does to someone's job and salary
 * history, worked out before anything is written.
 */

const at = (iso: string) => new Date(iso)
const HIRED = { id: "h1", type: "HIRED", effectiveFrom: at("2026-11-19T22:00:00Z") }
const STARTING = { id: "s1", effectiveFrom: at("2026-11-19T22:00:00Z"), createdAt: at("2026-11-20T08:00:00Z") }

describe("the days a contract may start on", () => {
    it("runs from a year back to a year ahead of today", () => {
        expect(contractStartRange("2026-11-26")).toEqual({ min: "2025-11-26", max: "2027-11-26" })
        expect(contractStartRange("2028-02-29")).toEqual({ min: "2027-02-28", max: "2029-02-28" })
    })

    it("takes a date in it, and refuses one outside it or not a date", () => {
        expect(inContractStartRange("2026-11-01", "2026-11-26")).toBe(true)
        expect(inContractStartRange("2025-11-26", "2026-11-26")).toBe(true)
        expect(inContractStartRange("2027-11-26", "2026-11-26")).toBe(true)
        expect(inContractStartRange("2025-11-25", "2026-11-26")).toBe(false)
        expect(inContractStartRange("2027-11-27", "2026-11-26")).toBe(false)
        expect(inContractStartRange("2026-13-01", "2026-11-26")).toBe(false)
        expect(inContractStartRange("26/11/2026", "2026-11-26")).toBe(false)
    })
})

describe("changing a contract's start", () => {
    it("moves the hiring and the starting salary dated with it, earlier", () => {
        const plan = planContractStart({ to: at("2026-10-31T22:00:00Z"), events: [HIRED], salaries: [STARTING] })
        expect(plan).toEqual({ ok: true, hireId: "h1", from: HIRED.effectiveFrom, moveSalaryIds: ["s1"] })
    })

    it("moves them later too, while nothing else was recorded before the new date", () => {
        const plan = planContractStart({ to: at("2026-11-30T22:00:00Z"), events: [HIRED], salaries: [STARTING] })
        expect(plan).toEqual({ ok: true, hireId: "h1", from: HIRED.effectiveFrom, moveSalaryIds: ["s1"] })
    })

    it("refuses the date it already starts on", () => {
        expect(planContractStart({ to: HIRED.effectiveFrom, events: [HIRED], salaries: [STARTING] })).toEqual({ ok: false, refusal: "CONTRACT_START_SAME" })
    })

    it("refuses someone with no hiring on record", () => {
        expect(planContractStart({ to: at("2026-10-31T22:00:00Z"), events: [], salaries: [STARTING] })).toEqual({ ok: false, refusal: "NO_CONTRACT_START" })
    })

    it("refuses a start later than a salary change after it", () => {
        const raise = { id: "s2", effectiveFrom: at("2026-11-24T22:00:00Z"), createdAt: at("2026-11-25T08:00:00Z") }
        expect(planContractStart({ to: at("2026-11-30T22:00:00Z"), events: [HIRED], salaries: [STARTING, raise] })).toEqual({ ok: false, refusal: "CONTRACT_START_AFTER_CHANGE" })
        // On the day of the raise, too: the raise would be the start's salary.
        expect(planContractStart({ to: raise.effectiveFrom, events: [HIRED], salaries: [STARTING, raise] })).toEqual({ ok: false, refusal: "CONTRACT_START_AFTER_CHANGE" })
        // Before it, the starting salary moves and the raise stays.
        expect(planContractStart({ to: at("2026-11-21T22:00:00Z"), events: [HIRED], salaries: [STARTING, raise] }))
            .toEqual({ ok: true, hireId: "h1", from: HIRED.effectiveFrom, moveSalaryIds: ["s1"] })
    })

    it("refuses a start on or after anything else recorded about their job", () => {
        const suspended = { id: "e2", type: "SUSPENDED", effectiveFrom: at("2026-11-24T22:00:00Z") }
        expect(planContractStart({ to: at("2026-11-30T22:00:00Z"), events: [HIRED, suspended], salaries: [STARTING] })).toEqual({ ok: false, refusal: "CONTRACT_START_AFTER_CHANGE" })
        expect(planContractStart({ to: suspended.effectiveFrom, events: [HIRED, suspended], salaries: [STARTING] })).toEqual({ ok: false, refusal: "CONTRACT_START_AFTER_CHANGE" })
        expect(planContractStart({ to: at("2026-10-31T22:00:00Z"), events: [HIRED, suspended], salaries: [STARTING] }))
            .toEqual({ ok: true, hireId: "h1", from: HIRED.effectiveFrom, moveSalaryIds: ["s1"] })
    })

    it("is about their first hiring, where they were hired again after an end", () => {
        const ended = { id: "e2", type: "CONTRACT_ENDED", effectiveFrom: at("2027-01-31T22:00:00Z") }
        const again = { id: "e3", type: "REINSTATED", effectiveFrom: at("2027-03-31T22:00:00Z") }
        expect(planContractStart({ to: at("2026-10-31T22:00:00Z"), events: [again, ended, HIRED], salaries: [STARTING] }))
            .toEqual({ ok: true, hireId: "h1", from: HIRED.effectiveFrom, moveSalaryIds: ["s1"] })
    })

    it("is their first of two hirings, where two are on record", () => {
        const second = { id: "h2", type: "HIRED", effectiveFrom: at("2027-03-31T22:00:00Z") }
        expect(planContractStart({ to: at("2026-10-31T22:00:00Z"), events: [second, HIRED], salaries: [STARTING] }))
            .toEqual({ ok: true, hireId: "h1", from: HIRED.effectiveFrom, moveSalaryIds: ["s1"] })
    })

    it("leaves a salary history that starts before the contract as it is", () => {
        // Their salary was dated earlier by hand: it stays, and so does the one at the start.
        const earlier = { id: "s0", effectiveFrom: at("2026-10-31T22:00:00Z"), createdAt: at("2026-11-21T08:00:00Z") }
        expect(planContractStart({ to: at("2026-10-31T22:00:00Z"), events: [HIRED], salaries: [STARTING, earlier] }))
            .toEqual({ ok: true, hireId: "h1", from: HIRED.effectiveFrom, moveSalaryIds: [] })
        expect(planContractStart({ to: at("2026-11-04T22:00:00Z"), events: [HIRED], salaries: [STARTING, earlier] }))
            .toEqual({ ok: true, hireId: "h1", from: HIRED.effectiveFrom, moveSalaryIds: [] })
    })

    it("moves their first salary to a start before it, so a salary is in force from the start", () => {
        const earlier = { id: "s0", effectiveFrom: at("2026-11-04T22:00:00Z"), createdAt: at("2026-11-21T08:00:00Z") }
        expect(planContractStart({ to: at("2026-10-31T22:00:00Z"), events: [HIRED], salaries: [STARTING, earlier] }))
            .toEqual({ ok: true, hireId: "h1", from: HIRED.effectiveFrom, moveSalaryIds: ["s0"] })
    })

    it("moves each salary dated the start, a correction made the same day too", () => {
        const corrected = { id: "s1b", effectiveFrom: STARTING.effectiveFrom, createdAt: at("2026-11-20T09:00:00Z") }
        expect(planContractStart({ to: at("2026-10-31T22:00:00Z"), events: [HIRED], salaries: [corrected, STARTING] }))
            .toEqual({ ok: true, hireId: "h1", from: HIRED.effectiveFrom, moveSalaryIds: ["s1", "s1b"] })
    })

    it("moves no salary for someone with none on record", () => {
        expect(planContractStart({ to: at("2026-10-31T22:00:00Z"), events: [HIRED], salaries: [] }))
            .toEqual({ ok: true, hireId: "h1", from: HIRED.effectiveFrom, moveSalaryIds: [] })
    })
})

describe("the dates a change to someone's start was between", () => {
    it("reads both from its log line, and nothing that isn't a date (review on PR 425)", () => {
        expect(startMovedBetween({ from: "2026-11-20", to: "2026-11-01", salaryMoved: true })).toEqual(["2026-11-20", "2026-11-01"])
        expect(startMovedBetween({ from: "2026-11-20", to: 5 })).toEqual(["2026-11-20"])
        expect(startMovedBetween({ from: "soon" })).toEqual([])
        expect(startMovedBetween(null)).toEqual([])
    })
})

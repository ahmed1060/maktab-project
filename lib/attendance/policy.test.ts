import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import {
    policyBodySchema, policyProblem, bandsProblem, dayFractionFor, policyOn, workWeekOn,
    STANDARD_OFFICE, SIX_DAY_FACTORY, MEASURE_ONLY, type DeductionRule, type PolicyBody,
} from "./policy"

/** The attendance policy's rules (ATTENDANCE_PLAN.md §6). */

const rule = (over: Partial<DeductionRule> = {}): DeductionRule => ({ ...STANDARD_OFFICE.lateness, ...over })

describe("the templates", () => {
    it("are valid policies, every one", () => {
        for (const body of [STANDARD_OFFICE, SIX_DAY_FACTORY, MEASURE_ONLY]) {
            expect(policyBodySchema.safeParse(body).success).toBe(true)
            expect(policyProblem(body)).toBeNull()
        }
    })

    it("are seeded by the migration with exactly these values", () => {
        // The migration is the copy a company actually starts from; this one
        // is what the code means by it. They must not drift apart.
        const sql = readFileSync("prisma/migrations/20261009000000_attendance_policy/migration.sql", "utf8")
        const bodies = [...sql.matchAll(/'(\{.*?\})'::jsonb/g)].map(m => JSON.parse(m[1].replace(/''/g, "'")))
        expect(bodies).toEqual([STANDARD_OFFICE, SIX_DAY_FACTORY])
    })

    it("measure without pricing until a company sets a policy", () => {
        expect(MEASURE_ONLY.lateness.enabled).toBe(false)
        expect(MEASURE_ONLY.earlyLeave.enabled).toBe(false)
        expect(MEASURE_ONLY.overtime.enabled).toBe(false)
        expect(MEASURE_ONLY.absence.multiplier).toBe(0)
    })
})

describe("bands (§6.3)", () => {
    it("must start right after grace and follow on without a gap", () => {
        expect(bandsProblem(rule())).toBeNull()
        expect(bandsProblem(rule({ graceMinutes: 10 }))).toBe("BANDS_NOT_CONTIGUOUS")
        expect(bandsProblem(rule({ bands: [{ fromMinutes: 16, toMinutes: 30, dayFraction: 0.25 }, { fromMinutes: 32, toMinutes: null, dayFraction: 1 }] }))).toBe("BANDS_NOT_CONTIGUOUS")
        expect(bandsProblem(rule({ bands: [{ fromMinutes: 16, toMinutes: 30, dayFraction: 0.25 }, { fromMinutes: 30, toMinutes: null, dayFraction: 1 }] }))).toBe("BANDS_NOT_CONTIGUOUS")
    })

    it("must end open, so no lateness goes uncharged", () => {
        expect(bandsProblem(rule({ bands: [{ fromMinutes: 16, toMinutes: 60, dayFraction: 0.5 }] }))).toBe("BANDS_NOT_OPEN_ENDED")
        expect(bandsProblem(rule({ bands: [{ fromMinutes: 16, toMinutes: null, dayFraction: 0.5 }, { fromMinutes: 17, toMinutes: null, dayFraction: 1 }] }))).toBe("BANDS_OPEN_BEFORE_END")
        expect(bandsProblem(rule({ bands: [] }))).toBe("BANDS_EMPTY")
    })

    it("are not checked when the rule is off or per minute", () => {
        expect(bandsProblem(rule({ enabled: false, bands: [] }))).toBeNull()
        expect(bandsProblem(rule({ mode: "PER_MINUTE", bands: [] }))).toBeNull()
    })
})

describe("what a late arrival costs, before the monthly rules", () => {
    it("is nothing inside grace, then each band's share", () => {
        const r = rule()
        expect(dayFractionFor(r, 0, 480)).toBe(0)
        expect(dayFractionFor(r, 15, 480)).toBe(0)
        expect(dayFractionFor(r, 16, 480)).toBe(0.25)
        expect(dayFractionFor(r, 30, 480)).toBe(0.25)
        expect(dayFractionFor(r, 31, 480)).toBe(0.5)
        expect(dayFractionFor(r, 61, 480)).toBe(1)
        expect(dayFractionFor(r, 400, 480)).toBe(1)
    })

    it("per minute, counts the minutes past grace over the paid shift, up to a whole day", () => {
        const r = rule({ mode: "PER_MINUTE", bands: [] })
        expect(dayFractionFor(r, 15, 480)).toBe(0)
        expect(dayFractionFor(r, 63, 480)).toBe(0.1)
        expect(dayFractionFor(r, 2000, 480)).toBe(1)
        expect(dayFractionFor(r, 63, 0)).toBe(0)
    })

    it("is nothing when the rule is off", () => {
        expect(dayFractionFor(rule({ enabled: false }), 200, 480)).toBe(0)
    })
})

describe("the rest of the policy", () => {
    it("refuses permission limits the wrong way round, or longer than the month", () => {
        const body: PolicyBody = structuredClone(STANDARD_OFFICE)
        body.permissionHours.minPerRequestMinutes = 150
        expect(policyProblem(body)).toBe("PERMISSION_LIMITS_REVERSED")
        const big: PolicyBody = structuredClone(STANDARD_OFFICE)
        big.permissionHours.maxPerRequestMinutes = 300
        expect(policyProblem(big)).toBe("PERMISSION_REQUEST_OVER_ALLOWANCE")
    })

    it("refuses a work week naming a day twice, or no days", () => {
        expect(policyProblem({ ...STANDARD_OFFICE, workWeek: [0, 0, 1] })).toBe("WORK_WEEK_DUPLICATE_DAY")
        expect(policyBodySchema.safeParse({ ...STANDARD_OFFICE, workWeek: [] }).success).toBe(false)
    })

    it("refuses values out of range at the schema", () => {
        expect(policyBodySchema.safeParse({ ...STANDARD_OFFICE, absence: { multiplier: 9 } }).success).toBe(false)
        expect(policyBodySchema.safeParse({ ...STANDARD_OFFICE, overtime: { ...STANDARD_OFFICE.overtime, multipliers: { workday: 0.5, restDay: 2, holiday: 3 } } }).success).toBe(false)
        expect(policyBodySchema.safeParse({ ...STANDARD_OFFICE, lateness: undefined }).success).toBe(false)
    })

    it("refuses a band that charges nothing, so every minute after grace costs something (review on #11)", () => {
        const free = structuredClone(STANDARD_OFFICE)
        free.lateness.bands[0].dayFraction = 0
        expect(policyBodySchema.safeParse(free).success).toBe(false)
    })
})

describe("effective dating (§6.1)", () => {
    const versions = [
        { id: "a", effectiveFrom: "2026-10-01", body: STANDARD_OFFICE },
        { id: "b", effectiveFrom: "2026-12-01", body: SIX_DAY_FACTORY },
    ]

    it("measures each date against the version in force on it", () => {
        expect(policyOn(versions, "2026-09-30")).toBeNull()
        expect(policyOn(versions, "2026-11-30")?.id).toBe("a")
        expect(policyOn([...versions].reverse(), "2026-12-01")?.id).toBe("b")
    })

    it("gives the company's work week from its policy, Sunday to Thursday before one", () => {
        expect(workWeekOn([], "2026-10-01")).toEqual([0, 1, 2, 3, 4])
        expect(workWeekOn(versions, "2026-12-05")).toEqual([6, 0, 1, 2, 3, 4])
    })
})

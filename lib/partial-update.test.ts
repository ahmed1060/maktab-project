import { describe, it, expect } from "vitest"
import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { stripComments } from "./strip-comments"
import { updateUserSchema, createUserSchema } from "./validations/user.schema"
import { updateTaskSchema } from "./validations/task.schema"
import { updateObligationSchema } from "./validations/obligation.schema"

/**
 * An update must change only what was sent.
 *
 * `createSchema.partial()` makes every key optional to send, and does nothing
 * about each field's own `.default()` — so an omitted key still parses to the
 * create-time default and the service receives values the caller never sent.
 * It cannot tell "left alone" from "explicitly chose the default", so it
 * writes them.
 *
 * Found in acceptance testing, on the most ordinary action there is: the
 * Employees list's suspend toggle sends `{ id, status }` and nothing else, and
 * it was rewriting role to EMPLOYEE, gender to MALE and salary to 0 on every
 * click. The salary one also wrote a SalaryChange row, putting a zero into the
 * effective-dated history every payslip is computed from.
 */

describe("a minimal update carries only what was sent", () => {
    it("user: the suspend toggle's exact request", () => {
        const parsed = updateUserSchema.parse({ id: "abc123", status: "SUSPENDED" })
        expect(Object.keys(parsed).sort()).toEqual(["id", "status"])
    })

    it("task and obligation, built the same way", () => {
        expect(Object.keys(updateTaskSchema.parse({ id: "t1" }))).toEqual(["id"])
        expect(Object.keys(updateObligationSchema.parse({ id: "o1" }))).toEqual(["id"])
    })
})

describe("stripping the defaults did not strip the validation", () => {
    it("keeps values that are sent", () => {
        const parsed = updateUserSchema.parse({
            id: "abc", role: "TEAM_LEADER", salary: 5000, gender: "FEMALE",
        })
        expect(parsed).toMatchObject({ role: "TEAM_LEADER", salary: 5000, gender: "FEMALE" })
    })

    it("still rejects what create would reject", () => {
        expect(() => updateUserSchema.parse({ id: "a", salary: -5 })).toThrow()
        expect(() => updateUserSchema.parse({ id: "a", role: "WIZARD" })).toThrow()
    })

    it("leaves create alone, which does want its defaults", () => {
        const created = createUserSchema.parse({
            firstName: "A", lastName: "B", email: "a@b.invalid", password: "twelvecharsxx",
        })
        expect(created).toMatchObject({ role: "EMPLOYEE", gender: "MALE", salary: 0 })
    })
})

describe("no schema goes back to the shape that caused it", () => {
    it("nothing in lib/validations derives an update with .partial()", () => {
        // The bug is invisible at the call site and only shows up as wrong data
        // weeks later, so the shape itself is what gets pinned.
        const dir = "lib/validations"
        const offenders = readdirSync(dir)
            .filter(f => f.endsWith(".ts") && !f.endsWith(".test.ts"))
            // Comments stripped: partial-update.ts explains at length why it
            // exists, and naming the pattern is the explanation.
            .filter(f => /\.partial\(\)/.test(stripComments(readFileSync(join(dir, f), "utf8"))))
        expect(
            offenders,
            `use partialWithoutDefaults() instead:\n${offenders.join("\n")}`,
        ).toEqual([])
    })
})

describe("package prices are checked without floating-point arithmetic", () => {
    it("accepts every genuine two-decimal price", async () => {
        const { createPackageSchema } = await import("./validations/package.schema")
        const base = { name: "P", hasCompanyManagement: true, hasHR: true }
        // 2499.99 * 100 is 249998.99999999997 in IEEE-754, so the old check —
        // Math.round(v * 100) === v * 100 — rejected it as "more than two
        // decimal places". So did 8.29, and so did seven cents.
        for (const price of [249.99, 2499.99, 8.29, 0.07, 1234.56, 0, 99999.99]) {
            expect(
                () => createPackageSchema.parse({ ...base, priceMonthly: price, priceAnnual: price }),
                `${price} is a valid price and must be accepted`,
            ).not.toThrow()
        }
    })

    it("still rejects more than two decimal places", async () => {
        const { createPackageSchema } = await import("./validations/package.schema")
        const base = { name: "P", hasCompanyManagement: true, hasHR: true }
        for (const price of [1.005, 1.234, 0.001]) {
            expect(
                () => createPackageSchema.parse({ ...base, priceMonthly: price, priceAnnual: price }),
                `${price} has more than two decimal places and must be rejected`,
            ).toThrow()
        }
    })
})

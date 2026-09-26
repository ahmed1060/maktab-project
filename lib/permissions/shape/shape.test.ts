import { describe, it, expect } from "vitest"
import { PROTECTED_FIELDS, shapeUser, shapeTask } from "."
import { can, type Actor } from "../can"
import { withGrants } from "@/lib/permissions/test-actors"

const admin: Actor = withGrants({ id: "admin", role: "ADMIN", companyId: "c1" })
const otherAdmin: Actor = withGrants({ id: "admin2", role: "ADMIN", companyId: "c2" })
const leader: Actor = withGrants({ id: "tl", role: "TEAM_LEADER", companyId: "c1" })
const employee: Actor = withGrants({ id: "emp", role: "EMPLOYEE", companyId: "c1" })
const superAdmin: Actor = { id: "sa", role: "SUPER_ADMIN", companyId: null }

const colleague = { id: "loner", companyId: "c1", teamLeaderId: null, firstName: "L", salary: "1500.00" }
const teamMember = { id: "emp", companyId: "c1", teamLeaderId: "tl", firstName: "E", salary: "1000.00" }

describe("shapeUser", () => {
    it("keeps salary, as a number, for someone holding salary.view over the person", () => {
        expect(shapeUser(admin, colleague).salary).toBe(1500)
        expect(shapeUser(superAdmin, colleague).salary).toBe(1500)
    })

    it("keeps a person's own salary, whatever they hold", () => {
        expect(shapeUser(employee, teamMember).salary).toBe(1000)
    })

    it("removes it for anyone else", () => {
        expect(shapeUser(leader, teamMember)).not.toHaveProperty("salary")
        expect(shapeUser(employee, colleague)).not.toHaveProperty("salary")
    })

    it("checks the grant against the person, so another company's salary stays hidden", () => {
        expect(shapeUser(otherAdmin, colleague)).not.toHaveProperty("salary")
    })

    it("leaves everything else as it was", () => {
        expect(shapeUser(leader, teamMember)).toEqual({ id: "emp", companyId: "c1", teamLeaderId: "tl", firstName: "E" })
    })

    it("does not add a salary to a row that had none", () => {
        expect(shapeUser(admin, { id: "x", companyId: "c1" })).not.toHaveProperty("salary")
    })
})

describe("shapeTask", () => {
    const task = { id: "t", title: "Shared", memberCosts: { emp: 100, loner: 250 } }

    it("shows every line to someone who sees others' tasks", () => {
        expect(shapeTask(admin, task).memberCosts).toEqual({ emp: 100, loner: 250 })
        expect(shapeTask(leader, task).memberCosts).toEqual({ emp: 100, loner: 250 })
    })

    it("shows anybody else their own line only", () => {
        expect(shapeTask(employee, task).memberCosts).toEqual({ emp: 100 })
    })

    it("shows nothing to someone with no line", () => {
        expect(shapeTask(withGrants({ id: "x", role: "EMPLOYEE", companyId: "c1" }), task).memberCosts).toEqual({})
    })

    it("reads the map when it is stored as a string", () => {
        expect(shapeTask(employee, { memberCosts: JSON.stringify(task.memberCosts) }).memberCosts).toEqual({ emp: 100 })
    })

    it("leaves a task without costs, and anything that is not a task, alone", () => {
        expect(shapeTask(employee, { id: "t", memberCosts: null })).toEqual({ id: "t", memberCosts: null })
        expect(shapeTask(employee, { success: true })).toEqual({ success: true })
        expect(shapeTask(employee, null)).toBeNull()
    })
})

/**
 * The list in fields.ts is the contract. For each protected field: a row that
 * carries it about somebody else, a viewer without the permission, and the
 * shaper for its model — which must leave that viewer nothing of the other
 * person's value. Add a field to the list without teaching its shaper, and
 * this fails.
 */
describe("every protected field is removed for a viewer without its permission", () => {
    const SHAPERS: Record<keyof typeof PROTECTED_FIELDS, (actor: Actor, row: any) => any> = {
        User: shapeUser,
        Task: shapeTask,
    }
    // A row carrying the field about somebody else, and that person's value —
    // which must not survive, in any form, for a viewer without the permission.
    const ABOUT_SOMEONE_ELSE: Record<keyof typeof PROTECTED_FIELDS, { row: Record<string, unknown>; secret: string }> = {
        User: { row: { id: "loner", companyId: "c1", teamLeaderId: null, salary: 1537 }, secret: "1537" },
        Task: { row: { id: "t", memberCosts: { loner: 2539 } }, secret: "2539" },
    }

    for (const [model, fields] of Object.entries(PROTECTED_FIELDS) as [keyof typeof PROTECTED_FIELDS, Record<string, any>][]) {
        for (const [field, permission] of Object.entries(fields)) {
            it(`${model}.${field}`, () => {
                const { row, secret } = ABOUT_SOMEONE_ELSE[model]
                expect(row, `the ${model} fixture must carry ${field}`).toHaveProperty(field)
                expect(can(employee, permission)).toBe(false)
                const shaped = SHAPERS[model](employee, row)
                expect(JSON.stringify(shaped[field] ?? null), `${model}.${field} reached a viewer without ${permission}`)
                    .not.toContain(secret)
            })
        }
    }
})

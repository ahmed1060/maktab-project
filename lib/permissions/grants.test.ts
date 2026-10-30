import { describe, it, expect } from "vitest"
import { PERMISSIONS, RETIRED_CODES, ALL_PERMISSIONS } from "./catalogue"
import { encodeGrants, decodeGrants } from "./grants"
import { BUILT_IN_GRANTS } from "./built-in"

describe("permission codes", () => {
    /**
     * The codes, pinned. A session token issued before a release carries these
     * numbers; renumbering would make an old token mean something else. Add a
     * new permission with the next unused number; never edit a line here.
     */
    const PINNED: Record<string, number> = {
        "employees.view": 1, "employees.create": 2, "employees.edit": 3, "employees.change_status": 4,
        "employees.end_contract": 5, "employees.delete": 6, "employees.reset_password": 7,
        "employees.assign_team": 8, "employees.assign_role": 9, "employees.request_role": 10,
        "profile_requests.review": 11, "requests.view": 12, "requests.review": 13, "requests.reset_points": 14,
        "tasks.view": 15, "tasks.create": 16, "tasks.edit": 17, "tasks.transfer": 18, "tasks.review": 19,
        "tasks.delete": 20, "tasks.pay": 21, "tasks.penalize": 22,
        "obligations.view": 23, "obligations.manage": 24, "records.view": 25, "records.contribute": 26,
        "records.edit": 27, "records.delete": 28, "clients.view": 29, "clients.manage": 30, "costs.view": 31,
        "dayoff.view": 32, "dayoff.approve": 33, "dayoff.adjust_credit": 34,
        "salary.view": 35, "salary.edit": 36, "salary_adjustments.manage": 37,
        "payroll.view": 38, "payroll.prepare": 39, "payroll.approve": 40, "payroll.issue_payslips": 41,
        "payroll.mark_paid": 42, "settlements.manage": 43, "debts.view": 44, "debts.waive": 45,
        "settings.view": 46, "settings.edit": 47, "audit.view": 48,
        "locations.view": 55, "locations.add": 56, "locations.manage": 57,
        "lists.add": 58, "lists.manage": 59,
        "charges.view": 60, "charges.manage": 61, "charges.collect": 62,
        "cash_advances.view": 63, "cash_advances.give": 64,
        "dayoff.request": 65,
        "attendance.view_team": 49, "attendance.correct": 50, "attendance.approve_overtime": 51, "attendance.approve_permissions": 52,
        "attendance.approve_devices": 53,
        "attendance.approve_face": 54,
    }

    it("have not changed", () => {
        for (const [permission, code] of Object.entries(PINNED)) {
            expect((PERMISSIONS as any)[permission]?.code, permission).toBe(code)
        }
    })

    it("are pinned for every permission", () => {
        expect(ALL_PERMISSIONS.filter(p => !(p in PINNED))).toEqual([])
    })

    it("are unique and never a retired one", () => {
        const codes = ALL_PERMISSIONS.map(p => PERMISSIONS[p].code)
        expect(new Set(codes).size).toBe(codes.length)
        expect(codes.filter(c => RETIRED_CODES.includes(c))).toEqual([])
    })
})

describe("grants in the token", () => {
    it("round-trip for every built-in role", () => {
        for (const grants of Object.values(BUILT_IN_GRANTS)) {
            expect(decodeGrants(encodeGrants(grants))).toEqual(grants)
        }
    })

    it("are compact", () => {
        const everything = Object.fromEntries(ALL_PERMISSIONS.map(p => [p, "COMPANY"]))
        expect(encodeGrants(everything as any).length).toBeLessThan(400)
        expect(encodeGrants({ "employees.view": "COMPANY", "tasks.view": "TEAM" })).toBe("1.3,15.2")
    })

    it("drop what they do not recognise instead of guessing", () => {
        expect(decodeGrants("1.3,999.3,15.9,x")).toEqual({ "employees.view": "COMPANY" })
        expect(decodeGrants("")).toEqual({})
        expect(decodeGrants(undefined)).toEqual({})
    })
})

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
        // When someone's contract started (LATER_CHANGES_PLAN.md §7.2, PR 425).
        "employees.edit_contract_start": 93,
        "profile_requests.review": 11, "requests.view": 12, "requests.review": 13, "requests.reset_points": 14,
        "tasks.view": 15, "tasks.create": 16, "tasks.edit": 17, "tasks.transfer": 18, "tasks.review": 19,
        "tasks.delete": 20, "tasks.pay": 21, "tasks.penalize": 22,
        "obligations.view": 23, "records.view": 25, "records.contribute": 26,
        "records.edit": 27, "records.delete": 28, "clients.view": 29, "costs.view": 31,
        "dayoff.view": 32, "dayoff.approve": 33, "dayoff.adjust_credit": 34,
        "salary.view": 35, "salary.edit": 36,
        "payroll.view": 38, "payroll.prepare": 39, "payroll.approve": 40, "payroll.issue_payslips": 41,
        "payroll.mark_paid": 42, "debts.view": 44, "debts.waive": 45,
        "settings.view": 46, "settings.edit": 47, "audit.view": 48,
        "locations.view": 55, "locations.edit": 79, "locations.archive": 80, "locations.create": 81,
        "lists.add": 58, "lists.rename": 82, "lists.merge": 83, "lists.archive": 84,
        "charges.view": 60, "charges.collect": 62, "charges.set": 85,
        "cash_advances.view": 63, "cash_advances.give": 64,
        "dayoff.request": 65,
        "attendance.view_team": 49, "attendance.correct": 50, "attendance.approve_overtime": 51, "attendance.approve_permissions": 52,
        "attendance.approve_devices": 53,
        "attendance.approve_face": 54,
        "attendance.manage_terminals": 66,
        "attendance.approve_missions": 67,
        "tax.view": 68,
        "tax.manage": 69,
        "client_accounts.view": 86, "client_accounts.invite": 87, "client_accounts.remove": 88,
        "salary_adjustments.add": 89, "salary_adjustments.reverse": 90,
        "settlements.view": 91, "settlements.resend": 92,
        "client_messages.manage": 71,
        "clients.create": 72, "clients.edit": 73, "clients.delete": 74,
        "obligations.create": 75, "obligations.edit": 76, "obligations.approve": 77, "obligations.delete": 78,
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
        // Everything a session can hold, as each permission there is.
        const everything = Object.fromEntries(ALL_PERMISSIONS.map(p => [p, "COMPANY"]))
        // 400 exactly with the 82 a session could hold since PR 382, in a session cookie of about 4 KB.
        expect(encodeGrants(everything as any).length).toBeLessThan(500)
        expect(encodeGrants({ "employees.view": "COMPANY", "tasks.view": "TEAM" })).toBe("1.3,15.2")
    })

    it("drop what they do not recognise instead of guessing", () => {
        expect(decodeGrants("1.3,999.3,15.9,x")).toEqual({ "employees.view": "COMPANY" })
        expect(decodeGrants("")).toEqual({})
        expect(decodeGrants(undefined)).toEqual({})
    })
})

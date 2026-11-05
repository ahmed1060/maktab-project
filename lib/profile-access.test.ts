import { describe, it, expect } from "vitest"
import { permissionsOf } from "@/lib/useCan"
import { withGrants } from "@/lib/permissions/test-actors"
import { encodeGrants, type Grants } from "@/lib/permissions/grants"
import { profileAccess } from "@/lib/profile-access"
import type { Module } from "@/lib/features/bundles"

/**
 * What a person's profile shows, and offers, to whoever is looking (UI_PLAN.md
 * §5 step 5, a person's profile, part 2, PR 192): in one place, for the view
 * of someone else's and for the form. Each with the permission its route
 * checks, as the form asked them, field by field.
 */

const SUPER = { role: "SUPER_ADMIN", id: "sa", companyId: null }
const ADMIN = withGrants({ role: "ADMIN", id: "admin", companyId: "c1" })
const LEADER = withGrants({ role: "TEAM_LEADER", id: "tl", companyId: "c1" })
const EMPLOYEE = withGrants({ role: "EMPLOYEE", id: "emp", companyId: "c1" })
/** A role of the company's own, on an employee's footing, holding these. */
const custom = (grants: Grants) => ({ role: "EMPLOYEE", id: "hr", companyId: "c1", grants: encodeGrants(grants) })
type Viewer = { role: string; id: string; companyId: string | null; grants?: string }
/** Whether the company's package includes a module: everything, unless said. */
const everything = () => true
const access = (viewer: Viewer, person: { id: string; role: string }, has: (module: Module) => boolean = everything) => profileAccess({ can: permissionsOf(viewer).can, viewer, person, has })
/** A package without these modules. */
const without = (...left: Module[]) => (module: Module) => !left.includes(module)
const someone = (role: string) => ({ id: "p1", role })

describe("a person's pay and day off credit", () => {
    it("are shown to whoever may see them, and to the person themselves", () => {
        expect(access(ADMIN, someone("EMPLOYEE"))).toMatchObject({ salary: true, dayOffCredit: true })
        expect(access(EMPLOYEE, { id: "emp", role: "EMPLOYEE" })).toMatchObject({ own: true, salary: true, dayOffCredit: true })
        expect(access(EMPLOYEE, someone("EMPLOYEE"))).toMatchObject({ salary: false, dayOffCredit: false })
        expect(access(custom({ "salary.view": "COMPANY" }), someone("EMPLOYEE"))).toMatchObject({ salary: true, dayOffCredit: false })
    })

    it("are never an Admin's or a Super Admin's, nor anyone's before their role is known", () => {
        for (const role of ["ADMIN", "SUPER_ADMIN", ""]) expect(access(SUPER, someone(role)), role).toMatchObject({ salary: false, dayOffCredit: false })
    })

    // DESIGN.md §5.5, Page layout: pay is Payroll's, a day off balance Day
    // off's. They were shown, and changed, whatever the package.
    it("aren't shown or changed where the company's package doesn't include them", () => {
        expect(access(ADMIN, someone("EMPLOYEE"), without("PAYROLL"))).toMatchObject({ salary: false, changeSalary: false, dayOffCredit: true, changeDayOffCredit: true })
        expect(access(ADMIN, someone("EMPLOYEE"), without("DAY_OFF"))).toMatchObject({ salary: true, changeSalary: true, dayOffCredit: false, changeDayOffCredit: false })
        // Nor on one's own profile.
        expect(access(EMPLOYEE, { id: "emp", role: "EMPLOYEE" }, without("PAYROLL", "DAY_OFF"))).toMatchObject({ own: true, salary: false, dayOffCredit: false })
        // The rest of the profile is Core, so it stays.
        expect(access(ADMIN, someone("EMPLOYEE"), without("PAYROLL", "DAY_OFF"))).toMatchObject({ edit: true, role: true, teamLeader: true, status: true, endContract: true })
    })
})

describe("a person's role and team", () => {
    it("shows the role to whoever may give one or ask for one, never on one's own", () => {
        expect(access(ADMIN, someone("EMPLOYEE")).role).toBe(true)
        expect(access(custom({ "employees.request_role": "COMPANY" }), someone("EMPLOYEE")).role).toBe(true)
        expect(access(LEADER, someone("EMPLOYEE")).role).toBe(false)
        expect(access(ADMIN, { id: "admin", role: "ADMIN" }).role).toBe(false)
    })

    // Part 4, PR 194: the role field, and asking from their details, ask this.
    it("gives a role with the assign permission, asks for one with the request permission alone", () => {
        expect(access(ADMIN, someone("EMPLOYEE")).changeRole).toBe("assign")
        expect(access(SUPER, someone("TEAM_LEADER")).changeRole).toBe("assign")
        expect(access(custom({ "employees.request_role": "COMPANY" }), someone("EMPLOYEE")).changeRole).toBe("ask")
        expect(access(custom({ "employees.request_role": "COMPANY", "employees.assign_role": "COMPANY" }), someone("EMPLOYEE")).changeRole).toBe("assign")
        expect(access(LEADER, someone("EMPLOYEE")).changeRole).toBeNull()
    })

    it("changes no role of one's own, nor a Super Admin's, and an Admin's only for the Super Admin", () => {
        expect(access(ADMIN, { id: "admin", role: "ADMIN" }).changeRole).toBeNull()
        expect(access(SUPER, someone("SUPER_ADMIN")).changeRole).toBeNull()
        expect(access(ADMIN, someone("ADMIN")).changeRole).toBeNull()
        expect(access(custom({ "employees.request_role": "COMPANY" }), someone("ADMIN")).changeRole).toBeNull()
        expect(access(SUPER, someone("ADMIN")).changeRole).toBe("assign")
        // Nor before their role is known.
        expect(access(ADMIN, someone("")).changeRole).toBeNull()
    })

    it("shows an employee's team leader to whoever assigns teams, and one's own on one's own profile", () => {
        expect(access(ADMIN, someone("EMPLOYEE"))).toMatchObject({ teamLeader: true, ownTeamLeader: false })
        // Only an employee has a team leader.
        expect(access(ADMIN, someone("TEAM_LEADER")).teamLeader).toBe(false)
        expect(access(EMPLOYEE, { id: "emp", role: "EMPLOYEE" })).toMatchObject({ teamLeader: false, ownTeamLeader: true })
        expect(access(LEADER, { id: "tl", role: "TEAM_LEADER" }).ownTeamLeader).toBe(false)
    })
})

describe("a person's company, status and password", () => {
    it("shows the company to the Super Admin, and a Super Admin's to whoever looks", () => {
        expect(access(SUPER, someone("EMPLOYEE")).company).toBe(true)
        expect(access(ADMIN, someone("EMPLOYEE")).company).toBe(false)
        expect(access(ADMIN, someone("SUPER_ADMIN")).company).toBe(true)
    })

    it("shows the status to whoever may change it, never on one's own", () => {
        expect(access(ADMIN, someone("EMPLOYEE")).status).toBe(true)
        expect(access(custom({ "employees.change_status": "COMPANY" }), someone("EMPLOYEE")).status).toBe(true)
        expect(access(LEADER, someone("EMPLOYEE")).status).toBe(false)
        expect(access(ADMIN, { id: "admin", role: "ADMIN" }).status).toBe(false)
    })

    // Its route ends a contract, and reinstates one, for whoever holds
    // employees.end_contract, which changing a status doesn't give; and only
    // the Super Admin ends an Admin's (ROLES_PLAN.md §4.2, rule 7).
    it("offers End contract to whoever may end one, never on one's own, and an Admin's only to the Super Admin", () => {
        expect(access(ADMIN, someone("EMPLOYEE")).endContract).toBe(true)
        expect(access(custom({ "employees.end_contract": "COMPANY" }), someone("EMPLOYEE")).endContract).toBe(true)
        expect(access(custom({ "employees.change_status": "COMPANY" }), someone("EMPLOYEE")).endContract).toBe(false)
        expect(access(LEADER, someone("EMPLOYEE")).endContract).toBe(false)
        expect(access(ADMIN, { id: "admin", role: "ADMIN" }).endContract).toBe(false)
        expect(access(ADMIN, someone("ADMIN")).endContract).toBe(false)
        expect(access(SUPER, someone("ADMIN")).endContract).toBe(true)
    })

    it("offers Reset password to whoever may reset one, never on one's own", () => {
        expect(access(ADMIN, someone("EMPLOYEE")).resetPassword).toBe(true)
        expect(access(custom({ "employees.reset_password": "COMPANY" }), someone("EMPLOYEE")).resetPassword).toBe(true)
        expect(access(LEADER, someone("EMPLOYEE")).resetPassword).toBe(false)
        expect(access(ADMIN, { id: "admin", role: "ADMIN" }).resetPassword).toBe(false)
    })

    // Its route refuses anyone else ("Only the Super Admin resets an Admin's password").
    it("offers Reset password on an Admin's profile only to the Super Admin", () => {
        expect(access(ADMIN, someone("ADMIN")).resetPassword).toBe(false)
        expect(access(custom({ "employees.reset_password": "COMPANY" }), someone("ADMIN")).resetPassword).toBe(false)
        expect(access(SUPER, someone("ADMIN")).resetPassword).toBe(true)
    })
})

describe("Edit, from the view of someone's profile", () => {
    it("is offered on one's own, and to whoever may edit them", () => {
        expect(access(EMPLOYEE, { id: "emp", role: "EMPLOYEE" }).edit).toBe(true)
        expect(access(ADMIN, someone("EMPLOYEE")).edit).toBe(true)
        expect(access(custom({ "employees.edit": "COMPANY" }), someone("EMPLOYEE")).edit).toBe(true)
        expect(access(EMPLOYEE, someone("EMPLOYEE")).edit).toBe(false)
    })

    // As the Employees list offers it (canEdit there).
    it("is an Admin's only for the Super Admin, who alone acts on an Admin", () => {
        expect(access(ADMIN, someone("ADMIN")).edit).toBe(false)
        expect(access(SUPER, someone("ADMIN")).edit).toBe(true)
    })
})

// What the form may change, and so what its save sends (a person's profile,
// part 3, PR 193): each as its route takes it, the field shown but off,
// with why under it, where it may not.
describe("what the form may change", () => {
    it("changes pay and day off credit with their permissions, never one's own, and only someone's on payroll", () => {
        expect(access(ADMIN, someone("EMPLOYEE"))).toMatchObject({ changeSalary: true, changeDayOffCredit: true })
        expect(access(custom({ "salary.view": "COMPANY" }), someone("EMPLOYEE"))).toMatchObject({ salary: true, changeSalary: false })
        expect(access(custom({ "salary.view": "COMPANY", "salary.edit": "COMPANY" }), someone("EMPLOYEE")).changeSalary).toBe(true)
        expect(access(custom({ "dayoff.view": "COMPANY", "dayoff.adjust_credit": "COMPANY" }), someone("EMPLOYEE")).changeDayOffCredit).toBe(true)
        expect(access(EMPLOYEE, { id: "emp", role: "EMPLOYEE" })).toMatchObject({ salary: true, changeSalary: false, changeDayOffCredit: false })
        expect(access(SUPER, someone("ADMIN"))).toMatchObject({ changeSalary: false, changeDayOffCredit: false })
    })

    it("changes someone's email, never one's own, which is changed in Security settings", () => {
        expect(access(ADMIN, someone("EMPLOYEE")).changeEmail).toBe(true)
        expect(access(EMPLOYEE, { id: "emp", role: "EMPLOYEE" }).changeEmail).toBe(false)
        expect(access(SUPER, { id: "sa", role: "SUPER_ADMIN" }).changeEmail).toBe(false)
    })

    it("changes a username for the Super Admin alone, whose username the route takes", () => {
        expect(access(SUPER, someone("EMPLOYEE")).changeUsername).toBe(true)
        expect(access(ADMIN, someone("EMPLOYEE")).changeUsername).toBe(false)
        expect(access(custom({ "employees.edit": "COMPANY" }), someone("EMPLOYEE")).changeUsername).toBe(false)
    })

    // Its route sets somebody else's password only with employees.reset_password,
    // and an Admin's only for the Super Admin (FORBIDDEN_PASSWORD_RESET).
    it("sets a new password on one's own profile, and on someone else's with the reset permission", () => {
        expect(access(EMPLOYEE, { id: "emp", role: "EMPLOYEE" }).changePassword).toBe(true)
        expect(access(ADMIN, someone("EMPLOYEE")).changePassword).toBe(true)
        expect(access(custom({ "employees.edit": "COMPANY" }), someone("EMPLOYEE")).changePassword).toBe(false)
        expect(access(custom({ "employees.edit": "COMPANY", "employees.reset_password": "COMPANY" }), someone("EMPLOYEE")).changePassword).toBe(true)
        expect(access(ADMIN, someone("ADMIN")).changePassword).toBe(false)
        expect(access(SUPER, someone("ADMIN")).changePassword).toBe(true)
    })

    // As the route does (NAME_CHANGE_REQUIRES_ADMIN): the form sends it as a
    // name change to be decided.
    it("asks for one's own name on an employee's or a team leader's footing", () => {
        expect(access(EMPLOYEE, { id: "emp", role: "EMPLOYEE" }).nameByRequest).toBe(true)
        expect(access(LEADER, { id: "tl", role: "TEAM_LEADER" }).nameByRequest).toBe(true)
        expect(access(custom({}), { id: "hr", role: "EMPLOYEE" }).nameByRequest).toBe(true)
        expect(access(ADMIN, { id: "admin", role: "ADMIN" }).nameByRequest).toBe(false)
        expect(access(ADMIN, someone("EMPLOYEE")).nameByRequest).toBe(false)
    })
})

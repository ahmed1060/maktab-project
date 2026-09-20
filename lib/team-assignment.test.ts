import { describe, it, expect } from "vitest"
import { checkTeamAssignment, clearsOwnLeader, stripsLeadership, type Person } from "./team-assignment"

const CO = "co-1"
const employee = (over: Partial<Person> = {}): Person =>
    ({ id: "emp-1", role: "EMPLOYEE", companyId: CO, status: "ACTIVE", ...over })
const leader = (over: Partial<Person> = {}): Person =>
    ({ id: "tl-1", role: "TEAM_LEADER", companyId: CO, status: "ACTIVE", ...over })

function refusalOf(target: Person, lead: Person | null) {
    const v = checkTeamAssignment(target, lead)
    return v.ok ? null : v.refusal.code
}

describe("an employee can be given a leader from their own company", () => {
    it("accepts the ordinary case", () => {
        expect(checkTeamAssignment(employee(), leader())).toEqual({ ok: true })
    })

    it("accepts no leader at all", () => {
        // Unassigning is how an Admin resolves a hand-off, and it is the state
        // every account starts in. A rule that refused it would make the
        // hand-off flow impossible to complete.
        expect(checkTeamAssignment(employee(), null)).toEqual({ ok: true })
    })
})

describe("leaders are not led", () => {
    it("refuses to give a team leader a leader of their own", () => {
        expect(refusalOf(leader({ id: "tl-2" }), leader())).toBe("ONLY_EMPLOYEES_HAVE_LEADERS")
    })

    it("refuses to give an admin one", () => {
        expect(refusalOf(employee({ role: "ADMIN" }), leader())).toBe("ONLY_EMPLOYEES_HAVE_LEADERS")
    })

    it("refuses a leader who is not actually a team leader", () => {
        expect(refusalOf(employee(), leader({ role: "ADMIN" }))).toBe("NOT_A_LEADER")
        expect(refusalOf(employee(), leader({ role: "EMPLOYEE" }))).toBe("NOT_A_LEADER")
        expect(refusalOf(employee(), leader({ role: "SUPER_ADMIN" }))).toBe("NOT_A_LEADER")
    })

    it("makes a reporting cycle impossible rather than detecting one", () => {
        // The point of the flat structure. A cycle needs somebody who is both
        // led and leading; the two rules above mean no row can be both, so
        // there is no cycle to hunt for. If either rule is ever relaxed, this
        // is the test that should stop being true.
        const a = leader({ id: "a" })
        const b = leader({ id: "b" })
        expect(refusalOf(a, b)).toBe("ONLY_EMPLOYEES_HAVE_LEADERS")
        expect(refusalOf(b, a)).toBe("ONLY_EMPLOYEES_HAVE_LEADERS")
    })
})

describe("the boundaries around the rule", () => {
    it("refuses somebody leading themselves", () => {
        const both = employee({ id: "same" })
        expect(refusalOf(both, { ...both, role: "TEAM_LEADER" })).toBe("SELF_LEADERSHIP")
    })

    it("refuses a leader from another company", () => {
        expect(refusalOf(employee(), leader({ companyId: "co-2" }))).toBe("DIFFERENT_COMPANY")
    })

    it("refuses a leader with no company at all", () => {
        // A Super Admin belongs to no company. Without this, a null companyId
        // on both sides would compare equal and quietly pass.
        expect(refusalOf(employee({ companyId: null }), leader({ companyId: null }))).toBe("DIFFERENT_COMPANY")
    })

    it("refuses an archived or deleted leader", () => {
        expect(refusalOf(employee(), leader({ status: "ARCHIVED" }))).toBe("LEADER_UNAVAILABLE")
        expect(refusalOf(employee(), leader({ status: "DELETED" }))).toBe("LEADER_UNAVAILABLE")
    })

    it("still allows a leader who is merely offline or inactive", () => {
        // OFFLINE means "not signed in right now", which is most people most
        // of the time. Treating it as unavailable would refuse nearly every
        // assignment an Admin tries to make.
        expect(checkTeamAssignment(employee(), leader({ status: "OFFLINE" })).ok).toBe(true)
        expect(checkTeamAssignment(employee(), leader({ status: "INACTIVE" })).ok).toBe(true)
        expect(checkTeamAssignment(employee(), leader({ status: undefined })).ok).toBe(true)
    })

    it("names the role problem before the company one", () => {
        // An Admin from another company is refused as NOT_A_LEADER, which is
        // the more useful of the two true statements.
        expect(refusalOf(employee(), leader({ role: "ADMIN", companyId: "co-2" }))).toBe("NOT_A_LEADER")
    })
})

describe("promoting an employee clears the leader they had", () => {
    it("clears it when an employee with a leader becomes a team leader", () => {
        // The rule that falls out of the flat structure and is easiest to
        // miss. Without it a TEAM_LEADER row keeps a teamLeaderId — a leader
        // who is led — which nothing refuses and no screen shows.
        expect(clearsOwnLeader({ role: "EMPLOYEE", teamLeaderId: "tl-1" }, "TEAM_LEADER")).toBe(true)
    })

    it("clears it on promotion to admin too", () => {
        expect(clearsOwnLeader({ role: "EMPLOYEE", teamLeaderId: "tl-1" }, "ADMIN")).toBe(true)
    })

    it("leaves an employee who stays an employee alone", () => {
        expect(clearsOwnLeader({ role: "EMPLOYEE", teamLeaderId: "tl-1" }, "EMPLOYEE")).toBe(false)
    })

    it("does nothing when the role is not changing", () => {
        expect(clearsOwnLeader({ role: "EMPLOYEE", teamLeaderId: "tl-1" }, undefined)).toBe(false)
    })

    it("does nothing for somebody who had no leader", () => {
        expect(clearsOwnLeader({ role: "EMPLOYEE", teamLeaderId: null }, "TEAM_LEADER")).toBe(false)
    })

    it("is not the rule for losing a leader, only for gaining a role", () => {
        // Demotion is the other direction and is emphatically not silent: it
        // strips a leader, other people's visibility depends on it, and it is
        // refused until an Admin decides where those reports go. This helper
        // must never be mistaken for that one.
        expect(clearsOwnLeader({ role: "TEAM_LEADER", teamLeaderId: null }, "EMPLOYEE")).toBe(false)
    })
})

describe("a leader cannot be stripped out from under their team", () => {
    const lead = { role: "TEAM_LEADER", companyId: CO, status: "ACTIVE" }

    it("catches the obvious one: demotion to employee", () => {
        expect(stripsLeadership(lead, { role: "EMPLOYEE" })).toBe(true)
    })

    it("catches promotion to admin too", () => {
        // Still leaves the reports pointing at somebody who is not a leader.
        expect(stripsLeadership(lead, { role: "ADMIN" })).toBe(true)
    })

    it("catches archiving and deleting, which do not look like demotion", () => {
        // The app soft-deletes, so the foreign key's ON DELETE SET NULL never
        // fires for either of these. Without this the reports keep pointing at
        // a dead account.
        expect(stripsLeadership(lead, { status: "ARCHIVED" })).toBe(true)
        expect(stripsLeadership(lead, { status: "DELETED" })).toBe(true)
    })

    it("catches a move to another company", () => {
        // Strands the reports across the boundary the system exists to hold.
        expect(stripsLeadership(lead, { companyId: "co-2" })).toBe(true)
    })

    it("ignores changes that leave them leading", () => {
        expect(stripsLeadership(lead, { status: "OFFLINE" })).toBe(false)
        expect(stripsLeadership(lead, { status: "SUSPENDED" })).toBe(false)
        expect(stripsLeadership(lead, { role: "TEAM_LEADER" })).toBe(false)
        expect(stripsLeadership(lead, { companyId: CO })).toBe(false)
        expect(stripsLeadership(lead, {})).toBe(false)
    })

    it("says nothing about somebody who was never a leader", () => {
        expect(stripsLeadership({ role: "EMPLOYEE", companyId: CO }, { role: "ADMIN" })).toBe(false)
        expect(stripsLeadership({ role: "ADMIN", companyId: CO }, { status: "ARCHIVED" })).toBe(false)
    })
})

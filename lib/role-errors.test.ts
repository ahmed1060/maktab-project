import { describe, it, expect } from "vitest"
import { roleRequestRefusal } from "./role-errors"
import { teamRefusalResponse } from "./team-handoff-response"

/**
 * Refusing a role request's decision, or its withdrawal, says what it is in
 * a code too, as the attendance APIs do, so the Requests page can say it in
 * the person's language (UI_PLAN.md §2.3, part 5b). The words stay, for
 * whatever reads them.
 */

describe("a role request's refusals", () => {
    it("carry their code beside their words and status", async () => {
        for (const [code, status] of [
            ["ALREADY_DECIDED", 400], ["REQUEST_NOT_FOUND", 404], ["OWN_REQUEST", 403], ["REASON_REQUIRED", 400],
            ["ROLE_EXCEEDS_YOURS", 403], ["FORBIDDEN_ROLE_ASSIGNMENT", 403], ["ROLE_NOT_IN_COMPANY", 400], ["LAST_ADMIN", 400],
            ["ADMIN_IS_SUPER_ADMINS", 403], ["ACTING_END_IN_PAST", 400],
        ] as const) {
            const res = roleRequestRefusal(new Error(code))!
            expect(res.status, code).toBe(status)
            const body = await res.json()
            expect(body, code).toMatchObject({ success: false, code })
            expect(typeof body.error, code).toBe("string")
        }
        expect(roleRequestRefusal(new Error("SOMETHING_ELSE"))).toBeNull()
    })

    it("and so does a leader who still leads a team, with whom", async () => {
        const err: any = new Error("LEADER_HAS_REPORTS")
        err.reports = [{ id: "e-1", firstName: "Laila", lastName: "Fouad" }]
        const body = await teamRefusalResponse(err)!.json()
        expect(body).toMatchObject({ code: "LEADER_HAS_REPORTS", details: { reports: err.reports } })
    })
})

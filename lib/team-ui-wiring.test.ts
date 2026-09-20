import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { stripComments } from "./strip-comments"

/**
 * The two ways the assignment screen goes quietly wrong.
 *
 * Neither is visible on the page. One ships colleagues' rows to the browser
 * and draws nothing with them; the other makes the edit form look right and
 * save the wrong thing. Both survive a click-through, so they are asserted
 * here instead.
 */

const ROUTE = stripComments(readFileSync("app/api/users/route.ts", "utf8"))
const FORM = stripComments(readFileSync("components/EmployeeProfileForm.tsx", "utf8"))

/** The balanced block starting at `from`, so an assertion about one query
 *  cannot accidentally be satisfied by a different query in the same file —
 *  the mistake that once left a gate guard in this repo unable to fail. */
function blockAt(source: string, marker: string): string {
    const start = source.indexOf(marker)
    expect(start, `missing: ${marker}`).toBeGreaterThan(-1)
    let depth = 0
    for (let i = start; i < source.length; i++) {
        if (source[i] === "{") depth++
        else if (source[i] === "}") {
            depth--
            if (depth === 0) return source.slice(start, i + 1)
        }
    }
    throw new Error(`unbalanced block at ${marker}`)
}

describe("the list sends a name, not a colleague's record", () => {
    const list = blockAt(ROUTE, "prisma.user.findMany(")

    it("selects the leader's fields rather than the relation", () => {
        // `teamLeader: true` would put a leader's entire User row — salary
        // included — into every line of a list that prints a name. That is the
        // same shape as the memberCosts leak: drawn by nothing, present in the
        // payload for anyone who opens the page source.
        expect(list).toMatch(/teamLeader:\s*\{\s*select:/)
        expect(list).not.toMatch(/teamLeader:\s*true/)
    })

    it("keeps the select narrow", () => {
        const leader = blockAt(list, "teamLeader:")
        for (const leaked of ["salary", "password", "email", "mfaSecret"]) {
            expect(leader, `the leader select must not carry ${leaked}`).not.toContain(leaked)
        }
    })
})

describe("the edit form loads what it is about to save", () => {
    it("the single-user fetch returns the current leader", () => {
        // Without this the select renders "no team leader" for everybody, and
        // saving an unrelated field silently unassigns them — a data loss with
        // no error and no visible cause.
        expect(blockAt(ROUTE, "const user = await prisma.user.findUnique(")).toContain("teamLeaderId: true")
    })

    it("the form reads it into state", () => {
        expect(FORM).toMatch(/setTeamLeaderId\(\s*employee\.teamLeaderId/)
    })

    it("sends null to unassign, never an empty string", () => {
        // absent means "leave it alone" and null means "unassign". An empty
        // string is neither: Zod would reject it, so the Admin resolving a
        // hand-off would get a validation error instead of an unassignment.
        expect(FORM).toMatch(/teamLeaderId\s*\|\|\s*null/)
    })
})

describe("only the people allowed to assign can", () => {
    it("the form offers the field to admins only, and never for self", () => {
        const payload = FORM.slice(FORM.indexOf("method: 'PUT'"))
        const line = payload.slice(payload.indexOf("teamLeaderId:"), payload.indexOf("teamLeaderId:") + 260)
        expect(line).toContain("ADMIN")
        expect(line).toContain("SUPER_ADMIN")
        expect(line).toMatch(/userId\s*!==\s*session\?\.user\?\.id/)
        // Leaders are not led, so the field is not sent for any other role.
        expect(line).toMatch(/role\s*===\s*'EMPLOYEE'/)
    })
})

describe("the hand-off modal asks a question rather than reporting an error", () => {
    it("reads the refused response before treating it as a failure", () => {
        // The server's refusal carries the people it is about. Falling through
        // to the generic error path would show an Admin a sentence instead of
        // the choice that resolves it.
        const block = FORM.slice(FORM.indexOf("if (!res.ok)"), FORM.indexOf("if (!res.ok)") + 700)
        expect(block).toMatch(/details\?\.reports|details\.reports/)
        expect(block).toContain("setHandoff(")
    })

    it("names the people instead of counting them", () => {
        // "7 people" is a number to accept; a list is a decision somebody can
        // actually make.
        expect(FORM).toMatch(/handoff\.map\(/)
    })

    it("sends null to unassign, never an empty string", () => {
        // Same three states as everywhere else: absent means nobody answered
        // and the change stays refused, null means unassign, an id means move.
        // An empty string is none of them and would fail validation.
        expect(FORM).toMatch(/executeSubmit\(handoffTo \|\| null\)/)
    })

    it("does not offer to hand the team to the person losing it", () => {
        const block = FORM.slice(FORM.indexOf("handoff && createPortal"))
        expect(block.slice(0, 2600)).toMatch(/leaders\.filter\(l => l\.id !== userId\)/)
    })

    it("passes the answer through to the request", () => {
        expect(FORM).toMatch(/reassignReportsTo:\s*reassignTo/)
    })
})

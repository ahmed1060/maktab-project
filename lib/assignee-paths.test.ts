import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { stripComments } from "./strip-comments"

/**
 * Every path that writes assignees asks the same function.
 *
 * The bug this prevents is not a missing check, it is a second path. The rule
 * was written carefully where somebody thought about it — task creation — and
 * the edit path that reaches the same column was written later by somebody
 * reading only the first, and validated nothing. A guard that only asserted
 * "creation checks the company" would have been green throughout.
 */

const body = (path: string) =>
    stripComments(readFileSync(path, "utf8"))
        .split("\n").filter(l => !/^\s*import\b/.test(l)).join("\n")

/** The balanced block a marker opens, so one path's assertion cannot be
 *  satisfied by a different path in the same file. */
function blockAt(source: string, marker: string): string {
    const start = source.indexOf(marker)
    expect(start, `missing: ${marker}`).toBeGreaterThan(-1)
    let depth = 0
    for (let i = start; i < source.length; i++) {
        if (source[i] === "{") depth++
        else if (source[i] === "}" && --depth === 0) return source.slice(start, i + 1)
    }
    throw new Error(`unbalanced: ${marker}`)
}

const WRITERS: [string, string, string][] = [
    ["task creation", "lib/services/task.service.ts", "static async create("],
    ["task edit", "lib/services/task.service.ts", "static async updateDetails("],
    ["obligation creation", "lib/services/obligation.service.ts", "static async create("],
    ["obligation edit", "lib/services/obligation.service.ts", "static async update("],
]

describe("no path writes assignees without asking", () => {
    for (const [name, file, marker] of WRITERS) {
        it(`${name} consults the shared guard`, () => {
            expect(blockAt(body(file), marker)).toContain("checkAssignees(")
        })
    }

    it("the bulk import applies the team rule too", () => {
        // A different shape — it validates a batch and reports a summary
        // rather than throwing — so it cannot use the same function, but it
        // must not be looser. An import is the easiest way to assign a hundred
        // tasks at once.
        const bulk = body("app/api/tasks/bulk/route.ts")
        expect(bulk).toContain("teamLeaderId")
        expect(bulk).toMatch(/user\.teamLeaderId\s*!==\s*session\.user\.id/)
    })
})

describe("the resource gate narrows to the team, not just the company", () => {
    const security = body("lib/security.ts")

    it("checks the team for people and for work", () => {
        // teamOnly: the view permission's scope, or the scope of the one
        // being used (lib/security.ts), each asked with scopesToTeam.
        expect(security).toContain("const teamOnly = (view: Permission) => scopesToTeam(session.user, view) || (!!acting && scopesToTeam(session.user, acting))")
        for (const kind of ["'USER'", "'TASK'", "'OBLIGATION'"]) {
            expect(blockAt(security, `case ${kind}:`)).toContain("teamOnly(")
        }
    })

    it("leaves company resources alone", () => {
        // A client's records belong to nobody in particular (CLIENTS_PLAN.md
        // §0.2). Narrowing them to a team protects no one and just stops
        // leaders using the screen they are given, so RecordService asks
        // about the company alone.
        const records = body("lib/services/record.service.ts")
        expect(records).toContain("can(session.user as any, permission, { companyId })")
        expect(records).not.toContain("teamOnly(")
        expect(records).not.toContain("scopesToTeam")
        for (const kind of ["'CLIENT'", "'SECTION'", "'NOTE'"]) expect(security).not.toContain(`case ${kind}:`)
    })

    it("answers a yes-or-no without loading whole user rows", () => {
        // `assignees: true` would fetch complete User records — salaries
        // included — on every request to every task route, to answer a
        // question about two columns.
        expect(security).not.toMatch(/assignees:\s*true/)
        expect(security).toMatch(/assignees:\s*\{\s*select:\s*\{\s*id:\s*true,\s*teamLeaderId:\s*true\s*\}\s*\}/)
    })
})

import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { stripComments } from "./strip-comments"

/**
 * Every surface that used to mean "the whole company" for a Team Leader.
 *
 * The role was written as `['ADMIN', 'TEAM_LEADER'].includes(...)` in six
 * separate files, each implemented on its own. That shared branch is the thing
 * this feature removes, so it is the thing to assert has gone: a leader who
 * still shares a branch with an Admin is a leader who still sees the company.
 *
 * Asserted on source because none of these can run without a database. The
 * behaviour itself is covered where it can be — lib/team-scope.test.ts for the
 * rule, task-query.test.ts for the builder — and every assertion here was
 * broken on purpose before being trusted.
 */

/**
 * Source with the import statements removed.
 *
 * Without this the guards below could not fail. They look for the rule by
 * name, and the import line carries every one of those names — so deleting
 * every call site while leaving `import { scopesToTeam } from ...` in place
 * kept the whole file green. That was found by breaking each surface on
 * purpose and watching nothing go red, which is the only way this kind of
 * mistake ever surfaces.
 */
function body(path: string): string {
    return stripComments(readFileSync(path, "utf8"))
        .split("\n")
        .filter(line => !/^\s*import\b/.test(line))
        .join("\n")
}

const SURFACES: [string, string][] = [
    ["tasks list (page)", "app/(dashboard)/dashboard/tasks/page.tsx"],
    ["tasks list (api)", "lib/services/task-query.ts"],
    // The route delegates to this: the clause moved out so the boundary could
    // be tested by running it rather than by reading it (see
    // lib/services/user-query.test.ts).
    ["employees list", "lib/services/user-query.ts"],
    ["requests", "app/api/requests/route.ts"],
    ["obligations", "app/api/obligations/route.ts"],
    ["exports", "app/api/templates/download/route.ts"],
    ["dashboard counters", "app/(dashboard)/dashboard/page.tsx"],
]

describe("no surface still treats a Team Leader as an Admin", () => {
    for (const [name, path] of SURFACES) {
        it(`${name} narrows to the team`, () => {
            const source = body(path)
            expect(source, `${path} must consult the shared rule`).toMatch(/scopesToTeam|assignedToTeamWhere|teamMemberWhere|assignedToReportsWhere/)
        })

        it(`${name} no longer shares a branch with ADMIN`, () => {
            // The exact shape that meant "the whole company, minus admins".
            const source = body(path)
            expect(source).not.toMatch(/\[\s*['"]ADMIN['"]\s*,\s*['"]TEAM_LEADER['"]\s*\]\s*\.includes/)
            expect(source).not.toMatch(/\[\s*['"]TEAM_LEADER['"]\s*,\s*['"]ADMIN['"]\s*\]\s*\.includes/)
        })
    }
})

describe("filters narrow the scope, they never replace it", () => {
    /**
     * F-03 was `whereClause.assignees = ...` running after the scope had
     * already set `whereClause.assignees`. It was fixed once in
     * buildTaskWhereClause while an identical line survived in the page next to
     * it, where an employee reached any colleague's tasks with ?employeeId= in
     * the URL. These assert the assignment cannot come back.
     */
    const FILTERED: [string, string][] = [
        ["tasks page", "app/(dashboard)/dashboard/tasks/page.tsx"],
        ["obligations", "app/api/obligations/route.ts"],
    ]

    for (const [name, path] of FILTERED) {
        it(`${name} does not assign over an assignee scope`, () => {
            const source = body(path)
            expect(source, "an employeeId filter must be composed, not assigned")
                .not.toMatch(/whereClause\.assignees\s*=/)
        })
    }

    it("the requests filter does not assign over the user scope", () => {
        const source = body("app/api/requests/route.ts")
        // where.userId = filterUserId would have replaced a leader's team scope.
        expect(source).not.toMatch(/where\.userId\s*=\s*filterUserId/)
    })
})

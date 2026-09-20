import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { stripComments } from "./strip-comments"

/**
 * The pickers show what the server sent, and nothing is hidden in the browser.
 *
 * Both of these used to fetch every user and filter Admins out client-side.
 * That was never a restriction — it decided what a dropdown displayed, not
 * what a request could contain, and the rows it hid had already crossed the
 * wire into the page payload. It is the same shape as the memberCosts leak and
 * the same shape as the employee task list before it was scoped.
 *
 * Now /api/users narrows a Team Leader to their own team server-side, so the
 * filtering would be redundant as well as misleading. These assert it has not
 * come back — a reintroduced filter would be a strong hint that somebody
 * noticed the wrong rows arriving and treated the symptom.
 */

const PICKERS = [
    ["new task", "app/(dashboard)/dashboard/tasks/new/page.tsx"],
    ["task detail", "app/(dashboard)/dashboard/tasks/[id]/client.tsx"],
] as const

describe("no picker filters people out in the browser", () => {
    for (const [name, path] of PICKERS) {
        it(`${name} does not drop roles client-side`, () => {
            const source = stripComments(readFileSync(path, "utf8"))
            expect(source, "a role filter in the browser hides rows that already arrived")
                .not.toMatch(/filter\(\s*\(?\s*u[^)]*\)?\s*=>\s*!?\s*\[\s*['"]ADMIN['"]/)
        })

    }
})

/**
 * Deliberately no assertion here about the route excluding Admins.
 *
 * One was written and removed: it searched the scoping block for 'ADMIN' and
 * passed with the conditional around that line disabled, because the string
 * was still sitting there in dead code. A guard that survives its own subject
 * being switched off is worse than none — it reports safety it has not
 * checked.
 *
 * Testing it properly means the route's where-clause has to be buildable
 * without a database, the way buildTaskWhereClause already is. That is a
 * refactor rather than a test, so it is tracked separately instead of being
 * approximated here.
 */

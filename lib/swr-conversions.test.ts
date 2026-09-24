import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { stripComments } from "./strip-comments"

const code = (path: string) => stripComments(readFileSync(path, "utf8"))

describe("the employee form loads once per person, not once per session refetch", () => {
    // The session is refetched every five minutes (app/providers.tsx) and
    // arrives as a new object each time. With the session object as a
    // dependency, the load re-ran and re-seeded every field from the server,
    // discarding an Admin's unsaved edits.
    const FORM = code("components/EmployeeProfileForm.tsx")

    it("keys the load on the signed-in user's id", () => {
        expect(FORM).toContain("}, [userId, userRole, sessionUserId])")
    })

    it("does not list the session object or t as a dependency anywhere", () => {
        expect(FORM).not.toMatch(/\[[^\]]*\bsession\b\s*[,\]][^\]]*\]\s*\)/)
        expect(FORM).not.toMatch(/\[[^\]]*,\s*t\s*\]\s*\)/)
    })

    it("still refers to the providers' refetch interval this reasoning depends on", () => {
        expect(code("app/providers.tsx")).toContain("refetchInterval={5 * 60}")
    })
})

describe("lists read from SWR are sorted on a copy", () => {
    // Array.prototype.sort sorts in place. On data that came out of SWR's
    // cache that rewrites the cached answer every other reader of the same
    // key also sees.
    it("the employee picker filters first, which makes the copy it sorts", () => {
        const src = code("components/EmployeeFilter.tsx")
        expect(src).toMatch(/\.filter\([^)]*\)\s*\.sort\(/)
        expect(src).not.toMatch(/\b(data|payload|employeesResult)\s*\.sort\(/)
    })

    it("the assignee list spreads into a new array before sorting", () => {
        const src = code("app/(dashboard)/dashboard/tasks/new/page.tsx")
        expect(src).toContain("[...usersList].sort(")
        expect(src).not.toMatch(/\busersList\s*\.sort\(/)
    })
})

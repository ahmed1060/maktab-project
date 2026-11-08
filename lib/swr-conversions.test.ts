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
        expect(FORM).toContain("}, [userId, userRole, sessionUserId, reloadKey, canAssignTeam])")
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
    // The lists' employee filter, where the old filter panel's picker was
    // until PR 222: it filters and maps, each making a new array, and sorts
    // nothing it read in place.
    it("the employee picker never sorts the list it read in place", () => {
        const src = code("components/filters/useEmployeeOptions.ts")
        expect(src).toContain("people.filter(")
        expect(src).not.toMatch(/\b(data|people)\s*\.sort\(/)
    })

    it("the assignee list spreads into a new array before sorting", () => {
        const src = code("app/(dashboard)/dashboard/tasks/new/page.tsx")
        expect(src).toContain("[...list].sort(")
        expect(src).not.toMatch(/\blist\s*\.sort\(/)
    })
})

describe("the salary table after an undo", () => {
    // The hand-written re-fetch after a rollback or reverse stored the whole
    // { success, data } envelope as the records, where the first load stored
    // its data array. Refreshing through the same SWR key unwraps both the
    // same way.
    const HISTORY = code("app/(dashboard)/dashboard/employees/[id]/history/page.tsx")

    it("is refreshed through the key the page first loaded it with", () => {
        expect(HISTORY).toContain("recordsQuery.mutate()")
        expect(HISTORY.match(/\/salary-history/g) ?? []).toHaveLength(1)
    })

    it("is never written by hand", () => {
        expect(HISTORY).not.toContain("setRecords(")
    })
})

import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { stripComments } from "@/lib/strip-comments"

/**
 * A task's page is drawn on the server, then taken over in the browser. A
 * date formatted as it's drawn comes out in the server's time zone and the
 * server's Arabic, so the browser drew it again, in Cairo's: every task
 * page did, by its deadline, and logged it as a hydration failure. Its
 * dates go through SafeDate, which draws one once the browser has the page,
 * as the task list's do.
 */

const PAGE = ["app/(dashboard)/dashboard/tasks/[id]/client.tsx", "components/TaskCostsSection.tsx"]

describe("a task's page", () => {
    it.each(PAGE)("draws no date as the server renders it: %s", file => {
        const source = stripComments(readFileSync(file, "utf8"))
        expect(source.match(/\.toLocale(Date|Time)?String\(/g) ?? []).toEqual([])
    })
})

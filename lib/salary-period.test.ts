import { describe, it, expect } from "vitest"
import { readFileSync, readdirSync, statSync } from "node:fs"
import { join } from "node:path"
import { stripComments } from "./strip-comments"

/**
 * One door to a salary record, and an adjustment that knows its own month.
 *
 * Guards rather than assertions about behaviour, because what these pin is the
 * absence of something: a second path that writes a salary record, a month
 * re-derived from a write timestamp, a row found by matching free text. Each of
 * those was in the codebase, each read as reasonable where it sat, and each
 * would read as reasonable again the next time somebody needs one.
 *
 * Comments are stripped first. These files explain at length why they do what
 * they do, so a plain substring search passes on the explanation alone — the
 * failure mode that made an earlier set of guards in this repository useless
 * until somebody removed the call one of them was meant to pin.
 */

function walk(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
        const full = join(dir, entry)
        if (statSync(full).isDirectory()) walk(full, out)
        else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) out.push(full)
    }
    return out
}

const SOURCES = [...walk("lib/services"), ...walk("app/api")]
const read = (path: string) => stripComments(readFileSync(path, "utf8"))

describe("only SalaryService writes a salary record", () => {
    it("creates one nowhere else", () => {
        // task.service.ts had its own find-or-create, with its own idea of how
        // many days a month has and where a base salary comes from — a second
        // definition of how a SalaryRecord is born, free to disagree with the
        // first about the same month.
        const offenders = SOURCES.filter(path => {
            if (path.endsWith("salary.service.ts")) return false
            return /salaryRecord\.(create|upsert)\b/.test(read(path))
        })
        expect(offenders, `these create a SalaryRecord directly: ${offenders.join(", ")}`).toEqual([])
    })

    it("creates an adjustment nowhere else", () => {
        const offenders = SOURCES.filter(path => {
            if (path.endsWith("salary.service.ts")) return false
            return /salaryAdjustment\.create\b/.test(read(path))
        })
        expect(offenders, `these write a SalaryAdjustment directly: ${offenders.join(", ")}`).toEqual([])
    })
})

describe("nothing infers an adjustment's month from when it was written", () => {
    it("does not re-derive a period from createdAt", () => {
        // `calendarMonth(new Date(adj.createdAt))` appeared twice, and both
        // times it was standing in for a column that did not exist. It gives
        // the right answer until a row does not land where its write time says
        // — and then the record that was incremented keeps the days forever
        // while a different one is credited.
        const offenders = SOURCES.filter(path =>
            /calendar(Month|Year)\s*\(\s*new Date\(\s*\w+\.createdAt/.test(read(path))
        )
        expect(offenders, `these derive a period from createdAt: ${offenders.join(", ")}`).toEqual([])
    })
})

describe("an adjustment is found by where it came from", () => {
    it("is not looked up by matching its reason text", () => {
        // `reason: { contains: id }` matched any adjustment whose free-text
        // reason happened to contain the request id, silently matched none
        // after an admin edited it, and in both cases left the salary record
        // holding a figure the request no longer agreed with.
        const offenders = SOURCES.filter(path => /reason:\s*\{\s*contains:/.test(read(path)))
        expect(offenders, `these match an adjustment by reason text: ${offenders.join(", ")}`).toEqual([])
    })

    it("carries a source on every write", () => {
        const service = read("lib/services/salary.service.ts")
        expect(service).toContain("source: input.source")
        expect(service).toContain("sourceId: input.sourceId")
    })
})

describe("the two automated paths go through the one door", () => {
    it("the task penalty does", () => {
        const task = read("lib/services/task.service.ts")
        expect(task).toContain("SalaryService.applyAdjustment")
        expect(task).toContain("source: 'TASK_PENALTY'")
        expect(task).toContain("sourceId: id")
    })

    it("the day-off deduction does", () => {
        const dayOff = read("lib/services/day-off.service.ts")
        expect(dayOff).toContain("SalaryService.applyAdjustment")
        expect(dayOff).toContain("source: 'DAY_OFF'")
        expect(dayOff).toContain("sourceId: id")
    })

    it("and the re-evaluation finds its row by that source", () => {
        const dayOff = read("lib/services/day-off.service.ts")
        const start = dayOff.indexOf("salaryAdjustment.findFirst")
        expect(start).toBeGreaterThan(-1)
        // Scoped to the block rather than the file: day-off touches salary in
        // two places, and a guard that matches the other one passes while the
        // thing it names is gone.
        const lookup = dayOff.slice(start, dayOff.indexOf("} else {", start))
        expect(lookup).toContain("sourceId: id")
        expect(lookup).toContain("month: adj.month")
    })
})

describe("the reversal route exists beside the rollback one", () => {
    it("is its own endpoint", () => {
        const route = read("app/api/users/[id]/adjustments/[adjId]/reverse/route.ts")
        expect(route).toContain("SalaryService.reverseAdjustment")
        expect(route).toContain("ADMIN")
    })

    it("and both refuse an adjustment that is already terminal", () => {
        for (const action of ["rollback", "reverse"]) {
            const route = read(`app/api/users/[id]/adjustments/[adjId]/${action}/route.ts`)
            expect(route, action).toContain("already been rolled back or reversed")
        }
    })
})

describe("the screen tells the two terminal states apart", () => {
    const page = read("app/(dashboard)/dashboard/employees/[id]/history/page.tsx")

    it("knows a reversed adjustment is finished", () => {
        // Without this the row renders as live and offers a Rollback button the
        // API answers with a 400 — a dead control on a page about money.
        expect(page).toContain("'ACTIVE' | 'ROLLED_BACK' | 'REVERSED'")
        expect(page).toContain("isTerminal(adj.status)")
    })

    it("shows the month the adjustment applies to", () => {
        // The point of the period columns, made visible: the month the days
        // landed on, beside the moment somebody typed it, because only one of
        // those decides what anybody is paid.
        expect(page).toContain("monthLabel(adj.year, adj.month)")
        expect(page).toContain("adjustment_source_${adj.source}")
    })

    it("offers the reversal as its own action", () => {
        expect(page).toContain("handleUndo(target.id, 'reverse'")
    })
})

import { describe, it, expect } from "vitest"
import { readFileSync, readdirSync, statSync } from "node:fs"
import { join } from "node:path"
import { stepUpRefusal, isHighRisk } from "./step-up"
import { PERMISSIONS, type Permission } from "./permissions/catalogue"
import { stripComments } from "./strip-comments"

const HIGH_RISK = (Object.keys(PERMISSIONS) as Permission[]).filter(isHighRisk)
const MINUTE = 60_000

describe("step-up confirmation (ROLES_PLAN.md §6.15)", () => {
    const confirmed = (minutesAgo: number) => ({ mfaEnabled: true, stepUpAt: Date.now() - minutesAgo * MINUTE })

    it("covers every permission the catalogue marks high-risk, and nothing else", () => {
        expect(HIGH_RISK.sort()).toEqual([
            "clients.delete", "debts.waive", "employees.delete", "employees.end_contract", "payroll.approve",
            "payroll.mark_paid", "salary.edit", "salary_adjustments.manage", "tasks.delete", "tasks.pay", "tasks.penalize",
        ])
        expect(stepUpRefusal({ mfaEnabled: false }, "tasks.view", 60)).toBeNull()
    })

    it("asks somebody without two-factor authentication to set it up", () => {
        expect(stepUpRefusal({ mfaEnabled: false }, "payroll.approve", 60)).toBe("MFA_ENROL_REQUIRED")
    })

    it("asks for a code when none was entered this session", () => {
        expect(stepUpRefusal({ mfaEnabled: true }, "payroll.approve", 60)).toBe("STEP_UP_REQUIRED")
    })

    it("lets it through within the interval, counted from the code, and not after", () => {
        expect(stepUpRefusal(confirmed(59), "debts.waive", 60)).toBeNull()
        expect(stepUpRefusal(confirmed(61), "debts.waive", 60)).toBe("STEP_UP_REQUIRED")
        expect(stepUpRefusal(confirmed(20), "debts.waive", 15)).toBe("STEP_UP_REQUIRED")
    })
})

/**
 * Every place that lets somebody do a high-risk thing asks for the code — a
 * route added later that checks one of these permissions and forgets the
 * step-up fails here, rather than quietly skipping it.
 */
describe("every high-risk action asks", () => {
    function walk(dir: string, out: string[] = []): string[] {
        for (const entry of readdirSync(dir)) {
            const full = join(dir, entry)
            if (statSync(full).isDirectory()) walk(full, out)
            else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) out.push(full)
        }
        return out
    }
    // Where a high-risk permission lets something happen. Reads that ask one
    // (a settlement preview asks end_contract) are listed with why they need
    // no code.
    const READS_ONLY: Record<string, string> = {
        // Which tasks a team-scoped payer may see in the payment list.
        "lib/services/task.service.ts": "tasks.pay scope for a list; the delete path is the route's, which asks",
        // Same checks as the routes that call them, after the route asked.
        "lib/services/client.service.ts": "called by DELETE /api/clients, which asks",
        "lib/services/section.service.ts": "called by DELETE /api/clients/[id]/sections, which asks",
        "lib/services/note.service.ts": "called by DELETE …/notes, which asks",
        // Names them as what a review lists, not to let anybody act.
        "lib/services/access-review.service.ts": "the permissions an access review lists",
    }
    const uses = (source: string, p: string) => new RegExp(`["']${p.replace(".", "\\.")}["']`).test(source)

    it("in every route and service that grants one", () => {
        const missing: string[] = []
        for (const file of [...walk("app/api"), ...walk("lib/services")]) {
            const source = stripComments(readFileSync(file, "utf8"))
            for (const p of HIGH_RISK) {
                if (!uses(source, p) || READS_ONLY[file]) continue
                if (!new RegExp(`assertStepUp\\(session, ["']${p.replace(".", "\\.")}["']\\)`).test(source)) missing.push(`${file}: ${p}`)
            }
        }
        expect(missing).toEqual([])
    })
})

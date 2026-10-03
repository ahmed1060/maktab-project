import { describe, it, expect } from "vitest"
import { readFileSync, readdirSync, statSync } from "node:fs"
import { join } from "node:path"
import { stripComments } from "./strip-comments"

/**
 * One writer of a person's role (ROLES_PLAN.md §3.1).
 *
 * `User.role` is copied from the role a person holds, and `User.roleId` says
 * which that is. RoleAssignmentService produces both, together; the database
 * refuses a pair that disagree. This keeps the code honest before the database
 * has to: a user write that sets either field outside the service fails here.
 */

function walk(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
        if (entry === "node_modules" || entry === ".next") continue
        const full = join(dir, entry)
        if (statSync(full).isDirectory()) walk(full, out)
        else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$|harness|test-actors/.test(entry)) out.push(full)
    }
    return out
}

const SOURCES = [...walk("app"), ...walk("lib"), ...walk("scripts"), "prisma/seed.ts"]
const code = (path: string) => stripComments(readFileSync(path, "utf8"))

/** The `data` of every user create/update, as written. */
function userWrites(source: string): string[] {
    const writes: string[] = []
    for (const m of source.matchAll(/\buser\.(create|update|updateMany|upsert|createMany)\(\{/g)) {
        // The balanced object the call was given.
        let depth = 0, i = m.index! + m[0].length - 1
        for (; i < source.length; i++) {
            if (source[i] === "{") depth++
            else if (source[i] === "}" && --depth === 0) break
        }
        writes.push(source.slice(m.index!, i + 1))
    }
    return writes
}

/** The balanced object after `data:` in one write, or null. */
function dataOf(write: string): string | null {
    const at = write.search(/\bdata:\s*\{/)
    if (at < 0) return null
    const start = write.indexOf("{", at)
    let depth = 0
    for (let i = start; i < write.length; i++) {
        if (write[i] === "{") depth++
        else if (write[i] === "}" && --depth === 0) return write.slice(start, i + 1)
    }
    return null
}

describe("only RoleAssignmentService decides a person's role", () => {
    it("no user write names role or roleId by hand", () => {
        const offenders: string[] = []
        for (const path of SOURCES) {
            for (const write of userWrites(code(path))) {
                const data = dataOf(write)
                if (data && /\b(role|roleId)\s*:/.test(data)) offenders.push(`${path}: ${data.slice(0, 80)}…`)
            }
        }
        expect(offenders, "take role and roleId from RoleAssignmentService").toEqual([])
    })

    it("nothing sets a roleId on data being written", () => {
        // updateData.roleId = …, data.roleId = … — the session copying the
        // token's value for can() to read is not a write to anybody's row.
        const offenders = SOURCES.filter(path => /\b(?!session\.user\b)\w+\.roleId\s*=(?!=)/.test(code(path).replace(/session\.user\.roleId\s*=/g, "")))
        expect(offenders).toEqual([])
    })

    it("the paths that create or change someone's role use it", () => {
        const users = code("lib/services/user.service.ts")
        // Hiring (a Super Admin or company-less account, and a role asked for
        // by kind), and editing a role by kind or a company.
        expect(users.match(/RoleAssignmentService\.builtIn\(/g)).toHaveLength(3)
        // A role asked for by id, on hiring and on editing — and checked before
        // hiring for a role that is only asked for (§6.12); and the default.
        expect(users.match(/RoleAssignmentService\.chosen\(/g)).toHaveLength(4)
        expect(users).toContain("RoleAssignmentService.defaultFor(")
        expect(users).toContain("...assignment")
        expect(code("scripts/seed-payroll-demo.ts")).toContain("RoleAssignmentService.builtIn(")
    })

    it("a new company gets its built-in roles in the same transaction", () => {
        const companies = code("lib/services/company.service.ts")
        const tx = companies.slice(companies.indexOf("prisma.$transaction(async (tx) =>"))
        expect(tx.slice(0, 400)).toContain("RoleService.seedBuiltInRoles(tx, created.id)")
    })
})

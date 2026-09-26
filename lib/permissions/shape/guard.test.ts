import { describe, it, expect } from "vitest"
import { readFileSync, readdirSync, statSync } from "node:fs"
import { join } from "node:path"
import { stripComments } from "@/lib/strip-comments"

/**
 * Nothing picks a protected field by itself.
 *
 * A file that reads a salary out of the database either hands it to shapeUser
 * before it leaves, or is listed here with the reason it never leaves. The list
 * is short on purpose: a new entry is a claim somebody has to make in review.
 */

const NEVER_SENT: Record<string, string> = {
    // Reads a salary to seed a month's record; nothing is returned to a caller.
    "lib/services/cron.service.ts": "cron job, no response",
    // The fallback rate for a salary record, used in arithmetic only.
    "lib/services/salary.service.ts": "internal rate lookup",
    // Returns the updated row to PUT /api/users, which shapes it.
    "lib/services/user.service.ts": "shaped by app/api/users/route.ts",
}

function walk(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
        if (entry === "node_modules") continue
        const full = join(dir, entry)
        if (statSync(full).isDirectory()) walk(full, out)
        else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$|harness/.test(entry)) out.push(full)
    }
    return out
}

const SOURCES = [...walk("app"), ...walk("lib"), ...walk("components")]

describe("a salary read from the database is shaped before it is sent", () => {
    const readers = SOURCES.filter(path => /\bsalary:\s*true\b/.test(stripComments(readFileSync(path, "utf8"))))

    it("finds the readers it knows about", () => {
        expect(readers).toContain("app/api/users/route.ts")
    })

    for (const path of readers) {
        it(path, () => {
            if (path in NEVER_SENT) return
            expect(stripComments(readFileSync(path, "utf8")), `${path} selects salary; send it through shapeUser`).toContain("shapeUser(")
        })
    }

    it("lists no file that no longer reads a salary", () => {
        for (const path of Object.keys(NEVER_SENT)) expect(readers, `${path} is listed but reads no salary`).toContain(path)
    })
})

import { describe, it, expect } from "vitest"
import { readFileSync, readdirSync, statSync } from "node:fs"
import { join } from "node:path"
import { roleLabel } from "./role-label"
import { en } from "./translations/en"
import { ar } from "./translations/ar"

const tEn = (k: string) => (en as Record<string, string>)[k]
const tAr = (k: string) => (ar as Record<string, string>)[k]

describe("a role's name as people read it", () => {
    it("names a built-in role in the reader's language", () => {
        expect(roleLabel({ name: "Admin", builtIn: "ADMIN" }, tAr)).toBe("مسؤول")
        expect(roleLabel({ name: "Team Leader", builtIn: "TEAM_LEADER" }, tAr)).toBe("قائد فريق")
        expect(roleLabel({ name: "Employee", builtIn: "EMPLOYEE" }, tAr)).toBe("موظف")
        expect(roleLabel({ name: "Admin", builtIn: "ADMIN" }, tEn)).toBe("Admin")
    })

    it("names any other role as the Super Admin named it, in either language", () => {
        expect(roleLabel({ name: "HR Officer", builtIn: null }, tAr)).toBe("HR Officer")
        expect(roleLabel({ name: "Admin assistant" }, tAr)).toBe("Admin assistant")
    })

    it("says so when there is no role", () => {
        expect(roleLabel(null, tEn)).toBe("—")
        expect(roleLabel(undefined, tEn, "New role")).toBe("New role")
    })
})

/**
 * Screens show a role through roleLabel(), so a built-in one reads in the
 * viewer's language. A line that reads a role's stored name for anything else
 * is listed here, with why.
 */
const NOT_SHOWN: Record<string, string> = {
    "app/(dashboard)/dashboard/role-templates/page.tsx": "a template's name; templates are never built-in",
    "components/RoleEditorModal.tsx": "the editable name field's state; a built-in role's field shows roleLabel()",
    "components/EmployeeProfileForm.tsx": "loads the role it then shows through roleLabel()",
}

function files(dir: string): string[] {
    return readdirSync(dir).flatMap(f => {
        const path = join(dir, f)
        return statSync(path).isDirectory() ? files(path) : path.endsWith(".tsx") ? [path] : []
    })
}

describe("screens name roles through roleLabel()", () => {
    it("reads no role's stored name for display", () => {
        const found: string[] = []
        for (const file of [...files("app"), ...files("components")]) {
            if (NOT_SHOWN[file]) continue
            readFileSync(file, "utf8").split("\n").forEach((line, i) => {
                if (/([Rr]ole|current|deleting)[?!]?\.name\b|\.roleName\b/.test(line) && !line.includes("roleLabel(")) found.push(`${file}:${i + 1}: ${line.trim()}`)
            })
        }
        expect(found).toEqual([])
    })

    it("lists only files that still need listing", () => {
        for (const file of Object.keys(NOT_SHOWN)) {
            expect(readFileSync(file, "utf8")).toMatch(/([Rr]ole|current|deleting)[?!]?\.name\b/)
        }
    })
})

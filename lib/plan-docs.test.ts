import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { PERMISSIONS } from "./permissions/catalogue"

/**
 * The two plans are marked built, so they are read as the description of
 * what exists. Where they name a permission, a model or a phase, they say
 * what the code does (review on #1).
 */

const ROLES = readFileSync("ROLES_PLAN.md", "utf8")
const ATTENDANCE = readFileSync("ATTENDANCE_PLAN.md", "utf8")
const section = (doc: string, from: string, to: string) => doc.slice(doc.indexOf(from), doc.indexOf(to, doc.indexOf(from)))

describe("the roles plan", () => {
    it("names only permissions the catalogue has, in its permission table", () => {
        const named = ROLES.split("\n").filter(l => l.startsWith("|")).flatMap(l => [...l.matchAll(/`([a-z_]+\.[a-z_]+)`/g)].map(m => m[1]))
        expect(named.filter(p => !(p in PERMISSIONS))).toEqual([])
        // The three record rights (once the old Clients section's), not the one the first draft had.
        for (const p of ["records.contribute", "records.edit", "records.delete"]) expect(named).toContain(p)
    })

    it("lists every high-risk permission under step-up confirmation", () => {
        const stepUp = section(ROLES, "### 6.15", "- **Marked in the catalogue")
        const highRisk = Object.entries(PERMISSIONS).filter(([, d]) => (d as { highRisk?: string }).highRisk).map(([p]) => p)
        expect(highRisk.length).toBe(12)
        for (const p of highRisk) expect(stepUp, p).toContain(`\`${p}\``)
    })

    it("asks for two-factor set-up on first use, not at sign-in", () => {
        const stepUp = section(ROLES, "### 6.15", "## 7.")
        expect(stepUp).not.toMatch(/enrol at next sign-in/)
        expect(stepUp).toContain("MFA_ENROL_REQUIRED")
    })

    it("shows the models as built", () => {
        const model = section(ROLES, "## 5. Data model", "## 6. Screens")
        for (const gone of ["previousRoleId", "RoleAssignmentRequest", "isBuiltIn"]) expect(model).not.toContain(gone)
        for (const built of ["returnRoleId", "model RoleRequest", "builtIn              UserRole?"]) expect(model).toContain(built)
        const schema = readFileSync("prisma/schema.prisma", "utf8")
        for (const name of ["model RoleTemplate", "model Role ", "model RoleGrant", "model RoleRequest", "returnRoleId", "defaultRoleId"]) expect(schema).toContain(name)
    })
})

describe("the attendance plan", () => {
    it("says which phases are built", () => {
        const status = ATTENDANCE.slice(0, ATTENDANCE.indexOf("\n\n", ATTENDANCE.indexOf("Status:")))
        expect(status).not.toMatch(/Phase 0\s+onwards is not built/)
        expect(status).toContain("built through Phase 3b")
        for (const phase of ["Phase 0", "Phase 1", "Phase 2", "Phase 3 ", "Phase 3b"]) {
            expect(ATTENDANCE, phase).toMatch(new RegExp(`### ${phase.trim()} — .* — built \\(#`))
        }
        expect(ATTENDANCE).toMatch(/### Phase 4 — .* — not built/)
    })
})

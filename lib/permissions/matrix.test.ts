import { describe, it, expect } from "vitest"
import { PERMISSIONS, isReserved, type Permission } from "./catalogue"
import { normalizeGrants } from "./grant-rules"
import { en } from "@/lib/translations/en"
import { ar } from "@/lib/translations/ar"
import { PERMISSION_GROUPS, permissionLabelKey, groupLabelKey, scopeLabelKey, riskLabelKey, setGrant, neededBy, drift, widestScope } from "./matrix"

const ALL = Object.keys(PERMISSIONS) as Permission[]

describe("the permission matrix", () => {
    it("shows every permission, once, but those nothing checks yet", () => {
        const shown = PERMISSION_GROUPS.flatMap(g => g.permissions)
        // Reserved ones are left out, so no role promises access it does not
        // give (catalogue.ts): the audit log. Company settings came off the
        // list when a company's own people could be shown them.
        expect(shown.sort()).toEqual(ALL.filter(p => !isReserved(p)).sort())
        expect(ALL.filter(isReserved).sort()).toEqual(["audit.view"])
        expect(PERMISSION_GROUPS.every(g => g.permissions.length > 0)).toBe(true)
    })

    it("refuses saving a role or template with one nothing checks yet", () => {
        expect(normalizeGrants([{ permission: "audit.view", scope: "COMPANY" }])).toEqual({ ok: false, errors: ["audit.view is not available yet"] })
    })

    // A row labelled with its raw key would look like a bug to the Super Admin
    // and mean nothing to a client reading the contract.
    it("labels every row, group, scope and risk in both languages", () => {
        const keys = [
            ...ALL.map(permissionLabelKey),
            ...PERMISSION_GROUPS.map(g => groupLabelKey(g.key)),
            ...(["OWN", "TEAM", "COMPANY"] as const).map(scopeLabelKey),
        ]
        for (const p of ALL) if ((PERMISSIONS[p] as any).highRisk) keys.push(riskLabelKey(p)!)
        expect(keys.filter(k => !k || !(k in en) || !(k in ar))).toEqual([])
    })

    it("ticking a row adds what it needs, at its scope", () => {
        expect(setGrant({}, "payroll.approve", "COMPANY")).toEqual({ "payroll.approve": "COMPANY", "payroll.view": "COMPANY", "salary.view": "COMPANY" })
        expect(setGrant({ "tasks.view": "TEAM" }, "tasks.review", "COMPANY")).toEqual({ "tasks.view": "COMPANY", "tasks.review": "COMPANY" })
    })

    it("unticking a row another needs leaves it, and says why", () => {
        const grants = setGrant({}, "dayoff.approve", "TEAM")
        expect(setGrant(grants, "dayoff.view", null)).toEqual(grants)
        expect(neededBy(grants)["dayoff.view"]).toEqual(["dayoff.approve"])
        expect(setGrant(grants, "dayoff.approve", null)).toEqual({ "dayoff.view": "TEAM" })
    })

    it("ticks at the widest scope a permission allows", () => {
        expect(widestScope("tasks.view")).toBe("COMPANY")
        expect(widestScope("payroll.view")).toBe("COMPANY")
    })

    it("finds where a role has drifted from its template", () => {
        expect([...drift({ "tasks.view": "TEAM", "records.view": "COMPANY" }, { "tasks.view": "COMPANY", "clients.view": "COMPANY" })].sort())
            .toEqual(["clients.view", "records.view", "tasks.view"])
    })
})

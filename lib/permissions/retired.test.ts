import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import * as catalogue from "./catalogue"
import { ALL_PERMISSIONS, CATALOGUE_VERSION, PERMISSIONS, RETIRED_CODES, isPermission } from "./catalogue"
import { PERMISSION_GROUPS, namedPermissionKey } from "./matrix"
import { grantsFromRows, normalizeGrants, rowsHeld } from "./grant-rules"
import { holdersOf } from "./holders"
import { BUILT_IN_GRANTS } from "./built-in"
import { describeValue } from "@/lib/audit-details"
import { en } from "@/lib/translations/en"
import { ar } from "@/lib/translations/ar"

/**
 * The old permissions retired (LATER_CHANGES_PLAN.md §2, PR 386): the nine
 * split by what they do are gone from the catalogue, now that the grant for
 * companies already there (PR 385) wrote their parts in every role and
 * template. Their codes are never handed out again, and what recorded them
 * still names them in words.
 */

const OLD = {
    "obligations.manage": 24, "clients.manage": 30, "salary_adjustments.manage": 37, "settlements.manage": 43,
    "locations.add": 56, "locations.manage": 57, "lists.manage": 59, "charges.manage": 61, "client_accounts.manage": 70,
} as const
const NAMES = Object.keys(OLD) as (keyof typeof OLD)[]
const WORDS: Record<keyof typeof OLD, [string, string]> = {
    "obligations.manage": ["Manage obligations", ar.perm_obligations_manage],
    "clients.manage": ["Manage clients", ar.perm_clients_manage],
    "salary_adjustments.manage": ["Add bonuses and deductions", ar.perm_salary_adjustments_manage],
    "settlements.manage": ["Manage final settlements", ar.perm_settlements_manage],
    "locations.add": ["Add locations", ar.perm_locations_add],
    "locations.manage": ["Manage locations", ar.perm_locations_manage],
    "lists.manage": ["Manage lists", ar.perm_lists_manage],
    "charges.manage": ["Manage charges", ar.perm_charges_manage],
    "client_accounts.manage": ["Manage who signs in for a client", ar.perm_client_accounts_manage],
}
const reader = (dict: Record<string, string>, locale: string) => ({ t: (key: string) => dict[key] ?? "", locale }) as any

describe("the catalogue", () => {
    it("has none of the nine, and offers none of them", () => {
        for (const name of NAMES) expect(isPermission(name), name).toBe(false)
        expect(ALL_PERMISSIONS.filter(p => (NAMES as string[]).includes(p))).toEqual([])
        expect(PERMISSION_GROUPS.flatMap(g => g.permissions).filter(p => (NAMES as string[]).includes(p))).toEqual([])
    })

    it("retires each one's code, never to be handed out again", () => {
        expect([...RETIRED_CODES].sort((a, b) => a - b)).toEqual(Object.values(OLD).sort((a, b) => a - b))
        const codes = ALL_PERMISSIONS.map(p => PERMISSIONS[p].code)
        expect(codes.filter(c => RETIRED_CODES.includes(c))).toEqual([])
    })

    it("keeps nothing split, so no permission is read as others", () => {
        expect(Object.keys(catalogue).filter(k => /split/i.test(k))).toEqual([])
        for (const p of ALL_PERMISSIONS) expect((PERMISSIONS[p] as { splitInto?: unknown }).splitInto, p).toBeUndefined()
    })

    it("stays at its version: every session since each split holds the parts, never the old ones", () => {
        // Raised once since, for employees.edit_contract_start (PR 425), a permission of its own.
        expect(CATALOGUE_VERSION).toBe(14)
    })

    it("seeds no built-in role with one", () => {
        for (const grants of Object.values(BUILT_IN_GRANTS)) for (const name of NAMES) expect((grants as Record<string, unknown>)[name], name).toBeUndefined()
    })
})

describe("a role or template naming one", () => {
    it("is refused when saved, as any name the catalogue doesn't know is", () => {
        for (const name of NAMES) {
            expect(normalizeGrants([{ permission: name, scope: "COMPANY" }])).toEqual({ ok: false, errors: [`Unknown permission: ${name}`] })
        }
    })

    it("is read as holding nothing under it", () => {
        expect(grantsFromRows([{ permission: "clients.manage", scope: "COMPANY" }, { permission: "clients.view", scope: "COMPANY" }])).toEqual({ "clients.view": "COMPANY" })
        expect(rowsHeld([{ permission: "obligations.manage", scope: "TEAM" }])).toEqual([])
    })
})

describe("asking who holds a part", () => {
    it("asks for the part alone", () => {
        expect(holdersOf("clients.edit")).toEqual({ assignedRole: { grants: { some: { permission: "clients.edit" } } } })
        expect(holdersOf("obligations.approve", "TEAM")).toEqual({ assignedRole: { grants: { some: { permission: "obligations.approve", scope: "TEAM" } } } })
    })
})

describe("what recorded one", () => {
    it("still names it in words, in both languages", () => {
        for (const name of NAMES) {
            const [english, arabic] = WORDS[name]
            expect(arabic, name).toBeTruthy()
            expect(namedPermissionKey(name), name).toBe(`perm_${name.replace(/\./g, "_")}`)
            expect(describeValue(name, "permission", reader(en, "en")), name).toBe(english)
            expect(describeValue(name, "permission", reader(ar, "ar")), name).toBe(arabic)
        }
    })

    it("names a grant of one in an audit entry's list, with its scope", () => {
        expect(describeValue([{ permission: "clients.manage", scope: "COMPANY" }], "grants", reader(en, "en"))).toBe(`Manage clients (${en.scope_COMPANY})`)
    })

    it("names anything else as it was written", () => {
        expect(namedPermissionKey("vendors.manage")).toBeNull()
        expect(describeValue("vendors.manage", "permission", reader(en, "en"))).toBe("vendors.manage")
    })

    it("is named so on the access reviews screen and in a template's offer", () => {
        for (const file of ["components/AccessReviews.tsx", "components/TemplateOfferModal.tsx"]) {
            const source = readFileSync(file, "utf8")
            expect(source, file).toContain("namedPermissionKey(")
            expect(source, file).not.toContain("isPermission(")
        }
    })
})

describe("the roles plan", () => {
    it("marks each retired, with what it was split into", () => {
        const plan = readFileSync("ROLES_PLAN.md", "utf8")
        for (const name of NAMES) {
            const row = plan.split("\n").find(l => l.startsWith("|") && l.includes(`\`${name}\` |`))
            expect(row, name).toContain("Retired (#386)")
        }
    })
})

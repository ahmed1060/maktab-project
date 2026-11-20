import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { moduleForApiPath } from "./features/routes"
import { PERMISSIONS, isPermission, isReserved } from "./permissions/catalogue"
import { PERMISSION_GROUPS, permissionLabelKey, riskLabelKey } from "./permissions/matrix"
import { normalizeGrants } from "./permissions/grant-rules"
import { BUILT_IN_GRANTS } from "./permissions/built-in"
import { isHighRisk } from "./step-up"
import { KNOWN_REFUSALS } from "./api-errors"
import { AUDIT_ACTIONS } from "./audit-codes"
import { messagesCompanyId } from "./client-message-template"
import { nizmoMessageAgainSchema } from "./validations/client-message.schema"
import { en } from "./translations/en"
import { ar } from "./translations/ar"

/**
 * A company's own copy of the client messages on WhatsApp, as it's kept and
 * checked (CLIENT_PORTAL_PLAN.md §7.1, §9, §12 step 10c-1; PR 348): the
 * permission it comes with, its routes, which company they're for, and what
 * they're refused with. Nothing shows them yet: the Client portal tab is
 * step 10c-2. Saving and going back to Nizmo's are in
 * lib/client-message-templates.db.test.ts.
 */

const PERMISSION = "client_messages.manage"
const source = (path: string) => readFileSync(path, "utf8")

describe("client_messages.manage (§9)", () => {
    it("is company-wide, in the tax position's module, bringing nothing with it, and not high-risk", () => {
        expect((PERMISSIONS as Record<string, unknown>)[PERMISSION]).toEqual({ code: 71, module: "TAX_POSITION", scopes: ["COMPANY"] })
        expect(isPermission(PERMISSION)).toBe(true)
        expect(isReserved(PERMISSION as never)).toBe(false)
        expect(Object.values(PERMISSIONS).filter(p => p.code === 71)).toHaveLength(1)
        // A message the client's person can still change before sending: no step-up confirmation.
        expect(isHighRisk(PERMISSION as never)).toBe(false)
        expect(riskLabelKey(PERMISSION as never)).toBeNull()
    })

    it("needs no other permission: the Client portal tab shows to whoever holds it, whatever Admin access says (§7.1)", () => {
        const verdict = normalizeGrants([{ permission: PERMISSION, scope: "COMPANY" }])
        expect(verdict.ok).toBe(true)
        if (!verdict.ok) return
        expect(verdict.grants).toEqual({ [PERMISSION]: "COMPANY" })
    })

    it("is under Client portal in the permission matrix, last, named in both languages as the mockup names it", () => {
        expect(PERMISSION_GROUPS.find(g => g.key === "client_portal")?.permissions).toEqual(["tax.view", "tax.manage", "client_accounts.manage", PERMISSION])
        expect((en as Record<string, string>)[permissionLabelKey(PERMISSION as never)]).toBe("Change client messages on WhatsApp")
        expect((ar as Record<string, string>)[permissionLabelKey(PERMISSION as never)]).toBe("تغيير رسائل العملاء على واتساب")
    })

    it("is the built-in Admin's, and nobody else's until the Super Admin gives it", () => {
        expect((BUILT_IN_GRANTS.ADMIN as Record<string, string>)[PERMISSION]).toBe("COMPANY")
        expect((BUILT_IN_GRANTS.TEAM_LEADER as Record<string, string>)[PERMISSION]).toBeUndefined()
        expect((BUILT_IN_GRANTS.EMPLOYEE as Record<string, string>)[PERMISSION]).toBeUndefined()
    })

    it("is in the roles plan's table with its routes, and not among the high-risk ones", () => {
        const plan = source("ROLES_PLAN.md")
        const row = plan.split("\n").find(line => line.startsWith("|") && line.includes(`\`${PERMISSION}\``))
        expect(row).toContain("GET /company-messages")
        expect(row).toContain("/company-messages/[kind]/[language]")
        expect(row).not.toContain("high-risk")
        expect(plan.slice(plan.indexOf("### 6.15"), plan.indexOf("- **Marked in the catalogue"))).not.toContain(`\`${PERMISSION}\``)
    })
})

describe("the routes (§7.1)", () => {
    const list = () => source("app/api/company-messages/route.ts")
    const one = () => source("app/api/company-messages/[kind]/[language]/route.ts")

    it("are under an address of their own that the client portal's gate holds", () => {
        expect(moduleForApiPath("/api/company-messages")).toBe("TAX_POSITION")
        expect(moduleForApiPath("/api/company-messages/contact/ar")).toBe("TAX_POSITION")
        // Nizmo's own stay the Super Admin's, whatever a package has.
        expect(moduleForApiPath("/api/client-messages")).toBeNull()
    })

    it("read the company's messages, save one, and go back to Nizmo's, each for whoever holds the permission", () => {
        expect(list()).toMatch(/export const GET = withStandardHandler\([\s\S]*?\{ permission: "client_messages\.manage" \}\)/)
        expect(one()).toMatch(/export const PUT = withStandardHandler\([\s\S]*?\{ permission: "client_messages\.manage" \}\)/)
        expect(one()).toMatch(/export const DELETE = withStandardHandler\([\s\S]*?\{ permission: "client_messages\.manage" \}\)/)
        for (const route of [list(), one()]) expect(route.match(/withStandardHandler\(/g)!.length).toBe(route.match(/\{ permission: "client_messages\.manage" \}\)/g)!.length)
        expect(list()).toContain("ApiResponse.success({ messages: await companyMessages(companyId) })")
        expect(one()).toContain("await saveCompanyMessage(actorOf(session), companyId, validation.data)")
        expect(one()).toContain("await nizmoMessageAgain(actorOf(session), companyId, validation.data)")
    })

    it("each find the company first, and send nothing on without one", () => {
        for (const route of [list(), one()]) {
            const handlers = route.split(/export const (?:GET|PUT|DELETE) = /).slice(1)
            for (const handler of handlers) {
                expect(handler).toMatch(/^withStandardHandler\(async \(req, session[^)]*\) => \{\s*const companyId = messagesCompanyId\(session\.user as any, new URL\(req\.url\)\.searchParams\.get\("companyId"\)\)\s*if \(!companyId\) return ApiResponse\.badRequest\("companyId is required"\)/)
            }
        }
    })

    it("read the message and language from the address, never the body", () => {
        expect(one()).toContain("clientMessageSchema.safeParse({ ...json, kind: context.params.kind, language: context.params.language })")
        expect(one()).toContain("nizmoMessageAgainSchema.safeParse({ ...json, kind: context.params.kind, language: context.params.language })")
    })
})

describe("which company's messages", () => {
    it("are one's own company's, whatever is asked for", () => {
        expect(messagesCompanyId({ role: "ADMIN", companyId: "c1" }, "c2")).toBe("c1")
        expect(messagesCompanyId({ role: "EMPLOYEE", companyId: "c1" }, null)).toBe("c1")
        expect(messagesCompanyId({ role: "EMPLOYEE", companyId: null }, "c2")).toBeNull()
    })

    it("are the one asked for, for the Super Admin, who has none of their own", () => {
        expect(messagesCompanyId({ role: "SUPER_ADMIN", companyId: null }, "c2")).toBe("c2")
        expect(messagesCompanyId({ role: "SUPER_ADMIN", companyId: null }, null)).toBeNull()
        expect(messagesCompanyId({ role: "SUPER_ADMIN", companyId: null }, "")).toBeNull()
    })
})

describe("going back to Nizmo's message", () => {
    it("says which message, in which language, and the time of the company's copy the page read", () => {
        expect(nizmoMessageAgainSchema.safeParse({ kind: "contact", language: "ar", since: "2026-11-20T10:00:00.000Z" }).success).toBe(true)
        expect(nizmoMessageAgainSchema.safeParse({ kind: "claim", language: "en", since: null }).success).toBe(true)
        expect(nizmoMessageAgainSchema.safeParse({ kind: "claim", language: "en" }).success).toBe(false)
        expect(nizmoMessageAgainSchema.safeParse({ kind: "other", language: "en", since: null }).success).toBe(false)
        expect(nizmoMessageAgainSchema.safeParse({ kind: "claim", language: "fr", since: null }).success).toBe(false)
        expect(nizmoMessageAgainSchema.safeParse({ kind: "claim", language: "en", since: "yesterday" }).success).toBe(false)
    })
})

describe("what they're refused with", () => {
    it("a company whose package hasn't the client portal is refused, saying so", () => {
        expect(KNOWN_REFUSALS.CLIENT_PORTAL_NOT_IN_PACKAGE).toEqual({ status: 403, message: "This company's package doesn't include the client portal." })
        expect(KNOWN_REFUSALS.COMPANY_NOT_FOUND?.status).toBe(404)
    })

    it("a text is refused as Nizmo's are, and one changed since as Nizmo's is", () => {
        for (const code of ["MESSAGE_EMPTY", "MESSAGE_TOO_LONG", "MESSAGE_FIELD"]) expect(KNOWN_REFUSALS[code]?.status).toBe(400)
        expect(KNOWN_REFUSALS.MESSAGE_CHANGED_SINCE?.status).toBe(409)
    })

    it("and the audit log names going back to Nizmo's message, in both languages", () => {
        expect(AUDIT_ACTIONS).toContain("UPDATE_CLIENT_MESSAGE")
        expect(AUDIT_ACTIONS).toContain("USE_NIZMO_CLIENT_MESSAGE")
        expect((en as Record<string, string>).audit_action_USE_NIZMO_CLIENT_MESSAGE).toBe("Went back to Nizmo's client message")
        expect((ar as Record<string, string>).audit_action_USE_NIZMO_CLIENT_MESSAGE).toBe("تمت العودة إلى رسالة Nizmo للعملاء")
    })
})

describe("a message put back to Nizmo's is kept, marked as Nizmo's (PR 348, Codex)", () => {
    const NAME = "20270114000000_client_message_uses_nizmo"
    const migration = () => source(`prisma/migrations/${NAME}/migration.sql`).split("\n").filter(line => !line.startsWith("--")).join("\n")

    it("by a migration that only adds a column, false for every row there is, and a check", () => {
        const statements = migration().split("\n").filter(line => /^[A-Z]/.test(line))
        expect(statements).toEqual([
            'ALTER TABLE "ClientMessageTemplate" ADD COLUMN "usesNizmo" BOOLEAN NOT NULL DEFAULT false;',
            'ALTER TABLE "ClientMessageTemplate" ADD CONSTRAINT "ClientMessageTemplate_usesNizmo" CHECK ("companyId" IS NOT NULL OR NOT "usesNizmo");',
        ])
    })

    it("which the schema's model has", () => {
        const model = source("prisma/schema.prisma").split("model ClientMessageTemplate {")[1].split("\n}")[0]
        expect(model).toMatch(/\n  usesNizmo\s+Boolean\s+@default\(false\)\n/)
    })
})

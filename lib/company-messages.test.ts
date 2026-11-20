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
import { nizmoMessageAgainSchema, nizmoMessagesAgainSchema, taxUpdateEmailsSchema } from "./validations/client-message.schema"
import { en } from "./translations/en"
import { ar } from "./translations/ar"

/**
 * A company's own copy of the client messages on WhatsApp, as it's kept and
 * checked (CLIENT_PORTAL_PLAN.md §7.1, §9, §12 step 10c-1; PR 348): the
 * permission it comes with, its routes, which company they're for, and what
 * they're refused with. The Client portal tab and the editor's page, step
 * 10c-2 (PR 349), are in lib/company-messages-tab.test.ts. Saving and going
 * back to Nizmo's are in lib/client-message-templates.db.test.ts. The update
 * email's switch (§4.4, step 11a; PR 350) is at the end, its service in
 * Postgres with the others.
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
        // Use Nizmo's message for every language at once (PR 349).
        expect(row).toContain("`DELETE /company-messages/[kind]`")
        // The update email's switch (PR 350).
        expect(row).toContain("`GET`, `PUT /company-messages/emails`")
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

describe("Use Nizmo's message, every language at once (§7.1; PR 349)", () => {
    const all = () => source("app/api/company-messages/[kind]/route.ts")

    it("has a route of its own, for whoever holds the permission, the gate holding it", () => {
        expect(moduleForApiPath("/api/company-messages/contact")).toBe("TAX_POSITION")
        expect(all()).toMatch(/export const DELETE = withStandardHandler\([\s\S]*?\{ permission: "client_messages\.manage" \}\)/)
        expect(all().match(/withStandardHandler\(/g)!.length).toBe(1)
        expect(all()).not.toMatch(/export const (GET|PUT|POST|PATCH) =/)
    })

    it("finds the company first, reads the message from the address, and puts back every language", () => {
        expect(all()).toMatch(/^[\s\S]*export const DELETE = withStandardHandler\(async \(req, session[^)]*\) => \{\s*const companyId = messagesCompanyId\(session\.user as any, new URL\(req\.url\)\.searchParams\.get\("companyId"\)\)\s*if \(!companyId\) return ApiResponse\.badRequest\("companyId is required"\)/)
        expect(all()).toContain("nizmoMessagesAgainSchema.safeParse({ ...json, kind: context.params.kind })")
        expect(all()).toContain("ApiResponse.success({ messages: await nizmoMessagesAgain(actorOf(session), companyId, validation.data) })")
    })

    it("says the time of each language's message the tab read, none where the company never changed it", () => {
        const since = { ar: "2026-11-20T10:00:00.000Z", en: null }
        expect(nizmoMessagesAgainSchema.safeParse({ kind: "contact", since }).success).toBe(true)
        expect(nizmoMessagesAgainSchema.safeParse({ kind: "claim", since: { ar: null, en: null } }).success).toBe(true)
        // Each language said, so one the tab didn't read can't be put back unseen.
        expect(nizmoMessagesAgainSchema.safeParse({ kind: "contact", since: { ar: null } }).success).toBe(false)
        expect(nizmoMessagesAgainSchema.safeParse({ kind: "contact", since: { en: null } }).success).toBe(false)
        expect(nizmoMessagesAgainSchema.safeParse({ kind: "contact" }).success).toBe(false)
        expect(nizmoMessagesAgainSchema.safeParse({ kind: "contact", since: { ar: "yesterday", en: null } }).success).toBe(false)
        expect(nizmoMessagesAgainSchema.safeParse({ kind: "other", since: { ar: null, en: null } }).success).toBe(false)
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

describe("the update email's switch (§4.4, step 11a; PR 350)", () => {
    const route = () => source("app/api/company-messages/emails/route.ts")
    const NAME = "20270115000000_company_tax_update_emails"
    const migration = () => source(`prisma/migrations/${NAME}/migration.sql`).split("\n").filter(line => !line.startsWith("--")).join("\n")

    it("has an address of its own that the client portal's gate holds", () => {
        expect(moduleForApiPath("/api/company-messages/emails")).toBe("TAX_POSITION")
    })

    it("is read and changed by whoever holds client_messages.manage, nothing else", () => {
        const handlers = route().split(/export const (?=GET|PUT)/).slice(1)
        expect(handlers.map(h => h.slice(0, 3))).toEqual(["GET", "PUT"])
        // Each handler, on its own, ends with the permission.
        for (const handler of handlers) expect(handler.trim()).toMatch(/\}, \{ permission: "client_messages\.manage" \}\)$/)
        expect(route().match(/withStandardHandler\(/g)!.length).toBe(2)
        expect(route()).not.toMatch(/export const (POST|PATCH|DELETE) =/)
    })

    it("finds the company first, as the messages' routes do, and says whether it's on", () => {
        for (const handler of route().split(/export const (?:GET|PUT) = /).slice(1)) {
            expect(handler).toMatch(/^withStandardHandler\(async \(req, session[^)]*\) => \{\s*const companyId = messagesCompanyId\(session\.user as any, new URL\(req\.url\)\.searchParams\.get\("companyId"\)\)\s*if \(!companyId\) return ApiResponse\.badRequest\("companyId is required"\)/)
        }
        expect(route()).toContain("ApiResponse.success({ on: await taxUpdateEmails(companyId) })")
        expect(route()).toContain("taxUpdateEmailsSchema.safeParse(json)")
        expect(route()).toContain("ApiResponse.success({ on: await setTaxUpdateEmails(actorOf(session), companyId, validation.data.on) })")
    })

    it("takes on or off, and nothing else", () => {
        expect(taxUpdateEmailsSchema.safeParse({ on: true }).success).toBe(true)
        expect(taxUpdateEmailsSchema.safeParse({ on: false }).success).toBe(true)
        expect(taxUpdateEmailsSchema.safeParse({}).success).toBe(false)
        expect(taxUpdateEmailsSchema.safeParse({ on: "true" }).success).toBe(false)
        expect(taxUpdateEmailsSchema.safeParse({ on: 1 }).success).toBe(false)
        expect(taxUpdateEmailsSchema.safeParse(null).success).toBe(false)
    })

    it("is kept on the company by a migration that only adds a column, off for every company there is", () => {
        const statements = migration().split("\n").filter(line => /^[A-Z]/.test(line))
        expect(statements).toEqual(['ALTER TABLE "Company" ADD COLUMN "taxUpdateEmails" BOOLEAN NOT NULL DEFAULT false;'])
        const model = source("prisma/schema.prisma").split("model Company {")[1].split("\n}")[0]
        expect(model).toMatch(/\n  taxUpdateEmails\s+Boolean\s+@default\(false\)\n/)
    })

    it("is named in the audit log, as the company's other switches are, in both languages", () => {
        expect((en as Record<string, string>).audit_field_taxUpdateEmails).toBe("Email when the tax position is updated")
        expect((ar as Record<string, string>).audit_field_taxUpdateEmails).toBe("بريد عند تحديث الموقف الضريبي")
    })
})

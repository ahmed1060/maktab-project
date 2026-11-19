import { describe, it, expect } from "vitest"
import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { knownRefusal } from "./api-errors"
import { AUDIT_ACTIONS } from "./audit-codes"
import {
    INVITATION_HOURS, INVITATION_PATH, invitationHash, invitationLink, newInvitation, portalOpen, sentInvitation, sentPassword,
} from "./client-invitation"
import { en } from "./translations/en"
import { ar } from "./translations/ar"

/**
 * The invitation's link, and setting a password from it (CLIENT_PORTAL_PLAN.md
 * §5.2, §12 step 6b-1; DESIGN.md §5.5, Setting a password from an invitation;
 * PR 324): what a link is, what's read of what's sent, when the office's
 * portal is open, the two routes, the page and its words. Reading a link and
 * setting the password against a real Postgres are in
 * lib/client-invitation.db.test.ts.
 */

const NOW = new Date("2026-11-19T09:00:00Z")

describe("a link", () => {
    it("has a secret of 32 random bytes, kept only as its SHA-256, for 72 hours", () => {
        const one = newInvitation(NOW)
        expect(one.token).toMatch(/^[A-Za-z0-9_-]{43}$/)
        expect(Buffer.from(one.token, "base64url")).toHaveLength(32)
        expect(one.tokenHash).toBe(createHash("sha256").update(one.token).digest("hex"))
        expect(one.tokenHash).not.toContain(one.token)
        expect(INVITATION_HOURS).toBe(72)
        expect(one.expiresAt.toISOString()).toBe("2026-11-22T09:00:00.000Z")
    })

    it("is a new secret each time", () => {
        const made = new Set(Array.from({ length: 50 }, () => newInvitation(NOW).token))
        expect(made.size).toBe(50)
    })

    it("is read only where it's one Nizmo could have made: anything else is no link", () => {
        const { token, tokenHash } = newInvitation(NOW)
        expect(invitationHash(token)).toBe(tokenHash)
        for (const bad of ["", "short", `${token}x`, token.slice(1), `${token.slice(0, 42)}=`, `${token.slice(0, 42)}/`, " ".repeat(43), 7, null, undefined, {}]) {
            expect(invitationHash(bad as never), String(bad)).toBeNull()
        }
    })

    it("carries its secret after a #, which the browser never sends to a server", () => {
        const { token } = newInvitation(NOW)
        expect(INVITATION_PATH).toBe("/invitation")
        expect(invitationLink("https://nizmo.example", token)).toBe(`https://nizmo.example/invitation#${token}`)
        const link = new URL(invitationLink("https://nizmo.example", token))
        expect(link.pathname + link.search).toBe("/invitation")
        expect(link.hash).toBe(`#${token}`)
    })
})

describe("what's sent", () => {
    const { token } = newInvitation(NOW)

    it("to read a link: the link's secret", () => {
        expect(sentInvitation({ token })).toEqual({ token })
        for (const body of [{}, { token: "" }, { token: 7 }, null, "x", { token: "nope" }]) expect(sentInvitation(body), JSON.stringify(body)).toEqual({ problem: "token" })
    })

    it("to set the password: the secret and the password twice, 12 to 72 characters, the same both times", () => {
        const password = "a-long-password-1"
        expect(sentPassword({ token, password, confirmPassword: password })).toEqual({ token, password })
        expect(sentPassword({ token: "nope", password, confirmPassword: password })).toEqual({ problem: "token" })
        expect(sentPassword({ token, password: "short-11-ch", confirmPassword: "short-11-ch" })).toEqual({ problem: "short" })
        expect(sentPassword({ token, password: "x".repeat(12), confirmPassword: "x".repeat(12) })).toEqual({ token, password: "x".repeat(12) })
        expect(sentPassword({ token, password: "x".repeat(72), confirmPassword: "x".repeat(72) })).toEqual({ token, password: "x".repeat(72) })
        expect(sentPassword({ token, password: "x".repeat(73), confirmPassword: "x".repeat(73) })).toEqual({ problem: "long" })
        expect(sentPassword({ token, password, confirmPassword: `${password}!` })).toEqual({ problem: "mismatch" })
        expect(sentPassword({ token, password: 123456789012, confirmPassword: 123456789012 })).toEqual({ problem: "short" })
    })

    it("keeps a password as it's typed: spaces are part of it", () => {
        expect(sentPassword({ token, password: "  twelve chars  ", confirmPassword: "  twelve chars  " })).toEqual({ token, password: "  twelve chars  " })
    })
})

describe("the office's portal is open to its client's people (§5.3)", () => {
    const portal = { hasCompanyManagement: true, hasClientPortal: true, hasHR: false }
    const paid = { createdAt: new Date("2026-01-01T00:00:00Z"), trialPreset: null, trialExtensionDays: 0, isBanned: false, package: portal, payments: [{ endDate: new Date("2026-12-31T00:00:00Z"), graceExtensionHours: 0 }] }
    const client = { archivedAt: null }

    it("where the client is in use, and the company's package has the client portal, paid and not barred", () => {
        expect(portalOpen(client, paid, NOW)).toBe(true)
    })

    it("and not where the client is archived", () => {
        expect(portalOpen({ archivedAt: new Date("2026-11-01T00:00:00Z") }, paid, NOW)).toBe(false)
    })

    it("nor where the package hasn't the add-on, or there's no package", () => {
        expect(portalOpen(client, { ...paid, package: { ...portal, hasClientPortal: false } }, NOW)).toBe(false)
        expect(portalOpen(client, { ...paid, package: null }, NOW)).toBe(false)
    })

    it("nor where the company's subscription has ended, or it's barred", () => {
        expect(portalOpen(client, { ...paid, payments: [{ endDate: new Date("2026-09-01T00:00:00Z"), graceExtensionHours: 0 }] }, NOW)).toBe(false)
        expect(portalOpen(client, { ...paid, isBanned: true }, NOW)).toBe(false)
    })
})

describe("what setting a password is refused with", () => {
    it("each says what it is, in words", () => {
        const refusals: Record<string, number> = {
            INVITATION_TOKEN_REQUIRED: 400,
            INVITATION_UNKNOWN: 404,
            INVITATION_EXPIRED: 409,
            INVITATION_CLOSED: 403,
            INVITATION_PASSWORD_SHORT: 400,
            INVITATION_PASSWORD_LONG: 400,
            INVITATION_PASSWORD_MISMATCH: 400,
        }
        for (const [code, status] of Object.entries(refusals)) {
            const refusal = knownRefusal(new Error(code))
            expect(refusal?.status, code).toBe(status)
            expect(refusal?.message, code).toMatch(/\.$/)
        }
    })

    it("and the audit log names it, in both languages", () => {
        expect(AUDIT_ACTIONS as readonly string[]).toContain("ACCEPT_CLIENT_INVITATION")
        for (const words of [en, ar] as Record<string, string>[]) expect(words.audit_action_ACCEPT_CLIENT_INVITATION).toBeTruthy()
    })
})

describe("the routes", () => {
    const read = () => readFileSync("app/api/invitation/route.ts", "utf8")
    const set = () => readFileSync("app/api/invitation/password/route.ts", "utf8")

    it("are open to anyone, as a link in an email has to be: no session is asked for", () => {
        for (const source of [read(), set()]) {
            expect(source).not.toContain("withStandardHandler")
            expect(source).not.toContain("getServerSession")
            expect(source).toMatch(/export async function POST\(/)
            expect(source).not.toMatch(/export (async )?function GET/)
        }
    })

    it("count each place's tries, 10 in 15 minutes, both routes together, before anything is read", () => {
        for (const source of [read(), set()]) {
            expect(source).toContain('RateLimiter.getLimitData(`invitation:${ip}`, 10, 15 * 60 * 1000)')
            const service = source.search(/await (readInvitation|setInvitationPassword)\(/)
            expect(service).toBeGreaterThan(0)
            expect(source.indexOf("getLimitData")).toBeLessThan(service)
            expect(source).toContain("resetHeldBack(resetAt)")
        }
    })

    it("answer a refusal with its code, and anything else with a reference, as the sign-in routes do", () => {
        for (const source of [read(), set()]) {
            expect(source).toContain("knownRefusal(error)")
            expect(source).toContain("AuditLogService.logSystemError")
            expect(source).toContain("isNextInternalError(error)")
        }
    })
})

describe("the page", () => {
    const page = () => readFileSync("app/(auth)/invitation/page.tsx", "utf8")

    it("is on the sign-in screen's frame, outside the app", () => {
        expect(page()).toContain("<SignInScreen")
        expect(page()).toMatch(/^'use client'/)
    })

    it("reads the secret from after the #, takes it out of the address bar, and sends it only in a request's body", () => {
        expect(page()).toContain("window.location.hash")
        expect(page()).toMatch(/history\.replaceState\(/)
        expect(page()).toMatch(/fetch\('\/api\/invitation', \{[^}]*method: 'POST'/)
        expect(page()).toMatch(/fetch\('\/api\/invitation\/password', \{[^}]*method: 'POST'/)
        // Never in an address.
        expect(page()).not.toMatch(/\?token=|invitation\/\$\{|searchParams/)
    })

    it("reads another link opened in its place, which the browser doesn't load as a new page", () => {
        expect(page()).toContain("window.addEventListener('hashchange', another)")
        expect(page()).toContain("window.removeEventListener('hashchange', another)")
    })

    it("asks for the password twice, each a new password the browser may offer to make", () => {
        expect(page().match(/<PasswordInput/g)).toHaveLength(2)
        expect(page().match(/autoComplete="new-password"/g)).toHaveLength(2)
        // The email the password goes with, for the browser's password manager.
        expect(page()).toMatch(/autoComplete="username"/)
    })

    it("has every word in both languages", () => {
        // Said with t(), or named in the page's maps of what to say when.
        const keys = [...new Set([...page().matchAll(/'(invitation_[a-z_]+)'/g)].map(m => m[1]))]
        expect(keys.length).toBeGreaterThan(10)
        for (const key of keys) {
            expect((en as Record<string, string>)[key], key).toBeTruthy()
            expect((ar as Record<string, string>)[key], key).toBeTruthy()
        }
    })

    it("says who invited them and for whom, keeping each name whole", () => {
        expect(en.invitation_from).toBe("{office} invited you to the tax position of {client}.")
        for (const words of [en, ar] as Record<string, string>[]) {
            expect(words.invitation_from).toContain("{office}")
            expect(words.invitation_from).toContain("{client}")
        }
        expect(page()).toMatch(/<bdi[ >]/)
    })

    it("says what's wrong with a link that can't be used, and that it works once, for 72 hours", () => {
        expect(en.invitation_once).toBe("This link works once, for 72 hours.")
        for (const key of ["invitation_expired_title", "invitation_unknown_title", "invitation_closed_title", "invitation_done_title"]) {
            expect((en as Record<string, string>)[key], key).toBeTruthy()
        }
        expect(en.invitation_closed_detail).toContain("contact the office")
    })

    it("speaks to the person without a masculine command in Arabic", () => {
        const arabic = Object.entries(ar).filter(([key]) => key.startsWith("invitation_")).map(([, words]) => words).join(" ")
        // Each a command to one man; a verbal noun, such as التواصل, is how the app asks.
        for (const masculine of [/(^|\s)أدخل/, /(^|\s)اكتب/, /(^|\s)اطلب/, /(^|\s)تواصل مع/, /(^|\s)سجّل الدخول/]) expect(arabic, String(masculine)).not.toMatch(masculine)
    })
})

describe("the migration", () => {
    const sql = () => readFileSync("prisma/migrations/20270107000000_client_invitations/migration.sql", "utf8")

    it("only adds: two columns, an index and two checks on client accounts", () => {
        const statements = sql().split("\n").filter(line => /^[A-Z]/.test(line))
        expect(statements).toEqual([
            'ALTER TABLE "ClientAccount" ADD COLUMN "inviteTokenHash" TEXT, ADD COLUMN "inviteExpiresAt" TIMESTAMP(3);',
            'CREATE UNIQUE INDEX "ClientAccount_inviteTokenHash_key" ON "ClientAccount"("inviteTokenHash");',
            'ALTER TABLE "ClientAccount" ADD CONSTRAINT "ClientAccount_invitation_whole" CHECK (("inviteTokenHash" IS NULL) = ("inviteExpiresAt" IS NULL));',
            'ALTER TABLE "ClientAccount" ADD CONSTRAINT "ClientAccount_active_not_invited" CHECK ("activatedAt" IS NULL OR "inviteTokenHash" IS NULL);',
        ])
    })

    it("is the schema's", () => {
        const schema = readFileSync("prisma/schema.prisma", "utf8")
        const model = schema.slice(schema.indexOf("model ClientAccount {"))
        const body = model.slice(0, model.indexOf("\n}"))
        expect(body).toMatch(/\n  inviteTokenHash\s+String\?\s+@unique/)
        expect(body).toMatch(/\n  inviteExpiresAt\s+DateTime\?/)
    })
})

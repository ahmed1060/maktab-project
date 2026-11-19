import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { clientPeopleUrl, personActions, personRefusal, personStatus } from "./client-people"

/**
 * People who can sign in, on a client's page (CLIENT_PORTAL_PLAN.md §5.2,
 * step 6c-1; DESIGN.md §5.5): what each person's row says, what its menu
 * offers, where the section sits and who sees it, and the privacy policy's
 * line that comes with it (§5.5).
 */
describe("a person's row", () => {
    const invited = { state: "invited" as const, invitedAt: "2026-11-17T09:00:00.000Z", lastSignInAt: null }
    const active = { state: "active" as const, invitedAt: "2026-11-01T09:00:00.000Z", lastSignInAt: "2026-11-18T10:30:00.000Z" }

    it("says they're invited, and since when, until their password is set", () => {
        expect(personStatus(invited)).toEqual({ kind: "invited", since: "2026-11-17T09:00:00.000Z" })
    })

    it("says when they last signed in once they're active", () => {
        expect(personStatus(active)).toEqual({ kind: "last", at: "2026-11-18T10:30:00.000Z" })
    })

    it("says they haven't signed in yet where their password is set and they haven't", () => {
        expect(personStatus({ ...active, lastSignInAt: null })).toEqual({ kind: "never" })
    })

    it("offers Resend invitation only to someone still invited, and Remove to everyone", () => {
        expect(personActions(invited)).toEqual(["resend", "remove"])
        expect(personActions(active)).toEqual(["remove"])
    })

    it("reads a client's people from the route that lists them", () => {
        expect(clientPeopleUrl("c 1&x")).toBe("/api/client-accounts?clientId=c%201%26x")
    })
})

describe("what a refusal says", () => {
    it("says nothing for the code prompt of a high-risk action, turned down: the prompt said what it needed", () => {
        expect(personRefusal(403, { code: "STEP_UP_REQUIRED" }, "add")).toBe("quiet")
        expect(personRefusal(403, { code: "MFA_ENROL_REQUIRED" }, "remove")).toBe("quiet")
    })

    it("says a name's or an email's mistake under its field", () => {
        expect(personRefusal(400, { code: "CLIENT_PERSON_NAME_REQUIRED" }, "add")).toEqual({ field: "name", key: "client_person_name_required" })
        expect(personRefusal(400, { code: "CLIENT_PERSON_NAME_TOO_LONG" }, "add")).toEqual({ field: "name", key: "client_person_name_too_long" })
        expect(personRefusal(400, { code: "CLIENT_PERSON_EMAIL_INVALID" }, "add")).toEqual({ field: "email", key: "client_person_email_invalid" })
        expect(personRefusal(409, { code: "CLIENT_PERSON_EMAIL_IN_USE" }, "add")).toEqual({ field: "email", key: "client_person_email_in_use" })
    })

    it("says the others in the page's language, as the server's words are English", () => {
        expect(personRefusal(409, { code: "CLIENT_PEOPLE_FULL" }, "add")).toEqual({ key: "client_people_full" })
        expect(personRefusal(400, { code: "CLIENT_ARCHIVED" }, "resend")).toEqual({ key: "client_people_archived" })
        expect(personRefusal(404, { code: "CLIENT_NOT_FOUND" }, "add")).toEqual({ key: "client_people_client_gone" })
        expect(personRefusal(404, { code: "CLIENT_PERSON_NOT_FOUND" }, "remove")).toEqual({ key: "client_person_gone" })
        expect(personRefusal(409, { code: "CLIENT_PERSON_ACTIVE" }, "resend")).toEqual({ key: "client_person_active" })
        expect(personRefusal(409, { code: "CLIENT_INVITATION_JUST_SENT" }, "resend")).toEqual({ key: "client_invitation_just_sent" })
    })

    it("says how long until an invitation sent 5 times in the hour can go again", () => {
        expect(personRefusal(429, { code: "TOO_MANY_TRIES", wait: 754 }, "resend")).toEqual({ key: "client_people_resend_wait", wait: 754 })
        // No time to give: as the server put it.
        expect(personRefusal(429, { code: "TOO_MANY_TRIES" }, "resend")).toBeNull()
    })

    it("says what didn't happen when the server failed, for each change", () => {
        expect(personRefusal(500, { error: "We couldn't complete that action." }, "add")).toEqual({ key: "client_person_not_sent" })
        expect(personRefusal(500, null, "resend")).toEqual({ key: "client_people_resend_not_sent" })
        expect(personRefusal(502, null, "remove")).toEqual({ key: "client_people_remove_failed" })
    })

    it("leaves one it doesn't know as the server put it", () => {
        expect(personRefusal(403, { code: "CLIENT_ACCOUNTS_MANAGE_REQUIRED", error: "You may not manage who signs in for a client." }, "add")).toBeNull()
        expect(personRefusal(400, { code: "toString" }, "add")).toBeNull()
        expect(personRefusal(400, null, "add")).toBeNull()
    })
})

describe("the section on a client's page", () => {
    const page = () => readFileSync("app/(dashboard)/dashboard/clients/[id]/page.tsx", "utf8")

    it("is for whoever may manage a client's people, where the package has the client portal", () => {
        expect(page()).toContain("const seesPeople = features.has('TAX_POSITION') && can('client_accounts.manage')")
        expect(page()).toMatch(/\{seesPeople && <ClientPeople key=\{`people-\$\{id\}`\} clientId=\{id\} archived=\{archived\} \/>\}/)
    })

    it("has a key of its own beside its neighbours, as two with one key are drawn over and over", () => {
        const keys = [...page().matchAll(/^\s*\{[^{}]*&& <[A-Z]\w* key=\{([^}]+)\}/gm)].map(m => m[1])
        expect(keys.length).toBeGreaterThanOrEqual(2)
        expect(new Set(keys).size).toBe(keys.length)
    })

    it("comes right after Tax position", () => {
        const source = page()
        const tax = source.indexOf("{seesTax && <TaxPosition")
        const people = source.indexOf("{seesPeople && <ClientPeople")
        expect(tax).toBeGreaterThan(0)
        expect(people).toBeGreaterThan(tax)
        expect(source.slice(tax, people).split("\n").filter(l => l.trim() && !l.trim().startsWith("{/*") && !l.trim().startsWith("*")).length).toBeLessThanOrEqual(2)
    })

    it("says when someone was invited or last signed in as the moment it was, not as a day", () => {
        const section = readFileSync("components/client-accounts/ClientPeople.tsx", "utf8")
        // formatDay reads "2026-11-19"; these are moments ("2026-11-19T09:00:00.000Z"), and it says Invalid Date for them.
        expect(section).toContain("const day = (iso: string) => formatMoment(iso, locale)")
        expect(section).not.toMatch(/\bformatDay\b/)
    })

    it("puts the focus on the first field that's wrong, said or refused (DESIGN.md §5.3)", () => {
        const dialog = readFileSync("components/client-accounts/AddClientPerson.tsx", "utf8")
        expect(dialog).toContain("if (missing.name || missing.email) { setErrors(missing); focusFirstWrong(form.current); return }")
        expect(dialog).toContain("if (refusal && refusal.field) focusFirstWrong(form.current)")
        expect(dialog).toContain('<form ref={form} id={formId}')
    })

    it("sends each change with its method, and asks before removing", () => {
        const section = readFileSync("components/client-accounts/ClientPeople.tsx", "utf8")
        expect(section).toContain("method: 'POST'")
        expect(section).toContain("method: 'DELETE'")
        expect(section).toContain("/invitation`, { method: 'POST' })")
        // Remove asks first, as a danger: its confirmation opens for the person picked, and removes them.
        expect(section).toMatch(/<ConfirmDialog\s+open=\{!!removing\}\s+danger\s[\s\S]*?onConfirm=\{remove\}/)
    })
})

describe("the privacy policy", () => {
    const privacy = () => readFileSync("app/(legal)/privacy/page.tsx", "utf8")

    it("says what's kept of a client's people the office invites, and that they're emailed", () => {
        const source = privacy()
        expect(source).toContain("<dt>A client&rsquo;s people</dt>")
        expect(source).toMatch(/name and email address[\s\S]*invitation[\s\S]*tax position/)
        expect(source).toContain("invitations to a client&rsquo;s people")
    })
})

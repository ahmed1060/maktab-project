import { beforeEach, describe, it, expect, vi } from "vitest"
import { createElement as h } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { readFileSync } from "node:fs"
import { ar } from "./translations/ar"
import { en } from "./translations/en"
import { permissionsOf } from "@/lib/useCan"
import { withGrants } from "@/lib/permissions/test-actors"
import { profileAccess } from "@/lib/profile-access"
import type { Module } from "@/lib/features/bundles"

/**
 * A person's WhatsApp number, for their clients (CLIENT_PORTAL_PLAN.md §7,
 * §12 step 9a; DESIGN.md §5.5; PR 340), as the owner's mockup draws it: a
 * card of its own on their profile's form, Contacting clients, with its own
 * Save, where the company's package has the client portal.
 */

const state = { locale: "en" as "en" | "ar" }
const words = () => (state.locale === "ar" ? ar : en) as Record<string, string>
vi.mock("@/context/LanguageContext", () => ({ useLanguage: () => ({ locale: state.locale, t: (key: string) => words()[key] ?? key }) }))
vi.mock("@/context/ToastContext", () => ({ useToast: () => ({ showToast: () => {} }) }))
beforeEach(() => { state.locale = "en" })

const esc = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/'/g, "&#x27;").replace(/"/g, "&quot;")
const CSS = readFileSync("components/ui/ui.css", "utf8")
const rule = (selector: string) => CSS.match(new RegExp(`(?:^|\\n)${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} \\{([^}]*)\\}`))?.[1] ?? ""
const FORM = readFileSync("components/EmployeeProfileForm.tsx", "utf8")
const USERS = readFileSync("app/api/users/route.ts", "utf8")

async function card(saved: string | null = "+201001234567", clients: string[] = ["Al Noor", "Delta Foods"]) {
    const { WhatsAppCard } = await import("@/components/profile/WhatsAppCard")
    return renderToStaticMarkup(h(WhatsAppCard, { userId: "u1", saved, clients }))
}

describe("the card, Contacting clients", () => {
    it("is a card of its own, titled Contacting clients", async () => {
        const html = await card()
        expect(html).toMatch(/^<section class="ui-panel ui-card[^"]*"><div class="ui-card-head"><h2 class="ui-card-title">Contacting clients<\/h2><\/div>/)
        state.locale = "ar"
        expect(await card()).toContain('<h2 class="ui-card-title">التواصل مع العملاء</h2>')
    })

    it("has one field, WhatsApp number, left to right in either language, with its hint under it", async () => {
        const html = await card()
        const label = html.match(/<label for="([^"]+)" class="ui-label">WhatsApp number<\/label>/)
        expect(label).not.toBeNull()
        const input = html.match(/<input [^>]*>/)?.[0] ?? ""
        expect(input).toContain(`id="${label![1]}"`)
        expect(input).toContain('name="whatsappNumber"')
        expect(input).toContain('type="tel"')
        expect(input).toContain('inputMode="tel"')
        expect(input).toContain('autoComplete="tel"')
        expect(input).toContain('dir="ltr"')
        expect(input).toContain('spellCheck="false"')
        expect(input).toContain('value="+201001234567"')
        // Its hint, which a screen reader hears with it.
        const hint = html.match(/<span id="([^"]+)" class="ui-hint">(.*?)<\/span>/)
        expect(hint?.[2]).toBe(esc(en.profile_whatsapp_hint))
        expect(input).toContain(`aria-describedby="${hint![1]}"`)
        state.locale = "ar"
        const arabic = await card()
        expect(arabic).toContain(">رقم واتساب</label>")
        expect(arabic.match(/<input [^>]*>/)?.[0]).toContain('dir="ltr"')
    })

    it("is empty where there's no number", async () => {
        expect((await card(null)).match(/<input [^>]*>/)?.[0]).toContain('value=""')
    })

    it("says, under the field, who writes to it, the clients they answer for, and what happens without one", async () => {
        const html = await card()
        const note = html.match(/<div class="ui-whatsapp-note">(.*?)<\/div>/)?.[1] ?? ""
        expect(note).toBe(`<p>${esc(en.profile_whatsapp_note)}</p><p class="ui-whatsapp-note-clients"><bdi>Al Noor</bdi>, <bdi>Delta Foods</bdi></p><p class="ui-whatsapp-note-none">${esc(en.profile_whatsapp_none)}</p>`)
        expect(html.indexOf("ui-whatsapp-note")).toBeGreaterThan(html.indexOf("<input"))
        state.locale = "ar"
        expect(await card()).toContain('<p class="ui-whatsapp-note-clients"><bdi>Al Noor</bdi>، <bdi>Delta Foods</bdi></p>')
    })

    it("says so where it's no client's responsible accountant yet (PR 343)", async () => {
        const note = (await card("+201001234567", [])).match(/<div class="ui-whatsapp-note">(.*?)<\/div>/)?.[1] ?? ""
        expect(note).toBe(`<p>${esc(en.profile_whatsapp_no_clients)}</p><p class="ui-whatsapp-note-none">${esc(en.profile_whatsapp_none)}</p>`)
    })

    it("has its own Save, under the note", async () => {
        const html = await card()
        expect(html).toMatch(/<form [^>]*novalidate=""[^>]*class="ui-form"|<form [^>]*class="ui-form"[^>]*novalidate=""|<form novalidate="" class="ui-form"/i)
        const save = html.match(/<button [^>]*type="submit"[^>]*>(.*?)<\/button>/)
        expect(save?.[1]).toContain(en.save)
        expect(html.indexOf(save![0])).toBeGreaterThan(html.indexOf("ui-whatsapp-note"))
    })
})

describe("its look", () => {
    it("the note in a box on --page, in --text-sm and --ink-2, its last line --muted", () => {
        const note = rule(".ui-whatsapp-note")
        expect(note).toMatch(/background:\s*var\(--page\);/)
        expect(note).toMatch(/color:\s*var\(--ink-2\);/)
        expect(note).toMatch(/border-radius:\s*var\(--radius-field\);/)
        expect(note).toMatch(/padding:\s*var\(--space-3\) var\(--space-4\);/)
        expect(note).toMatch(/font-size:\s*var\(--text-sm\);/)
        // Its lines one under the other, apart, as the mockup's.
        expect(note).toMatch(/display:\s*flex;/)
        expect(note).toMatch(/flex-direction:\s*column;/)
        expect(note).toMatch(/gap:\s*var\(--space-2\);/)
        expect(rule(".ui-whatsapp-note p")).toMatch(/margin:\s*0;/)
        expect(rule(".ui-whatsapp-note-none")).toMatch(/color:\s*var\(--muted\);/)
        // The clients, named in weight 600, as the mockup draws them (PR 343).
        expect(rule(".ui-whatsapp-note-clients")).toMatch(/font-weight:\s*600;/)
        expect(rule(".ui-whatsapp-note-clients")).toMatch(/color:\s*var\(--ink\);/)
        // A client's name too long for a phone's width breaks rather than pushing past the card.
        expect(rule(".ui-whatsapp-note-clients")).toMatch(/overflow-wrap:\s*anywhere;/)
    })
})

describe("on the profile", () => {
    const ADMIN = withGrants({ role: "ADMIN", id: "admin", companyId: "c1" })
    const EMPLOYEE = withGrants({ role: "EMPLOYEE", id: "emp", companyId: "c1" })
    const SUPER = { role: "SUPER_ADMIN", id: "sa", companyId: null }
    type Viewer = { role: string; id: string; companyId: string | null; grants?: string }
    const everything = () => true
    const without = (...left: Module[]) => (module: Module) => !left.includes(module)
    const access = (viewer: Viewer, person: { id: string; role: string }, has: (module: Module) => boolean = everything) =>
        profileAccess({ can: permissionsOf(viewer).can, viewer, person, has })

    it("is on one's own and for whoever may edit theirs, where the package has the client portal", () => {
        expect(access(EMPLOYEE, { id: "emp", role: "EMPLOYEE" }).whatsapp).toBe(true)
        expect(access(ADMIN, { id: "p1", role: "EMPLOYEE" }).whatsapp).toBe(true)
        expect(access(ADMIN, { id: "admin", role: "ADMIN" }).whatsapp).toBe(true)
        expect(access(SUPER, { id: "p1", role: "ADMIN" }).whatsapp).toBe(true)
        // Not for whoever may only see them, nor a company's Admin on another Admin's (§4.2, rule 7).
        expect(access(EMPLOYEE, { id: "p1", role: "EMPLOYEE" }).whatsapp).toBe(false)
        expect(access(ADMIN, { id: "p2", role: "ADMIN" }).whatsapp).toBe(false)
        // Nor where the package hasn't the client portal.
        expect(access(EMPLOYEE, { id: "emp", role: "EMPLOYEE" }, without("TAX_POSITION")).whatsapp).toBe(false)
        expect(access(ADMIN, { id: "p1", role: "EMPLOYEE" }, without("TAX_POSITION")).whatsapp).toBe(false)
    })

    it("is never on a Super Admin's, who answers for no client, nor before their role is known", () => {
        expect(access(SUPER, { id: "sa", role: "SUPER_ADMIN" }).whatsapp).toBe(false)
        expect(access(SUPER, { id: "s2", role: "SUPER_ADMIN" }).whatsapp).toBe(false)
        expect(access(ADMIN, { id: "p1", role: "" }).whatsapp).toBe(false)
    })

    it("comes under the profile's own card, with the number it was loaded with", () => {
        expect(FORM).toMatch(/\{access\.whatsapp && <WhatsAppCard userId=\{userId\} saved=\{whatsappNumber\} clients=\{accountantFor\} \/>\}/)
        expect(FORM.indexOf("<WhatsAppCard")).toBeGreaterThan(FORM.indexOf("cancelHref={`/dashboard/employees/${userId}?mode=view`}"))
        expect(FORM).toContain("setWhatsappNumber(employee.whatsappNumber ?? null)")
        expect(FORM).toContain("setAccountantFor(employee.accountantFor ?? [])")
    })

    it("names the clients they answer for to whoever sees the card, where the package has the client portal (PR 343)", () => {
        expect(USERS).toContain(`const answers = (userId === session.user.id || can(session.user, "employees.edit")) && sessionHasModule(session, "TAX_POSITION")`)
        expect(USERS).toContain("...(answers ? { accountantFor: await clientsAnsweredFor(user.id) } : {})")
    })

    it("is read with the person, and its refusals answered with their codes", () => {
        expect(USERS).toMatch(/whatsappNumber: true/)
        expect(USERS).toContain(`if (error.message === 'WHATSAPP_NUMBER_INVALID') return ApiResponse.refused(400, WHATSAPP_NUMBER_INVALID, 'WHATSAPP_NUMBER_INVALID')`)
        expect(USERS).toContain(`if (error.message === 'NOT_IN_PACKAGE') return ApiResponse.refused(403, WHATSAPP_NOT_IN_PACKAGE, 'NOT_IN_PACKAGE')`)
    })
})

describe("its words", () => {
    const KEYS = ["profile_whatsapp_title", "profile_whatsapp_label", "profile_whatsapp_hint", "profile_whatsapp_note", "profile_whatsapp_no_clients", "profile_whatsapp_none", "profile_whatsapp_invalid", "profile_whatsapp_saved", "audit_field_whatsappNumber"] as const

    it("in both languages", () => {
        for (const key of KEYS) {
            expect((en as Record<string, string>)[key], key).toBeTruthy()
            expect((ar as Record<string, string>)[key], key).toBeTruthy()
        }
        expect(en.profile_whatsapp_title).toBe("Contacting clients")
        expect(ar.profile_whatsapp_title).toBe("التواصل مع العملاء")
        expect(en.profile_whatsapp_label).toBe("WhatsApp number")
        expect(ar.profile_whatsapp_label).toBe("رقم واتساب")
        expect(ar.profile_whatsapp_hint).toBe("رقم مصري يبدأ بـ01، أو برمز الدولة (+). يمكن تركه فارغًا.")
        // Followed by the clients, as the mockup has it (PR 343).
        expect(en.profile_whatsapp_note).toBe("The people of the clients this account is the responsible accountant for write to this number:")
        expect(ar.profile_whatsapp_note).toBe("على هذا الرقم يكتب أشخاص العملاء الذين يكون هذا الحساب محاسبهم المسؤول:")
        expect(en.profile_whatsapp_no_clients).toBe("No client has this account as their responsible accountant yet. Once one does, its people write to this number.")
        expect(ar.profile_whatsapp_no_clients).toBe("لم يُختر هذا الحساب محاسبًا مسؤولًا لأي عميل بعد. وعند اختياره، يكتب أشخاص العميل على هذا الرقم.")
        expect(ar.profile_whatsapp_none).toBe("بدون رقم، لا يظهر لهم زر التواصل.")
    })

    it("the mistake says what to type, in the neutral Arabic the app uses", () => {
        expect(en.profile_whatsapp_invalid).toBe("Type an Egyptian mobile starting 01, or the number with its country code (+).")
        expect(ar.profile_whatsapp_invalid).toBe("يُرجى كتابة رقم مصري يبدأ بـ01، أو الرقم برمز الدولة (+).")
    })
})

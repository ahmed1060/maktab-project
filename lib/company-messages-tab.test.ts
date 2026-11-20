import { describe, it, expect, vi } from "vitest"
import { createElement as h } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { readFileSync } from "node:fs"
import { ar } from "./translations/ar"
import { en } from "./translations/en"
import { stripComments } from "./strip-comments"
import { moduleForPagePath } from "./features/routes"
import { NIZMO_MESSAGES } from "./client-message-template"
import { sampleMessage } from "./contact-message"
import { MESSAGE_NAME, clientPortalTabHref, companyMessageApi, companyMessageHref, companyMessagesApi, isMessageKind, nizmoAgainApi, ownLanguages, putBackSince, taxEmailsApi } from "./client-message-pages"

/**
 * A company's client messages on WhatsApp (CLIENT_PORTAL_PLAN.md §7.1, §12
 * step 10c-2; DESIGN.md §5.5, A company's client messages; PR 349): the
 * Client portal tab in Company settings, as the owner's mockup draws it
 * (Company messages), and the message's editor on a page of its own, the
 * Super Admin's editor for that one message. The tab's second card, the
 * update email's switch (§4.4, step 11a; PR 350), is at the end. Who sees the tab is in
 * lib/company-settings-access.test.ts; the routes are in
 * lib/company-messages.test.ts.
 */

type Loaded = { data?: unknown; error?: unknown; isValidating?: boolean }
const state = {
    locale: "en" as "en" | "ar",
    role: "ADMIN",
    swr: {} as Record<string, Loaded>,
    keys: [] as (string | null)[],
}

vi.mock("next-auth/react", () => ({ useSession: () => ({ data: { user: { id: "u1", role: state.role, companyId: state.role === "SUPER_ADMIN" ? null : "c1", name: "Amal One" } }, status: "authenticated" }) }))
vi.mock("@/context/LanguageContext", () => ({
    useLanguage: () => ({ locale: state.locale, t: (key: string) => (state.locale === "ar" ? ar : en)[key as keyof typeof en] ?? key }),
}))
vi.mock("@/context/ToastContext", () => ({ useToast: () => ({ showToast: () => {} }) }))
vi.mock("next/navigation", () => ({
    useRouter: () => ({ push: () => {}, replace: () => {} }),
    usePathname: () => "/dashboard/settings",
}))
vi.mock("@/lib/useHydrated", () => ({ useHydrated: () => true }))
vi.mock("react-dom", async (importOriginal) => ({ ...(await importOriginal<typeof import("react-dom")>()), createPortal: (node: unknown) => node }))
vi.mock("swr", () => ({
    default: (key: string | null) => {
        state.keys.push(key)
        return { data: undefined, error: undefined, isValidating: false, mutate: async () => {}, ...(key ? state.swr[key] : {}) }
    },
}))

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/'/g, "&#x27;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
const ok = (data: unknown) => ({ data: { data } })
const failed = { error: Object.assign(new Error("x"), { status: 403, info: { error: "This company's package doesn't include the client portal.", code: "CLIENT_PORTAL_NOT_IN_PACKAGE" } }) }
const AT = "2026-11-17T09:30:00.000Z"
type Kind = "contact" | "claim"
type Lang = "ar" | "en"
const nizmo = (kind: Kind, language: Lang) => ({ kind, language, text: NIZMO_MESSAGES[kind][language], own: false, changedBy: null, changedAt: null })
const own = (kind: Kind, language: Lang, text: string) => ({ kind, language, text, own: true, changedBy: "Amal One", changedAt: AT })
const NIZMOS = [nizmo("contact", "ar"), nizmo("contact", "en"), nizmo("claim", "ar"), nizmo("claim", "en")]
/** Contact the accountant's Arabic is the company's own; the rest Nizmo's. */
const OWN_AR = [own("contact", "ar", "مرحبًا، أنا {person} من {client}."), ...NIZMOS.slice(1)]
const OWN_BOTH = [own("contact", "ar", "مرحبًا {person}"), own("contact", "en", "Hi {person}"), ...NIZMOS.slice(2)]

function rendered(component: unknown, props: Record<string, unknown>, swr: Record<string, Loaded>, { locale = "en", role = "ADMIN" }: { locale?: "en" | "ar"; role?: string } = {}) {
    Object.assign(state, { swr, locale, role, keys: [] })
    vi.stubGlobal("document", { body: {} })
    try {
        return renderToStaticMarkup(h(component as never, props))
    } finally {
        vi.unstubAllGlobals()
    }
}
async function card(swr: Record<string, Loaded>, options: { locale?: "en" | "ar"; superAdmin?: boolean } = {}) {
    const { default: CompanyMessagesCard } = await import("@/components/client-messages/CompanyMessagesCard")
    return rendered(CompanyMessagesCard, { companyId: "c1", superAdmin: !!options.superAdmin }, swr, { locale: options.locale, role: options.superAdmin ? "SUPER_ADMIN" : "ADMIN" })
}
/** The editor's page as its server page hands it over: for the company's own people, or the Super Admin's for the company named. */
async function ownPage(swr: Record<string, Loaded>, kind: string, options: { locale?: "en" | "ar"; role?: string } = {}) {
    const { default: CompanyMessagePage } = await import("@/components/client-messages/CompanyMessagePage")
    return rendered(CompanyMessagePage, { kind }, swr, options)
}
async function superAdminPage(swr: Record<string, Loaded>, kind: string, options: { locale?: "en" | "ar"; role?: string } = {}) {
    const { default: CompanyMessagePage } = await import("@/components/client-messages/CompanyMessagePage")
    return rendered(CompanyMessagePage, { kind, companyId: "c1" }, swr, { role: "SUPER_ADMIN", ...options })
}
const between = (html: string, from: string, to: string) => {
    const start = html.indexOf(from)
    expect([from, start >= 0]).toEqual([from, true])
    const end = html.indexOf(to, start + from.length)
    return html.slice(start, end < 0 ? undefined : end + to.length)
}
/** Each row of the card's list, as drawn. */
const rows = (html: string) => between(html, '<ul class="ui-rows ui-cmsg-rows"', "</ul>").split("<li").slice(1)
/** The link or button named this, as drawn. */
const named = (html: string, name: string) => html.match(new RegExp(`<(a|button)\\b[^>]*aria-label="${esc(name).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"[^>]*>[^<]*</(a|button)>`))?.[0]
const source = (file: string) => stripComments(readFileSync(file, "utf8"))
const CARD = "components/client-messages/CompanyMessagesCard.tsx"
const EDITOR = "components/client-messages/MessageEditor.tsx"
const COMPANY_PAGE = "components/client-messages/CompanyMessagePage.tsx"

describe("where they're asked for and found", () => {
    it("the company's messages, its own for its people, the one named for the Super Admin", () => {
        expect(companyMessagesApi(null)).toBe("/api/company-messages")
        expect(companyMessagesApi("c 1")).toBe("/api/company-messages?companyId=c%201")
        expect(companyMessageApi(null, "contact", "ar")).toBe("/api/company-messages/contact/ar")
        expect(companyMessageApi("c1", "claim", "en")).toBe("/api/company-messages/claim/en?companyId=c1")
        expect(nizmoAgainApi(null, "claim")).toBe("/api/company-messages/claim")
        expect(nizmoAgainApi("c1", "contact")).toBe("/api/company-messages/contact?companyId=c1")
    })

    it("the editor's page for each, and the tab it goes back to, on the company's settings or the Super Admin's", () => {
        expect(companyMessageHref("c1", false, "contact")).toBe("/dashboard/settings/client-messages/contact")
        expect(companyMessageHref("c1", true, "claim")).toBe("/dashboard/companies/c1/settings/client-messages/claim")
        expect(clientPortalTabHref("c1", false)).toBe("/dashboard/settings?tab=client_portal")
        expect(clientPortalTabHref("c 1", true)).toBe("/dashboard/companies/c%201/settings?tab=client_portal")
    })

    it("the company's editor page is the client portal's, which the package's gate holds", () => {
        expect(moduleForPagePath("/dashboard/settings/client-messages/contact")).toBe("TAX_POSITION")
        expect(moduleForPagePath("/dashboard/settings")).toBeNull()
    })

    it("each message named as the client's page names its button", () => {
        expect(MESSAGE_NAME).toEqual({ contact: "portal_contact_accountant", claim: "contact_about_claim" })
    })
})

describe("Use Nizmo's message, from what the tab read (§7.1)", () => {
    it("puts back the languages the company changed, Arabic first", () => {
        expect(ownLanguages(OWN_BOTH, "contact")).toEqual(["ar", "en"])
        expect(ownLanguages(OWN_AR, "contact")).toEqual(["ar"])
        expect(ownLanguages(OWN_AR, "claim")).toEqual([])
    })

    it("saying the time of each language's message as read, none where the company never changed it", () => {
        expect(putBackSince(OWN_AR, "contact")).toEqual({ ar: AT, en: null })
        const putBack = { ...nizmo("claim", "en"), changedBy: "Hana Saad", changedAt: "2026-11-18T08:00:00.000Z" }
        expect(putBackSince([...NIZMOS.slice(0, 3), putBack], "claim")).toEqual({ ar: null, en: "2026-11-18T08:00:00.000Z" })
    })
})

describe("the Client portal tab's card", () => {
    it("is titled as the mockup titles it, with a line on what the messages are", async () => {
        for (const locale of ["en", "ar"] as const) {
            const html = await card({ [companyMessagesApi(null)]: ok({ messages: NIZMOS }) }, { locale })
            const words = locale === "ar" ? ar : en
            expect(html).toContain(`<div class="ui-card-heading"><h2 class="ui-card-title">${words.cmsg_title}</h2><p class="ui-card-subtitle">${esc(words.cmsg_company_line)}</p></div>`)
        }
        expect(ar.cmsg_title).toBe("رسائل العملاء على واتساب")
        expect(ar.cmsg_company_line).toBe("الرسالة التي تُكتب لشخص العميل عند التواصل مع المحاسب.")
    })

    it("asks for its own company's messages, or the Super Admin's company's", async () => {
        await card({})
        expect(state.keys).toContain("/api/company-messages")
        await card({}, { superAdmin: true })
        expect(state.keys).toContain("/api/company-messages?companyId=c1")
    })

    it("says while they load, and when they didn't, with the server's words and Try again", async () => {
        const loading = await card({})
        expect(loading).toContain('<div role="status">')
        expect(loading).toContain(en.loading)
        const html = await card({ [companyMessagesApi(null)]: failed })
        expect(html).toContain(esc(en.cmsg_load_failed))
        expect(html).toContain(esc("This company's package doesn't include the client portal."))
        expect(html).toContain(`>${en.try_again}</button>`)
    })

    it("a row for each message, Contact the accountant first, a line for each language under its name, Arabic first", async () => {
        const html = await card({ [companyMessagesApi(null)]: ok({ messages: NIZMOS }) })
        const [contact, claim] = rows(html)
        expect(rows(html)).toHaveLength(2)
        expect(between(html, '<ul class="ui-rows ui-cmsg-rows"', ">")).toContain(`aria-label="${en.cmsg_title}"`)
        expect(contact).toContain(`<span class="ui-item-title">${en.portal_contact_accountant}</span>`)
        expect(claim).toContain(`<span class="ui-item-title">${en.contact_about_claim}</span>`)
        for (const row of [contact, claim]) {
            expect(row).toContain(`<span class="ui-item-note">${esc(en.cmsg_company_uses_nizmo.replace("{language}", en.audit_value_AR))}</span>`
                + `<span class="ui-item-note">${esc(en.cmsg_company_uses_nizmo.replace("{language}", en.audit_value_EN))}</span>`)
        }
    })

    it("the company's copy says who changed it last and the day, in the page's words and digits", async () => {
        const html = await card({ [companyMessagesApi(null)]: ok({ messages: OWN_AR }) }, { locale: "ar" })
        const [contact] = rows(html)
        expect(contact).toContain(`<span class="ui-item-note">${esc(ar.cmsg_company_own.replace("{language}", "العربية").replace("{name}", "Amal One").replace("{date}", "١٧ نوفمبر ٢٠٢٦"))}</span>`
            + `<span class="ui-item-note">${esc(ar.cmsg_company_uses_nizmo.replace("{language}", "الإنجليزية"))}</span>`)
        expect(ar.cmsg_company_own).toBe("{language}: نسخة الشركة، آخر تغيير من {name} يوم {date}")
        expect(ar.cmsg_company_uses_nizmo).toBe("{language}: تستخدم رسالة Nizmo")
    })

    it("Change it for this company while both use Nizmo's; Edit and Use Nizmo's message while either is the company's, each named for its message", async () => {
        const html = await card({ [companyMessagesApi(null)]: ok({ messages: OWN_AR }) })
        const [contact, claim] = rows(html)
        const edit = named(contact, `Edit ${en.portal_contact_accountant}`)
        expect(edit).toMatch(/^<a\b/)
        expect(edit).toContain('href="/dashboard/settings/client-messages/contact"')
        expect(edit).toContain(`>${en.edit}</a>`)
        const back = named(contact, `Use Nizmo's message for ${en.portal_contact_accountant}`)
        expect(back).toMatch(/^<button type="button"/)
        expect(back).toContain(`>${esc(en.cmsg_use_nizmo)}</button>`)
        expect(named(contact, `Change it for this company: ${en.portal_contact_accountant}`)).toBeUndefined()

        const change = named(claim, `Change it for this company: ${en.contact_about_claim}`)
        expect(change).toContain('href="/dashboard/settings/client-messages/claim"')
        expect(change).toContain(`>${en.cmsg_change_for_company}</a>`)
        expect(named(claim, `Edit ${en.contact_about_claim}`)).toBeUndefined()
        expect(named(claim, `Use Nizmo's message for ${en.contact_about_claim}`)).toBeUndefined()
        expect(ar.cmsg_change_for_company).toBe("تغييرها لهذه الشركة")
        // Each button's name starts with the words it shows, so it can be asked for by them (WCAG 2.5.3).
        for (const words of [en, ar]) {
            expect(words.cmsg_change_for_company_named.startsWith(words.cmsg_change_for_company)).toBe(true)
            expect(words.cmsg_edit_named.startsWith(words.edit)).toBe(true)
            expect(words.cmsg_use_nizmo_named.startsWith(words.cmsg_use_nizmo)).toBe(true)
        }
        expect(ar.cmsg_use_nizmo).toBe("استخدام رسالة Nizmo")
    })

    it("goes to the Super Admin's editor page from the Super Admin's tab", async () => {
        const html = await card({ [companyMessagesApi("c1")]: ok({ messages: OWN_AR }) }, { superAdmin: true })
        expect(named(html, `Edit ${en.portal_contact_accountant}`)).toContain('href="/dashboard/companies/c1/settings/client-messages/contact"')
        expect(named(html, `Change it for this company: ${en.contact_about_claim}`)).toContain('href="/dashboard/companies/c1/settings/client-messages/claim"')
    })

    it("says under the rows that Edit opens the Super Admin's editor, as the mockup says it", async () => {
        const html = await card({ [companyMessagesApi(null)]: ok({ messages: NIZMOS }) }, { locale: "ar" })
        expect(html).toContain(`</ul><p class="ui-cmsg-foot">${ar.cmsg_company_foot}</p>`)
        expect(ar.cmsg_company_foot).toBe("التعديل يفتح نفس المحرر الذي يستخدمه مدير النظام، بالحقول والمعاينة.")
    })

    it("asks before Use Nizmo's message, in the danger colour, naming the languages, then puts them back at once from what it read", () => {
        const card = source(CARD)
        expect(card).toMatch(/<ConfirmDialog\s+open=\{!!backing\}\s+danger\s+title=\{t\('cmsg_use_nizmo_title'\)/)
        expect(card).toContain("t('cmsg_use_nizmo_body').replace('{languages}', t(LANGUAGES_KEY[languagesOf(backing)]))")
        expect(card).toContain("fetch(nizmoAgainApi(scope, kind), {")
        expect(card).toContain("method: 'DELETE'")
        expect(card).toContain("body: JSON.stringify({ since: putBackSince(messages, kind) })")
        expect(en.cmsg_use_nizmo_body).toBe("Nizmo's message replaces the company's copy in {languages}, and follows the Super Admin's later changes.")
        expect([en.cmsg_in_ar, en.cmsg_in_en, en.cmsg_in_both]).toEqual(["Arabic", "English", "Arabic and English"])
        expect([ar.cmsg_in_ar, ar.cmsg_in_en, ar.cmsg_in_both]).toEqual(["بالعربية", "بالإنجليزية", "بالعربية والإنجليزية"])
    })

    it("a put back refused as changed since reads the messages again and says so", () => {
        const card = source(CARD)
        expect(card).toMatch(/if \(body\?\.code === 'MESSAGE_CHANGED_SINCE'\) \{\s*await mutate\(\)\s*showToast\(t\('cmsg_company_changed'\), 'error'\)\s*return\s*\}/)
    })

    it("is the Client portal tab's, whoever opens it, whatever settings.edit says", () => {
        const tabs = source("components/CompanySettingsTabs.tsx")
        expect(tabs).toMatch(/\{tab === 'client_portal' && <>\s*<CompanyMessagesCard companyId=\{companyId\} superAdmin=\{superAdmin\} \/>/)
        expect(en.settings_tab_client_portal).toBe("Client portal")
        expect(ar.settings_tab_client_portal).toBe("بوابة العملاء")
    })
})

describe("the message's editor, on a page of its own", () => {
    it("for the company's people: back to the Client portal tab, titled by the message, saying whose copy it changes", async () => {
        const html = await ownPage({ [companyMessagesApi(null)]: ok({ messages: OWN_AR }) }, "contact")
        expect(html).toMatch(new RegExp(`<a [^>]*href="/dashboard/settings\\?tab=client_portal"[^>]*>.*${en.settings_tab_client_portal}</a>`))
        expect(html).toContain(`<h1 class="ui-page-title">${en.portal_contact_accountant}</h1>`)
        expect(html).toContain(`<p class="ui-page-subtitle">${esc(en.cmsg_company_page_hint)}</p>`)
        expect(state.keys).toContain("/api/company-messages")
    })

    it("no tabs: the one message, with the switch between Arabic and English, and its preview", async () => {
        const html = await ownPage({ [companyMessagesApi(null)]: ok({ messages: OWN_AR }) }, "claim")
        expect(html).not.toContain('role="tablist"')
        expect(html).toContain(`<div role="group" aria-label="${en.cmsg_language}" class="ui-segmented" dir="ltr">`)
        expect(html).toContain(`<div class="ui-chat"><p class="ui-chat-bubble" lang="en" dir="ltr">${esc(sampleMessage("claim", "en", NIZMO_MESSAGES.claim.en))}</p></div>`)
        expect(html).toContain('<div class="ui-cmsg-panel">')
    })

    it("under the buttons: Nizmo's message, saving makes the company's own copy, or the company's copy by who changed it and when", async () => {
        const nizmos = await ownPage({ [companyMessagesApi(null)]: ok({ messages: OWN_AR }) }, "contact")
        expect(nizmos).toContain(`<span class="ui-fieldtext-note">${esc(en.cmsg_company_nizmo_note)}</span>`)
        const mine = await ownPage({ [companyMessagesApi(null)]: ok({ messages: OWN_AR }) }, "contact", { locale: "ar" })
        expect(mine).toContain(`<span class="ui-fieldtext-note">${esc(ar.cmsg_company_own_note.replace("{name}", "Amal One").replace("{date}", "١٧ نوفمبر ٢٠٢٦"))}</span>`)
    })

    it("refused, it's a page this person can't open; failing otherwise, it says so with Try again", async () => {
        const html = await ownPage({ [companyMessagesApi(null)]: { error: Object.assign(new Error("x"), { status: 403, info: { error: "Forbidden" } }) } }, "contact")
        expect(html).toContain(esc(en.access_denied_title))
        const broke = await ownPage({ [companyMessagesApi(null)]: { error: Object.assign(new Error("x"), { status: 500, info: { error: "Database unavailable" } }) } }, "contact")
        expect(broke).toContain(esc(en.cmsg_load_failed))
        expect(broke).toContain(`>${en.try_again}</button>`)
        // A package without the client portal is said in the server's words, for the Super Admin who opened it.
        const noPortal = await superAdminPage({ [companyMessagesApi("c1")]: failed }, "contact")
        expect(noPortal).not.toContain(esc(en.access_denied_title))
        expect(noPortal).toContain(esc("This company's package doesn't include the client portal."))
    })

    it("a message that isn't one isn't found, on either page, which the server pages hand over", () => {
        expect(isMessageKind("contact")).toBe(true)
        expect(isMessageKind("claim")).toBe(true)
        expect(isMessageKind("other")).toBe(false)
        expect(isMessageKind("toString")).toBe(false)
        const own = source("app/(dashboard)/dashboard/settings/client-messages/[kind]/page.tsx")
        const theirs = source("app/(dashboard)/dashboard/companies/[id]/settings/client-messages/[kind]/page.tsx")
        for (const page of [own, theirs]) {
            expect(page).not.toMatch(/^'use client'/)
            expect(page).toContain("if (!isMessageKind(kind)) notFound()")
        }
        expect(own).toContain("return <CompanyMessagePage kind={kind} />")
        expect(theirs).toContain("return <CompanyMessagePage kind={kind} companyId={id} />")
    })

    it("the Super Admin opens it from their own settings page, for the company named, and back to its tab", async () => {
        const html = await superAdminPage({ [companyMessagesApi("c1")]: ok({ messages: OWN_AR }) }, "claim")
        expect(state.keys).toContain("/api/company-messages?companyId=c1")
        expect(html).toMatch(new RegExp(`<a [^>]*href="/dashboard/companies/c1/settings\\?tab=client_portal"[^>]*>.*${en.settings_tab_client_portal}</a>`))
        expect(html).toContain(`<h1 class="ui-page-title">${en.contact_about_claim}</h1>`)
    })

    it("the Super Admin's is theirs only, asking the server nothing for anyone else; the company's isn't theirs", async () => {
        const html = await superAdminPage({}, "contact", { role: "ADMIN" })
        expect(html).toContain(en.access_denied_super_admins)
        expect(state.keys.every(k => k === null)).toBe(true)
        const theirs = await ownPage({}, "contact", { role: "SUPER_ADMIN" })
        expect(theirs).toContain(esc(en.access_denied_title))
        expect(state.keys.every(k => k === null)).toBe(true)
    })

    it("saves the company's copy at its own address, from the text it started from, as the Super Admin's page saves Nizmo's", () => {
        const page = source(COMPANY_PAGE)
        expect(page).toContain("saveUrl={(kind, language) => companyMessageApi(scope, kind, language)}")
        expect(page).toContain("kinds={[kind]}")
        const editor = source(EDITOR)
        expect(editor).toContain("const res = await fetch(saveUrl(kind, language), {")
        expect(editor).toContain("body: JSON.stringify({ text: sent, since: sinceOf(edits, key, current.changedAt) })")
        // Nizmo's text, changed by the Super Admin while nothing is unsaved here, shows at once.
        expect(editor).toContain("const version = `${current.changedAt ?? 'never'}|${current.text}`")
        expect(editor).toContain("setEdits(e => written(e, key, text, current.changedAt, version))")
    })

    it("in words for both languages, Arabic neutral", () => {
        expect(en.cmsg_company_page_hint).toBe("This company's copy. Until it's changed, the company uses Nizmo's message.")
        expect(ar.cmsg_company_page_hint).toBe("نسخة هذه الشركة. إلى أن تُغيَّر، تستخدم الشركة رسالة Nizmo.")
        expect(ar.cmsg_company_own_note).toBe("نسخة الشركة. آخر تغيير: {name}، {date}. كل تغيير في سجل التدقيق.")
        expect(ar.cmsg_company_nizmo_note).toBe("تستخدم رسالة Nizmo. حفظ أي تغيير يُنشئ نسخة خاصة بالشركة. كل تغيير في سجل التدقيق.")
        const keys = Object.keys(en).filter(k => k.startsWith("cmsg_company") || k.startsWith("cmsg_use_nizmo") || k.startsWith("cmsg_in_") || k.startsWith("cmsg_change_for") || k === "cmsg_edit_named" || k === "cmsg_used_nizmo")
        expect(keys.length).toBeGreaterThan(15)
        for (const key of keys) {
            expect((ar as Record<string, string>)[key], key).toBeTruthy()
            // Nobody addressed as a man or a woman.
            expect((ar as Record<string, string>)[key], key).not.toMatch(/(أنت|أنتِ|قم |اضغط|ادخل|غيّرها |غيره )/)
        }
    })
})

/** The update email's card on the Client portal tab (§4.4, step 11a; DESIGN.md §5.5; PR 350). */
async function emailsCard(swr: Record<string, Loaded>, options: { locale?: "en" | "ar"; superAdmin?: boolean } = {}) {
    const { default: TaxEmailsCard } = await import("@/components/client-messages/TaxEmailsCard")
    return rendered(TaxEmailsCard, { companyId: "c1", superAdmin: !!options.superAdmin }, swr, { locale: options.locale, role: options.superAdmin ? "SUPER_ADMIN" : "ADMIN" })
}
const EMAILS_CARD = "components/client-messages/TaxEmailsCard.tsx"

describe("the update email's card (§4.4, step 11a; PR 350)", () => {
    it("asks for its own company's switch, or the Super Admin's company's", async () => {
        expect(taxEmailsApi(null)).toBe("/api/company-messages/emails")
        expect(taxEmailsApi("c 1")).toBe("/api/company-messages/emails?companyId=c%201")
        await emailsCard({})
        expect(state.keys).toContain("/api/company-messages/emails")
        await emailsCard({}, { superAdmin: true })
        expect(state.keys).toContain("/api/company-messages/emails?companyId=c1")
    })

    it("is titled as the mockup titles it, one row saying what's sent, in both languages", async () => {
        for (const locale of ["en", "ar"] as const) {
            const words = locale === "ar" ? ar : en
            const html = await emailsCard({ [taxEmailsApi(null)]: ok({ on: false }) }, { locale })
            expect(html).toContain(`<h2 class="ui-card-title">${words.cmsg_emails_title}</h2>`)
            const list = between(html, `<ul class="ui-rows ui-rows-flush" aria-label="${words.cmsg_emails_title}"`, "</ul>")
            expect(list.split("<li")).toHaveLength(2)
            expect(list).toContain(esc(words.cmsg_emails_label))
            expect(list).toContain(esc(words.cmsg_emails_hint))
        }
        expect(ar.cmsg_emails_title).toBe("بريد عند تحديث الموقف الضريبي")
        expect(ar.cmsg_emails_hint).toBe("بعد كل رفع لملف البوابة، يصل لكل شخص من العميل له كلمة مرور بريد واحد: أن المكتب حدّث الموقف الضريبي، وتاريخ الأرقام، ورابط الدخول. بدون مبالغ، وبحد أقصى بريد واحد في اليوم لكل عميل.")
        expect(en.cmsg_emails_title).toBe("Email when the tax position is updated")
    })

    it("off: says Off, with Turn on; on: says On, with Turn off, as the company's other switches", async () => {
        const off = await emailsCard({ [taxEmailsApi(null)]: ok({ on: false }) })
        expect(off).toContain(`>${en.cmsg_emails_off}</span>`)
        expect(off).toMatch(new RegExp(`<button[^>]*class="[^"]*ui-btn-primary[^"]*"[^>]*>${en.settings_turn_on}</button>`))
        expect(off).not.toContain(`>${en.settings_turn_off}</button>`)
        const on = await emailsCard({ [taxEmailsApi(null)]: ok({ on: true }) })
        expect(on).toContain(`>${en.cmsg_emails_on}</span>`)
        expect(on).toContain(`>${en.settings_turn_off}</button>`)
        expect(on).not.toContain(`>${en.settings_turn_on}</button>`)
        const ours = await emailsCard({ [taxEmailsApi(null)]: ok({ on: true }) }, { locale: "ar" })
        expect(ours).toContain(`>${ar.cmsg_emails_on}</span>`)
        expect(ours).toContain(`>${ar.settings_turn_off}</button>`)
    })

    it("says while it loads, and when it didn't, with the server's words and Try again", async () => {
        const loading = await emailsCard({})
        expect(loading).toContain('<div role="status">')
        expect(loading).toContain(en.loading)
        expect(loading).not.toContain(`>${en.settings_turn_on}</button>`)
        const html = await emailsCard({ [taxEmailsApi(null)]: failed })
        expect(html).toContain(esc(en.cmsg_emails_load_failed))
        expect(html).toContain(esc("This company's package doesn't include the client portal."))
        expect(html).toContain(`>${en.try_again}</button>`)
        expect(html).not.toContain(`>${en.settings_turn_on}</button>`)
    })

    it("saves at its own address, asking nothing first, and shows what the server kept", () => {
        const card = source(EMAILS_CARD)
        expect(card).toMatch(/fetch\(taxEmailsApi\(scope\), \{\s*method: 'PUT',\s*headers: \{ 'Content-Type': 'application\/json' \},\s*body: JSON\.stringify\(\{ on: next \}\),\s*\}\)/)
        expect(card).toMatch(/await mutate\(\{ data: \{ on: body\.data\.on \} \}, \{ revalidate: false \}\)/)
        expect(card).toContain("showToast(t('settings_saved_success'), 'success')")
        expect(card).not.toContain("ConfirmDialog")
    })

    it("is on the Client portal tab, under the messages' card", () => {
        const tabs = source("components/CompanySettingsTabs.tsx")
        expect(tabs).toMatch(/\{tab === 'client_portal' && <>\s*<CompanyMessagesCard companyId=\{companyId\} superAdmin=\{superAdmin\} \/>\s*<TaxEmailsCard companyId=\{companyId\} superAdmin=\{superAdmin\} \/>\s*<\/>\}/)
    })

    it("in words for both languages, Arabic neutral", () => {
        const keys = Object.keys(en).filter(k => k.startsWith("cmsg_emails_"))
        expect(keys.sort()).toEqual(["cmsg_emails_hint", "cmsg_emails_label", "cmsg_emails_load_failed", "cmsg_emails_off", "cmsg_emails_on", "cmsg_emails_title"])
        for (const key of keys) {
            expect((ar as Record<string, string>)[key], key).toBeTruthy()
            expect((ar as Record<string, string>)[key], key).not.toMatch(/(أنت|أنتِ|قم |اضغط|ادخل)/)
        }
    })
})

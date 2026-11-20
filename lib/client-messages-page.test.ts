import { describe, it, expect, vi } from "vitest"
import { createElement as h } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { readFileSync } from "node:fs"
import { ChatsCircleIcon } from "@phosphor-icons/react/ssr"
import { ar } from "./translations/ar"
import { en } from "./translations/en"
import { PAGES, SUPER_ADMIN_GROUPS } from "./side-bar"
import { ITEM_ICONS } from "./side-bar-icons"
import { KNOWN_REFUSALS } from "./api-errors"
import { stripComments } from "./strip-comments"
import { MESSAGE_FIELDS, NIZMO_MESSAGES } from "./client-message-template"
import { sampleMessage } from "./contact-message"

/**
 * Client messages on WhatsApp (CLIENT_PORTAL_PLAN.md §7.1, §12 step 10b;
 * DESIGN.md §5.5; PR 347): the Super Admin's page of Nizmo's own messages,
 * under Templates, as the owner's mockup draws it (Message templates): a tab
 * for each message, the text with fields put in by buttons in Arabic or
 * English, how many characters of 1,000, who changed it last, Save and
 * Discard changes, and a preview with made-up figures.
 */

type Loaded = { data?: unknown; error?: unknown; isValidating?: boolean }
const state = {
    locale: "en" as "en" | "ar",
    role: "SUPER_ADMIN",
    swr: {} as Record<string, Loaded>,
    keys: [] as (string | null)[],
}

vi.mock("next-auth/react", () => ({ useSession: () => ({ data: { user: { id: "sa", role: state.role, name: "Sam Admin" } }, status: "authenticated" }) }))
vi.mock("@/context/LanguageContext", () => ({
    useLanguage: () => ({ locale: state.locale, t: (key: string) => (state.locale === "ar" ? ar : en)[key as keyof typeof en] ?? key }),
}))
vi.mock("@/context/ToastContext", () => ({ useToast: () => ({ showToast: () => {} }) }))
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {} }), usePathname: () => "/dashboard/client-messages" }))
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
const failed = { error: Object.assign(new Error("x"), { status: 500, info: { error: "Database unavailable" } }) }
const URL = "/api/client-messages"
const never = (kind: "contact" | "claim", language: "ar" | "en") => ({ kind, language, text: NIZMO_MESSAGES[kind][language], changedBy: null, changedAt: null })
const NEVER = [never("contact", "ar"), never("contact", "en"), never("claim", "ar"), never("claim", "en")]
const CHANGED = [
    { kind: "contact", language: "ar", text: "مرحبًا، أنا {person} من {client}.", changedBy: "Sam Admin", changedAt: "2026-11-17T09:30:00.000Z" },
    ...NEVER.slice(1),
]

async function page(swr: Record<string, Loaded>, { locale = "en", role = "SUPER_ADMIN" }: { locale?: "en" | "ar"; role?: string } = {}) {
    const { default: ClientMessagesPage } = await import("@/app/(dashboard)/dashboard/client-messages/page")
    Object.assign(state, { swr, locale, role, keys: [] })
    vi.stubGlobal("document", { body: {} })
    try {
        return renderToStaticMarkup(h(ClientMessagesPage))
    } finally {
        vi.unstubAllGlobals()
    }
}
const between = (html: string, from: string, to: string) => {
    const start = html.indexOf(from)
    expect([from, start >= 0]).toEqual([from, true])
    const end = html.indexOf(to, start + from.length)
    return html.slice(start, end < 0 ? undefined : end + to.length)
}
const box = (html: string) => between(html, '<div role="textbox"', "</div>")
const source = (file: string) => stripComments(readFileSync(file, "utf8"))

const css = stripComments(readFileSync("components/ui/ui.css", "utf8"))
/** The body of the rule whose selector is exactly this one, outside any media block. */
function rule(selector: string): string {
    const at = css.search(new RegExp(`(^|\\})\\s*${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{`, "m"))
    expect([selector, at >= 0]).toEqual([selector, true])
    const open = css.indexOf("{", at + 1)
    return css.slice(open + 1, css.indexOf("}", open))
}
const tokens = readFileSync("app/globals.css", "utf8")
const themeBlock = (selector: string) => {
    const start = tokens.indexOf("Design tokens (DESIGN.md)")
    const at = tokens.indexOf(selector, start)
    return tokens.slice(at, tokens.indexOf("\n}", at))
}
function contrast(a: string, b: string) {
    const lum = (hex: string) => {
        const [r, g, bl] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(c => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
        return 0.2126 * r + 0.7152 * g + 0.0722 * bl
    }
    const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p)
    return (x + 0.05) / (y + 0.05)
}

describe("in the side bar", () => {
    it("joins Templates, after Terminal brands, with speech bubbles", () => {
        expect(PAGES.clientMessages).toEqual({ href: "/dashboard/client-messages", labelKey: "cmsg_nav" })
        expect(SUPER_ADMIN_GROUPS.find(g => g.key === "templates")?.items).toEqual(["roleTemplates", "policyTemplates", "publicHolidays", "terminalBrands", "clientMessages"])
        expect(ITEM_ICONS.clientMessages).toBe(ChatsCircleIcon)
    })
})

describe("its routes", () => {
    const routes = ["app/api/client-messages/route.ts", "app/api/client-messages/[kind]/[language]/route.ts"]

    it("are the Super Admin's alone: every handler refuses anyone else first", () => {
        for (const file of routes) {
            const handlers = source(file).split(/export const (?:GET|PUT|POST|DELETE) = /).slice(1)
            expect([file, handlers.length > 0]).toEqual([file, true])
            for (const handler of handlers) expect(handler).toMatch(/^withStandardHandler\(async \([^)]*\) => \{\s*if \(session\.user\.role !== "SUPER_ADMIN"\) return ApiResponse\.forbidden\(\)/)
        }
    })

    it("read Nizmo's messages, and save one by its message and language, from the text it started from", () => {
        expect(source(routes[0])).toContain("ApiResponse.success({ messages: await nizmoMessages() })")
        const put = source(routes[1])
        expect(put).toContain("clientMessageSchema.safeParse({ ...json, kind: context.params.kind, language: context.params.language })")
        expect(put).toContain("saveNizmoMessage({ id: session.user.id, name: session.user.name ?? \"\" }, validation.data)")
        const schema = source("lib/validations/client-message.schema.ts")
        expect(schema).toContain("kind: z.enum(MESSAGE_KINDS)")
        expect(schema).toContain("language: z.enum(MESSAGE_LANGUAGES)")
        expect(schema).toContain("text: z.string().max(20_000)")
        expect(schema).toContain("since: z.string().datetime().nullable()")
    })

    it("answer each refusal with what to do", () => {
        for (const code of ["MESSAGE_EMPTY", "MESSAGE_TOO_LONG", "MESSAGE_FIELD"]) expect(KNOWN_REFUSALS[code]?.status).toBe(400)
        expect(KNOWN_REFUSALS.MESSAGE_CHANGED_SINCE?.status).toBe(409)
    })
})

describe("the page", () => {
    it("has a header that names it and says what it's for", async () => {
        const html = await page({ [URL]: ok({ messages: NEVER }) })
        expect(html).toContain(`<h1 class="ui-page-title">${en.cmsg_title}</h1>`)
        expect(html).toContain(`<p class="ui-page-subtitle">${esc(en.cmsg_hint)}</p>`)
    })

    it("is the Super Admin's only, and asks the server nothing for anyone else", async () => {
        const html = await page({ [URL]: ok({ messages: NEVER }) }, { role: "ADMIN" })
        expect(html).toContain(en.access_denied_super_admins)
        expect(state.keys.every(k => k === null)).toBe(true)
    })

    it("says while the messages load, and when they didn't, with Try again", async () => {
        expect(await page({})).toContain(`<div class="ui-panel" role="status">`)
        const html = await page({ [URL]: failed })
        expect(html).toContain(esc(en.cmsg_load_failed))
        expect(html).toContain(`>${en.try_again}</button>`)
    })

    it("a tab for each message, Contact the accountant first and chosen, for the part under them", async () => {
        const html = await page({ [URL]: ok({ messages: NEVER }) })
        const tabs = between(html, '<div role="tablist"', "</div>")
        expect(tabs).toContain(`aria-label="${en.cmsg_tabs}"`)
        expect(tabs).toMatch(new RegExp(`<button type="button" role="tab" id="cmsg-contact" data-value="contact" class="ui-tab" aria-selected="true" aria-controls="cmsg-panel" tabindex="0">${en.portal_contact_accountant}</button>`))
        expect(tabs).toMatch(new RegExp(`<button type="button" role="tab" id="cmsg-claim" data-value="claim" class="ui-tab" aria-selected="false" aria-controls="cmsg-panel" tabindex="-1">${en.contact_about_claim}</button>`))
        expect(html).toContain('<div role="tabpanel" id="cmsg-panel" aria-labelledby="cmsg-contact"')
    })

    it("the text in the page's language to start, with a switch to the other: العربية, then English, whatever the page's", async () => {
        for (const locale of ["en", "ar"] as const) {
            const html = await page({ [URL]: ok({ messages: NEVER }) }, { locale })
            const words = locale === "ar" ? ar : en
            expect(html).toContain(`<div role="group" aria-label="${words.cmsg_language}" class="ui-segmented" dir="ltr">`
                + `<button type="button" class="ui-segmented-option" aria-pressed="${locale === "ar"}" lang="ar">العربية</button>`
                + `<button type="button" class="ui-segmented-option" aria-pressed="${locale === "en"}" lang="en">English</button></div>`)
            expect(box(html)).toContain(`lang="${locale}" dir="${locale === "ar" ? "rtl" : "ltr"}"`)
        }
    })

    it("the text in a box named by its label, each field a chip by its name in the page's language", async () => {
        const html = await page({ [URL]: ok({ messages: NEVER }) })
        const label = between(html, '<span id="', `>${en.cmsg_text}</span>`)
        const id = label.match(/^<span id="([^"]+)"/)![1]
        expect(box(html)).toMatch(new RegExp(`^<div role="textbox" aria-multiline="true" aria-labelledby="${id}" contentEditable="true" spellCheck="true" class="ui-input ui-fieldtext-box" lang="en" dir="ltr">`))
        expect(box(html)).toContain(
            'Hello,\nThis is <span class="ui-fieldtext-chip" contenteditable="false" data-field="person">Person&#39;s name</span> from '
            + '<span class="ui-fieldtext-chip" contenteditable="false" data-field="client">Client&#39;s name</span>.\n'
            + 'A question about the tax position as of <span class="ui-fieldtext-chip" contenteditable="false" data-field="asOf">Date of the figures</span>:<br data-end="">',
        )
    })

    it("a button for each field the message has, named by it, under a line saying where it goes", async () => {
        const html = await page({ [URL]: ok({ messages: NEVER }) })
        const adds = between(html, '<div role="group" aria-labelledby="', "</div>")
        expect(adds).toContain(esc(en.fieldtext_add))
        const named = [...adds.matchAll(/<button type="button" class="ui-fieldtext-add" data-field="(\w+)"><svg[^>]*>.*?<\/svg>([^<]+)<\/button>/g)].map(m => [m[1], m[2]])
        expect(named).toEqual(MESSAGE_FIELDS.contact.map(f => [f, esc(en[`cmsg_field_${f}` as keyof typeof en])]))
    })

    it("how many characters of 1,000, and that it hasn't been changed, saying every change is in the audit log", async () => {
        const html = await page({ [URL]: ok({ messages: NEVER }) })
        const length = [...NIZMO_MESSAGES.contact.en].length
        expect(html).toContain(`<span class="ui-fieldtext-count">${en.fieldtext_count.replace("{count}", String(length)).replace("{max}", "1,000")}</span>`)
        expect(html).toContain(`<span class="ui-fieldtext-note">${esc(en.cmsg_never_changed)}</span>`)
    })

    it("who changed it last and when, in the page's words and digits", async () => {
        const html = await page({ [URL]: ok({ messages: CHANGED }) }, { locale: "ar" })
        expect(html).toContain(`<span class="ui-fieldtext-note">${esc(ar.cmsg_changed.replace("{name}", "Sam Admin").replace("{date}", "١٧ نوفمبر ٢٠٢٦"))}</span>`)
        // Its 33 characters, as kept: each field by its name in braces.
        expect(html).toContain(`<span class="ui-fieldtext-count">${ar.fieldtext_count.replace("{count}", "٣٣").replace("{max}", "١٬٠٠٠")}</span>`)
    })

    it("Save and Discard changes, both disabled while the text is as it was saved", async () => {
        const html = await page({ [URL]: ok({ messages: NEVER }) })
        expect(html).toMatch(new RegExp(`<div class="ui-fieldtext-actions"><button type="button" class="ui-btn ui-btn-primary" disabled="">${en.save}</button><button type="button" class="ui-btn ui-btn-secondary" disabled="">${en.cmsg_discard}</button></div>`))
    })

    it("a preview with made-up figures, as the dialog fills it, in the text's language, with a line on how it's filled", async () => {
        const html = await page({ [URL]: ok({ messages: NEVER }) }, { locale: "ar" })
        expect(html).toContain(`<h2 class="ui-card-title">${ar.cmsg_preview}</h2>`)
        expect(html).toContain(`<div class="ui-chat"><p class="ui-chat-bubble" lang="ar" dir="rtl">${esc(sampleMessage("contact", "ar", NIZMO_MESSAGES.contact.ar))}</p></div>`)
        expect(html).toContain(`<p class="ui-chat-note">${esc(ar.cmsg_preview_note)}</p>`)
    })

    it("a save says the time its text started from, keeps what's typed while it goes, and after a refusal saves over the newer one", () => {
        // PR 347, Codex's two findings: the time isn't the one the page read last, as another message's save reads them all again.
        const page = source("app/(dashboard)/dashboard/client-messages/page.tsx")
        expect(page).toContain("body: JSON.stringify({ text: sent, since: sinceOf(edits, key, current.changedAt) })")
        expect(page).toContain("setEdits(e => written(e, key, text, current.changedAt))")
        expect(page).toContain("setEdits(e => saved(e, key, sent, typeof body?.data?.changedAt === 'string' ? body.data.changedAt : null))")
        expect(page).toContain("if (now) setEdits(e => conflicted(e, key, now.changedAt))")
        expect(page).toContain("setEdits(e => discarded(e, key))")
        expect(page).not.toContain("setDrafts")
        // Codex's third: the box, which reads its text once, starts again when the saved text changes and nothing is unsaved.
        expect(page).toContain("key={`${key}:${starts[key] ?? 0}:${boxOf(edits, key, current.changedAt) ?? 'never'}`}")
    })

    it("the text and its preview side by side", () => {
        expect(source("app/(dashboard)/dashboard/client-messages/page.tsx")).toMatch(/<Columns>\s*<Card className="ui-fieldtext-card"[\s\S]*<\/Card>\s*<Card title=\{t\('cmsg_preview'\)\}[\s\S]*<\/Card>\s*<\/Columns>/)
    })
})

describe("the made-up figures", () => {
    it("the plan's own, in each language's digits", () => {
        expect(sampleMessage("claim", "ar", NIZMO_MESSAGES.claim.ar)).toBe(
            "السلام عليكم،\nأنا منى فؤاد من شركة النموذج للتجارة والتوريدات.\nاستفسار عن المطالبة رقم 000372722603:\nالبند: إقرار تجاري\nالمتبقي: ١٣٬٧٢٣٫٢٦ جنيه من ٢١٬٠٨٨٫٢٦\nآخر موعد للسداد: ٣٠ أبريل ٢٠٢٦",
        )
        expect(sampleMessage("contact", "en", NIZMO_MESSAGES.contact.en)).toBe(
            "Hello,\nThis is Mona Fouad from Al Namozag Trading.\nA question about the tax position as of 16 November 2026:",
        )
    })

    it("a field the message can't fill left as written", () => {
        expect(sampleMessage("contact", "en", "{number} for {person}")).toBe("{number} for Mona Fouad")
    })
})

describe("its look", () => {
    it("a field as a chip: --brand-tint-strong, in --brand-text at weight 600, pill-shaped, kept apart from the words around it", () => {
        const chip = rule(".ui-fieldtext-chip")
        expect(chip).toContain("background: var(--brand-tint-strong);")
        expect(chip).toContain("color: var(--brand-text);")
        expect(chip).toContain("font-weight: 600;")
        expect(chip).toContain("border-radius: var(--radius-pill);")
        expect(chip).toContain("unicode-bidi: isolate;")
    })

    it("the box as tall as its text and at least six lines, keeping its new lines, with room between them", () => {
        const b = rule(".ui-fieldtext-box")
        expect(b).toContain("white-space: pre-wrap;")
        expect(b).toContain("line-height: 2;")
        // Six lines of 2em each.
        expect(b).toContain("min-height: 12em;")
        expect(b).toContain("height: auto;")
    })

    it("a field's button: --text-sm, --brand-text, pill-shaped with a dashed --brand edge, 32px tall, 44px on phones", () => {
        const add = rule(".ui-fieldtext-add")
        expect(add).toContain("font-size: var(--text-sm);")
        expect(add).toContain("color: var(--brand-text);")
        expect(add).toContain("border: 1px dashed var(--brand);")
        expect(add).toContain("border-radius: var(--radius-pill);")
        expect(add).toContain("min-height: 32px;")
        expect(css).toMatch(/@media \(max-width: 767px\) \{[^@]*\.ui-fieldtext-add \{\s*min-height: 44px;/)
    })

    it("the count and the note under the buttons in --text-xs and --muted, the count in --problem-text past 1,000", () => {
        expect(rule(".ui-fieldtext-foot")).toMatch(/font-size: var\(--text-xs\);[\s\S]*color: var\(--muted\);/)
        expect(rule('.ui-fieldtext-count[data-over="true"]')).toContain("color: var(--problem-text);")
    })

    it("the preview a chat bubble on a chat ground, with 12px corners, on its language's start side", () => {
        expect(rule(".ui-chat")).toContain("background: var(--chat-ground);")
        const bubble = rule(".ui-chat-bubble")
        expect(bubble).toContain("background: var(--chat-bubble);")
        expect(bubble).toContain("color: var(--chat-ink);")
        expect(bubble).toContain("border-radius: 12px;")
        expect(bubble).toContain("white-space: pre-wrap;")
        expect(bubble).toContain("margin-inline-end: auto;")
        // Narrower than its panel, in a chat's size, as the mockup draws it.
        expect(bubble).toContain("max-width: 85%;")
        expect(bubble).toContain("font-size: var(--text-sm);")
    })

    it("the line under the preview in --text-xs and --muted", () => {
        expect(rule(".ui-chat-note")).toMatch(/font-size: var\(--text-xs\);[\s\S]*color: var\(--muted\);/)
        expect(source("app/(dashboard)/dashboard/client-messages/page.tsx")).toContain(`<p className="ui-chat-note">{t('cmsg_preview_note')}</p>`)
    })

    it("the text's card three fifths of the width where the side bar is beside the page", () => {
        expect(css).toMatch(/@media \(min-width: 1024px\) \{\s*\.ui-cmsg-panel > \.ui-columns \{\s*grid-template-columns: minmax\(0, 3fr\) minmax\(0, 2fr\);/)
    })

    it("the chat's colours as DESIGN.md says them, the bubble's text at 4.5:1 or better in both themes", () => {
        const light = themeBlock(":root {"), dark = themeBlock(':root[data-theme="dark"] {')
        expect(light).toMatch(/--chat-ground: #efeae2;\s*--chat-bubble: #d9fdd3;\s*--chat-ink: #111b21;/)
        expect(dark).toMatch(/--chat-ground: #0b141a;\s*--chat-bubble: #005c4b;\s*--chat-ink: #e9edef;/)
        expect(contrast("#111b21", "#d9fdd3")).toBeGreaterThanOrEqual(4.5)
        expect(contrast("#e9edef", "#005c4b")).toBeGreaterThanOrEqual(4.5)
        expect(readFileSync("DESIGN.md", "utf8")).toContain("Light: `--chat-ground` `#efeae2`,\n    `--chat-bubble` `#d9fdd3`, `--chat-ink` `#111b21`. Dark: `#0b141a`,\n    `#005c4b` and `#e9edef`.")
    })
})

describe("its words", () => {
    const KEYS = [
        "cmsg_nav", "cmsg_title", "cmsg_hint", "cmsg_tabs", "cmsg_text", "cmsg_language", "cmsg_never_changed", "cmsg_changed",
        "cmsg_discard", "cmsg_saved", "cmsg_preview", "cmsg_preview_note", "cmsg_load_failed",
        "cmsg_error_empty", "cmsg_error_too_long", "cmsg_error_field", "cmsg_error_changed",
        "fieldtext_add", "fieldtext_count",
        ...MESSAGE_FIELDS.claim.map(f => `cmsg_field_${f}`),
        "audit_action_UPDATE_CLIENT_MESSAGE", "audit_entity_CLIENT_MESSAGE",
        "audit_value_CONTACT_ACCOUNTANT", "audit_value_ASK_ABOUT_CLAIM", "audit_value_AR", "audit_value_EN",
    ]

    it("are there in both languages", () => {
        for (const key of KEYS) expect([key, !!en[key as keyof typeof en], !!ar[key as keyof typeof ar]]).toEqual([key, true, true])
    })

    it("in Arabic, as the mockup says them", () => {
        expect(ar.cmsg_nav).toBe("رسائل العملاء")
        expect(ar.cmsg_title).toBe("رسائل العملاء على واتساب")
        expect(ar.cmsg_hint).toBe("رسائل Nizmo لكل الشركات. الشركة التي غيّرت رسالة تستخدم نسختها، والباقي يستخدم هذه.")
        expect(ar.cmsg_text).toBe("نص الرسالة")
        expect(ar.fieldtext_add).toBe("إضافة حقل في مكان المؤشر:")
        expect(ar.fieldtext_count).toBe("{count} من {max} حرف")
        expect(ar.cmsg_changed).toBe("آخر تغيير: {name}، {date}. كل تغيير في سجل التدقيق.")
        expect(ar.cmsg_discard).toBe("إلغاء التغييرات")
        expect(ar.cmsg_preview).toBe("معاينة بأرقام مثال")
        expect(ar.cmsg_preview_note).toBe("تُملأ الحقول من صفحة العميل عند فتح الرسالة، ويمكن لشخص العميل تعديلها قبل الإرسال.")
        expect(MESSAGE_FIELDS.claim.map(f => ar[`cmsg_field_${f}` as keyof typeof ar]))
            .toEqual(["اسم الشخص", "اسم العميل", "تاريخ الأرقام", "رقم المطالبة", "البند", "المتبقي", "القيمة الأصلية", "آخر موعد للسداد"])
    })

    it("in English", () => {
        expect(en.cmsg_title).toBe("Client messages on WhatsApp")
        expect(en.cmsg_hint).toBe("Nizmo's messages for every company. A company that changed a message uses its own copy; the rest use these.")
        expect(en.fieldtext_add).toBe("Add a field where the cursor is:")
        expect(en.fieldtext_count).toBe("{count} of {max} characters")
        expect(en.cmsg_changed).toBe("Last changed: {name}, {date}. Every change is in the audit log.")
        expect(MESSAGE_FIELDS.claim.map(f => en[`cmsg_field_${f}` as keyof typeof en]))
            .toEqual(["Person's name", "Client's name", "Date of the figures", "Claim number", "Item", "Remaining", "Original amount", "Last day to pay"])
    })

    it("neutral in Arabic, with no one addressed as a man or a woman", () => {
        for (const key of KEYS.filter(k => k.startsWith("cmsg_") || k.startsWith("fieldtext_"))) {
            expect([key, /(أدخل|اكتب|احفظ|اضغط|غيّر |تأكد)/.test(ar[key as keyof typeof ar] as string)]).toEqual([key, false])
        }
    })
})

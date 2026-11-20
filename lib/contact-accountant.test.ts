import { describe, it, expect, vi, beforeEach } from "vitest"
import { createElement as h } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { readFileSync } from "node:fs"
import { en } from "./translations/en"
import { ar } from "./translations/ar"
import { stripComments } from "./strip-comments"
import { summarise, type PortalTaxPosition } from "./portal-tax"
import { daysLate, type TaxClaimRow } from "./tax-claims"

/**
 * Contact the accountant on the client's own page (CLIENT_PORTAL_PLAN.md §7,
 * §12 step 9c; DESIGN.md §5.5, A client's tax position and Contact on
 * WhatsApp; PR 344): who the page is told of, the accountant named in its
 * subtitle, the button, the dialog as the owner's mockup draws it, the
 * message, and the link that opens WhatsApp.
 */

const state = { locale: "en" as "en" | "ar" }

vi.mock("@/context/LanguageContext", () => ({
    useLanguage: () => ({ locale: state.locale, t: (key: string) => (state.locale === "ar" ? ar : en)[key as keyof typeof en] ?? key }),
}))
vi.mock("@/lib/useHydrated", () => ({ useHydrated: () => true }))
vi.mock("react-dom", async (importOriginal) => ({ ...(await importOriginal<typeof import("react-dom")>()), createPortal: (node: unknown) => node }))

const { portalAccountantOf } = await import("./client-accountant")
const { contactMessage, whatsAppLink } = await import("./contact-message")
const { PortalHome } = await import("@/components/portal/PortalHome")
const { ContactWhatsApp } = await import("@/components/portal/ContactWhatsApp")
const { ButtonExternal } = await import("@/components/ui/ButtonExternal")

beforeEach(() => {
    state.locale = "en"
    // The dialog is drawn into the page's body, which a test stands in for.
    vi.stubGlobal("document", { body: {} })
})

const t = (locale: "en" | "ar") => (key: string) => (locale === "ar" ? ar : en)[key as keyof typeof en] ?? key

const TODAY = "2026-11-19"
const AS_OF = "2026-11-17"
const claim = (id: string, item: string, original: number, paid: number, dueDate: string): TaxClaimRow => ({
    id, claimNumber: `0${id}`, item, taxType: null, registrationType: null,
    originalAmount: original, paidAmount: paid, remainingAmount: Math.round((original - paid) * 100) / 100,
    currency: "جنيه مصري", status: null, periodStart: null, periodEnd: null, dueDate, daysLate: daysLate(dueDate, TODAY),
})
/** Made-up claims, two of them late. */
const POSITION = summarise([
    claim("1", "إقرار ضريبة الدخل", 1000, 0, "2025-06-30"),
    claim("2", "إقرار القيمة المضافة", 400.5, 100.25, "2026-12-31"),
], TODAY, AS_OF)
const NONE = summarise([], TODAY, null)
const NOTHING_OPEN = summarise([], TODAY, AS_OF)

/** A made-up accountant and client account. */
const WRITES = { name: "Tamer Saleh", whatsappNumber: "+201001234567" }
const NO_NUMBER = { name: "Tamer Saleh", whatsappNumber: null }

const esc = (text: string) => text.replace(/&/g, "&amp;").replace(/'/g, "&#x27;").replace(/"/g, "&quot;")
const page = (position: PortalTaxPosition, accountant: typeof WRITES | typeof NO_NUMBER | null, locale: "en" | "ar" = "en") => {
    state.locale = locale
    return renderToStaticMarkup(h(PortalHome, { client: "Nile Trading", person: "Mona Fouad", position, accountant }))
}
const dialog = (props: Partial<{ open: boolean; name: string; message: string }> = {}, locale: "en" | "ar" = "en") => {
    state.locale = locale
    return renderToStaticMarkup(h(ContactWhatsApp, {
        open: props.open ?? true,
        onClose: () => {},
        title: (locale === "ar" ? ar : en).portal_contact_accountant,
        accountant: { name: props.name ?? "Tamer Saleh", whatsappNumber: "+201001234567" },
        client: "Nile Trading",
        message: props.message ?? "Hello,\nThis is Mona Fouad from Nile Trading.\nA question about the tax position as of 17 November 2026:",
    }))
}
const css = stripComments(readFileSync("components/ui/ui.css", "utf8"))
/** The body of the rule whose selector is exactly this one, outside any media block. */
function rule(selector: string): string {
    const at = css.search(new RegExp(`(^|\\})\\s*${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{`, "m"))
    expect([selector, at >= 0]).toEqual([selector, true])
    const open = css.indexOf("{", at + 1)
    return css.slice(open + 1, css.indexOf("}", open))
}

describe("who the client's page is told of", () => {
    const person = { id: "t1", name: "Tamer Saleh", role: "TEAM_LEADER", whatsappNumber: "+201001234567", ended: false }

    it("the accountant's name and number where they can be written to, and nothing else of them", () => {
        expect(portalAccountantOf({ person, reach: "whatsapp" })).toEqual({ name: "Tamer Saleh", whatsappNumber: "+201001234567" })
    })

    it("their name alone where their profile has no number", () => {
        expect(portalAccountantOf({ person: { ...person, whatsappNumber: null }, reach: "no_number" })).toEqual({ name: "Tamer Saleh", whatsappNumber: null })
    })

    it("no one where none is picked or their contract has ended, a number or not", () => {
        expect(portalAccountantOf({ person: null, reach: "none" })).toBeNull()
        expect(portalAccountantOf({ person: { ...person, ended: true }, reach: "ended" })).toBeNull()
    })
})

describe("the message", () => {
    it("Nizmo's own, in the page's language, from the client account's name and the client's, with the day the figures are from", () => {
        expect(contactMessage(t("en"), "en", { person: "Mona Fouad", client: "Al Namozag Trading", asOf: "2026-11-16" }))
            .toBe("Hello,\nThis is Mona Fouad from Al Namozag Trading.\nA question about the tax position as of 16 November 2026:")
        // As the plan writes it, the day in Arabic digits.
        expect(contactMessage(t("ar"), "ar", { person: "منى فؤاد", client: "شركة النموذج للتجارة والتوريدات", asOf: "2026-11-16" }))
            .toBe("السلام عليكم،\nأنا منى فؤاد من شركة النموذج للتجارة والتوريدات.\nاستفسار عن الموقف الضريبي بتاريخ ١٦ نوفمبر ٢٠٢٦:")
    })

    it("naming no day before the first file", () => {
        expect(contactMessage(t("en"), "en", { person: "Mona Fouad", client: "Nile Trading", asOf: null }))
            .toBe("Hello,\nThis is Mona Fouad from Nile Trading.\nA question about the tax position:")
        expect(contactMessage(t("ar"), "ar", { person: "منى فؤاد", client: "نايل للتجارة", asOf: null }))
            .toBe("السلام عليكم،\nأنا منى فؤاد من نايل للتجارة.\nاستفسار عن الموقف الضريبي:")
    })

    it("opens wa.me with the number's digits and the message as it's sent", () => {
        expect(whatsAppLink("+201001234567", "Hello,\nA b&c? ١٦")).toBe(`https://wa.me/201001234567?text=${encodeURIComponent("Hello,\nA b&c? ١٦")}`)
        expect(whatsAppLink("+201001234567", "Hello,\nA b&c?")).toBe("https://wa.me/201001234567?text=Hello%2C%0AA%20b%26c%3F")
    })
})

describe("the page's header", () => {
    it("names the accountant after where the figures come from, the name on one line", () => {
        expect(page(POSITION, WRITES)).toContain(`<p class="ui-page-subtitle">From the Tax Authority&#x27;s portal, last updated 17\u00a0Nov\u00a02026. Responsible accountant: <bdi>Tamer\u00a0Saleh</bdi></p>`)
        expect(page(POSITION, WRITES, "ar")).toContain(`<p class="ui-page-subtitle">من بوابة مصلحة الضرائب، آخر تحديث ١٧\u00a0نوفمبر\u00a0٢٠٢٦. المحاسب المسؤول: <bdi>Tamer\u00a0Saleh</bdi></p>`)
        // One without a number is named too.
        expect(page(POSITION, NO_NUMBER)).toContain("Responsible accountant: <bdi>Tamer\u00a0Saleh</bdi>")
    })

    it("has Contact the accountant as its primary button, with a speech bubble, where the accountant has a number", () => {
        const html = page(POSITION, WRITES)
        expect(html).toMatch(/<div class="ui-page-actions"><button type="button" class="ui-btn ui-btn-primary" aria-haspopup="dialog"><svg[^>]*>.*?<\/svg>Contact the accountant<\/button><\/div>/)
        expect(page(POSITION, WRITES, "ar")).toContain(">التواصل مع المحاسب</button>")
    })

    it("has no button where the accountant has no number, and names no one where there's none", () => {
        expect(page(POSITION, NO_NUMBER)).not.toContain("ui-page-actions")
        const html = page(POSITION, null)
        expect(html).not.toContain("ui-page-actions")
        expect(html).not.toContain("Responsible accountant")
        expect(html).toContain(`<p class="ui-page-subtitle">From the Tax Authority&#x27;s portal, last updated 17\u00a0Nov\u00a02026.</p>`)
    })

    it("before the first file: the accountant alone in the subtitle, and the button", () => {
        const html = page(NONE, WRITES)
        expect(html).toContain(`<p class="ui-page-subtitle">Responsible accountant: <bdi>Tamer\u00a0Saleh</bdi></p>`)
        expect(html).toContain(">Contact the accountant</button>")
        expect(page(NONE, null)).not.toContain("ui-page-subtitle")
    })

    it("with nothing open: the subtitle and the button too", () => {
        const html = page(NOTHING_OPEN, WRITES)
        expect(html).toContain("last updated 17\u00a0Nov\u00a02026. Responsible accountant: <bdi>Tamer\u00a0Saleh</bdi></p>")
        expect(html).toContain(">Contact the accountant</button>")
    })

    it("opens no dialog until the button is pressed", () => {
        expect(page(POSITION, WRITES)).not.toContain("ui-contact-dialog")
    })
})

describe("the note under the claims", () => {
    it("says to use Contact the accountant where it's there", () => {
        expect(page(POSITION, WRITES)).toContain(`<p class="ui-portal-note">Amounts are in Egyptian pounds, as they were on the Tax Authority&#x27;s portal on 17\u00a0Nov\u00a02026, and penalties for paying late aren&#x27;t counted. To ask about any claim, use Contact the accountant at the top of the page.</p>`)
        expect(page(POSITION, WRITES, "ar")).toContain(`<p class="ui-portal-note">المبالغ بالجنيه المصري كما هي على بوابة مصلحة الضرائب يوم ١٧\u00a0نوفمبر\u00a0٢٠٢٦، وغرامات التأخير غير محسوبة. للاستفسار عن أي مطالبة، يُستخدم زر «التواصل مع المحاسب» أعلى الصفحة.</p>`)
    })

    it("says to contact the office where it isn't", () => {
        for (const accountant of [NO_NUMBER, null]) {
            expect(page(POSITION, accountant)).toContain("To ask about any claim, contact the office.</p>")
        }
    })
})

describe("the dialog", () => {
    it("titled, with a Close button at its title's end", () => {
        const html = dialog()
        expect(html).toMatch(/<div class="ui-dialog-head"><h2 id="[^"]+" class="ui-dialog-title">Contact the accountant<\/h2><button type="button" class="ui-btn ui-btn-quiet ui-dialog-close" aria-label="Close"><svg[^>]*>.*?<\/svg><\/button><\/div>/)
        expect(html).toContain(`class="ui-dialog ui-contact-dialog"`)
        expect(dialog({}, "ar")).toContain(`aria-label="${ar.close}"`)
    })

    it("who it reaches, in a box: their initials in a circle, their name, and what they are to the client", () => {
        expect(dialog()).toContain(`<div class="ui-contact-who"><span class="ui-contact-mark" aria-hidden="true">TS</span><div class="ui-contact-who-text"><p class="ui-contact-name">Tamer Saleh</p><p class="ui-contact-role">Responsible accountant for <bdi>Nile Trading</bdi></p></div></div>`)
        // Arabic initials kept apart, so they don't join into a word.
        expect(dialog({ name: "محمد صادق" }, "ar")).toContain(`<span class="ui-contact-mark" aria-hidden="true">م\u200cص</span>`)
        expect(dialog({ name: "محمد صادق" }, "ar")).toContain(`<p class="ui-contact-role">المحاسب المسؤول عن <bdi>Nile Trading</bdi></p>`)
    })

    it("the message in a field it can be changed in, as many lines tall as it is and one more, with its hint", () => {
        const html = dialog()
        expect(html).toMatch(/<label for="([^"]+)" class="ui-label">Message<\/label><div class="ui-contact-message"><textarea id="\1" aria-describedby="\1-hint" class="ui-input ui-textarea ui-contact-text" name="message" autoComplete="off" rows="4">Hello,\nThis is Mona Fouad from Nile Trading.\nA question about the tax position as of 17 November 2026:<\/textarea>/)
        expect(html).toMatch(/<span id="[^"]+-hint" class="ui-hint">The message can be changed here or in WhatsApp before it&#x27;s sent\.<\/span>/)
        expect(dialog({ message: "1\n2\n3\n4\n5\n6" })).toContain(`rows="7"`)
    })

    it("where the question goes after its last line, hidden from screen readers and never sent", () => {
        const html = dialog()
        expect(html).toContain(`<div class="ui-input ui-textarea ui-contact-ghost" aria-hidden="true">Hello,\nThis is Mona Fouad from Nile Trading.\nA question about the tax position as of 17 November 2026:\n<span class="ui-contact-ghost-hint">(Write your question here)</span></div>`)
        expect(dialog({}, "ar")).toContain(`<span class="ui-contact-ghost-hint">(يُكتب السؤال هنا)</span>`)
        // The copy carries what's written, so the field grows with it; the line only while the message is as given.
        const source = readFileSync("components/portal/ContactWhatsApp.tsx", "utf8")
        // Once changed, a space after its last line break, so a last empty line counts too.
        expect(source).toMatch(/\{`\$\{text\}\\n`\}\{text === message \? <span className="ui-contact-ghost-hint">\{t\('contact_question_here'\)\}<\/span> : ' '\}/)
    })

    it("Open WhatsApp first, opening wa.me in a new tab, which it says to screen readers; then Cancel", () => {
        const link = whatsAppLink("+201001234567", "Hello,\nThis is Mona Fouad from Nile Trading.\nA question about the tax position as of 17 November 2026:")
        expect(dialog()).toMatch(new RegExp(`<div class="ui-contact-actions"><a class="ui-btn ui-btn-primary" href="${esc(link).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}" target="_blank" rel="noopener noreferrer"><svg[^>]*>.*?</svg>Open WhatsApp<span class="ui-visually-hidden"> \\(opens in a new tab\\)</span></a><button type="button" class="ui-btn ui-btn-secondary">Cancel</button></div>`))
        expect(dialog({}, "ar")).toContain(`>فتح واتساب<span class="ui-visually-hidden"> ${ar.ui_opens_new_tab}</span></a><button type="button" class="ui-btn ui-btn-secondary">${ar.cancel}</button>`)
    })

    it("the line at its foot, after the buttons", () => {
        expect(dialog()).toMatch(/<\/div><p class="ui-contact-foot">WhatsApp opens on a phone, or WhatsApp Web on a computer, on the accountant&#x27;s number with the message ready to send\. The conversation stays in WhatsApp and isn&#x27;t kept here\.<\/p><\/div><\/div><\/div>$/)
    })

    it("nothing while it's closed", () => {
        expect(dialog({ open: false })).toBe("")
    })

    it("closes as WhatsApp opens", () => {
        // On the link's own tag: Cancel closes it too.
        expect(readFileSync("components/portal/ContactWhatsApp.tsx", "utf8")).toContain("<ButtonExternal variant=\"primary\" icon={ChatIcon} href={whatsAppLink(accountant.whatsappNumber, text)} onClick={onClose}>")
    })

    it("its message starts again each time it opens", () => {
        expect(readFileSync("components/portal/ContactWhatsApp.tsx", "utf8")).toMatch(/useAdjustOnChange\(\[open, message\], \(\) => setText\(message\)\)/)
    })
})

describe("a link that looks like a button, to another site", () => {
    const link = (locale: "en" | "ar" = "en") => {
        state.locale = locale
        return renderToStaticMarkup(h(ButtonExternal, { href: "https://example.com/a?b=1&c=2", children: "Go" }))
    }

    it("opens in a new tab, with nothing of the page passed on, and says so to screen readers", () => {
        expect(link()).toBe(`<a class="ui-btn ui-btn-secondary" href="https://example.com/a?b=1&amp;c=2" target="_blank" rel="noopener noreferrer">Go<span class="ui-visually-hidden"> (opens in a new tab)</span></a>`)
        expect(link("ar")).toContain(`<span class="ui-visually-hidden"> ${ar.ui_opens_new_tab}</span></a>`)
    })

    it("hands its press on, so what it's in can close as the tab opens", () => {
        expect(stripComments(readFileSync("components/ui/ButtonExternal.tsx", "utf8"))).toMatch(/<a [^>]*onClick=\{onClick\}>/)
    })
})

describe("its look", () => {
    it("up to 480px wide", () => {
        expect(rule(".ui-dialog.ui-contact-dialog")).toMatch(/width: min\(100%, 480px\);/)
    })

    it("a Close button at the title's end, 44px", () => {
        expect(rule(".ui-dialog-head")).toMatch(/display: flex;[\s\S]*align-items: center;[\s\S]*justify-content: space-between;/)
        const close = rule(".ui-dialog-close")
        expect(close).toMatch(/width: 44px;/)
        expect(close).toMatch(/height: 44px;/)
        expect(close).toMatch(/flex: none;/)
    })

    it("the box: a --rule edge, 12px inside, --radius-field corners", () => {
        const box = rule(".ui-contact-who")
        expect(box).toMatch(/border: 1px solid var\(--rule\);/)
        expect(box).toMatch(/border-radius: var\(--radius-field\);/)
        expect(box).toMatch(/padding: var\(--space-3\);/)
        expect(box).toMatch(/gap: var\(--space-3\);/)
    })

    it("the initials in a 44px circle on --brand-tint-strong, in --brand and weight 600", () => {
        const mark = rule(".ui-contact-mark")
        expect(mark).toMatch(/width: 44px;/)
        expect(mark).toMatch(/height: 44px;/)
        expect(mark).toMatch(/border-radius: 999px;/)
        expect(mark).toMatch(/background: var\(--brand-tint-strong\);/)
        expect(mark).toMatch(/color: var\(--brand\);/)
        expect(mark).toMatch(/font-weight: 600;/)
    })

    it("the name in --text-card and weight 600, what they are under it in --text-sm and --muted", () => {
        const name = rule(".ui-contact-name")
        expect(name).toMatch(/font-size: var\(--text-card\);/)
        expect(name).toMatch(/font-weight: 600;/)
        expect(name).toMatch(/color: var\(--ink\);/)
        const role = rule(".ui-contact-role")
        expect(role).toMatch(/font-size: var\(--text-sm\);/)
        expect(role).toMatch(/color: var\(--muted\);/)
    })

    it("where the question goes laid over the field in the same place, the message under it clear, the line in --muted", () => {
        // The field and its copy share one cell, so the field grows with whichever is taller: on a phone the
        // message wraps, and the line where the question goes stays inside the field.
        expect(rule(".ui-contact-message")).toMatch(/display: grid;/)
        const field = rule(".ui-input.ui-textarea.ui-contact-text")
        expect(field).toMatch(/grid-area: 1 \/ 1;/)
        expect(field).toMatch(/overflow: hidden;/)
        expect(field).toMatch(/resize: none;/)
        const ghost = rule(".ui-input.ui-textarea.ui-contact-ghost")
        expect(ghost).toMatch(/grid-area: 1 \/ 1;/)
        expect(ghost).not.toMatch(/position: absolute/)
        expect(ghost).toMatch(/pointer-events: none;/)
        expect(ghost).toMatch(/color: transparent;/)
        expect(ghost).toMatch(/background: transparent;/)
        expect(ghost).toMatch(/border-color: transparent;/)
        expect(ghost).toMatch(/white-space: pre-wrap;/)
        expect(ghost).toMatch(/overflow-wrap: break-word;/)
        expect(rule(".ui-contact-ghost-hint")).toMatch(/color: var\(--muted\);/)
    })

    it("the message with room between its lines, as the mockup has, the field and its copy alike", () => {
        expect(rule(".ui-contact-message > .ui-input")).toMatch(/line-height: var\(--leading-lg\);/)
    })

    it("a name too long for a phone's width breaks rather than push the page sideways", () => {
        expect(rule(".ui-page-subtitle > bdi")).toMatch(/overflow-wrap: anywhere;/)
    })

    it("the hint in --text-xs", () => {
        expect(rule(".ui-contact-dialog .ui-hint")).toMatch(/font-size: var\(--text-xs\);/)
    })

    it("the buttons on the start side, wrapping where there's no room", () => {
        const actions = rule(".ui-contact-actions")
        expect(actions).toMatch(/display: flex;/)
        expect(actions).toMatch(/flex-wrap: wrap;/)
        expect(actions).toMatch(/gap: var\(--space-2\);/)
        expect(actions).not.toMatch(/justify-content: flex-end/)
    })

    it("the line at its foot under a --rule edge, 12px under it, in --text-xs and --muted", () => {
        const foot = rule(".ui-contact-foot")
        expect(foot).toMatch(/border-block-start: 1px solid var\(--rule\);/)
        expect(foot).toMatch(/padding-block-start: var\(--space-3\);/)
        expect(foot).toMatch(/font-size: var\(--text-xs\);/)
        expect(foot).toMatch(/color: var\(--muted\);/)
    })
})

describe("its words", () => {
    it("in English", () => {
        expect(en.portal_contact_accountant).toBe("Contact the accountant")
        expect(en.portal_tax_accountant).toBe("Responsible accountant: {name}")
        expect(en.portal_tax_note_accountant).toBe("Amounts are in Egyptian pounds, as they were on the Tax Authority's portal on {date}, and penalties for paying late aren't counted. To ask about any claim, use Contact the accountant at the top of the page.")
        expect(en.contact_accountant_for).toBe("Responsible accountant for {client}")
        expect(en.contact_message_label).toBe("Message")
        expect(en.contact_message_hint).toBe("The message can be changed here or in WhatsApp before it's sent.")
        expect(en.contact_question_here).toBe("(Write your question here)")
        expect(en.contact_open_whatsapp).toBe("Open WhatsApp")
        expect(en.contact_foot).toBe("WhatsApp opens on a phone, or WhatsApp Web on a computer, on the accountant's number with the message ready to send. The conversation stays in WhatsApp and isn't kept here.")
    })

    it("in Arabic, as the mockup says them, neutral as the app's are", () => {
        expect(ar.portal_contact_accountant).toBe("التواصل مع المحاسب")
        expect(ar.portal_tax_accountant).toBe("المحاسب المسؤول: {name}")
        expect(ar.portal_tax_note_accountant).toBe("المبالغ بالجنيه المصري كما هي على بوابة مصلحة الضرائب يوم {date}، وغرامات التأخير غير محسوبة. للاستفسار عن أي مطالبة، يُستخدم زر «التواصل مع المحاسب» أعلى الصفحة.")
        expect(ar.contact_accountant_for).toBe("المحاسب المسؤول عن {client}")
        expect(ar.contact_message_label).toBe("الرسالة")
        expect(ar.contact_message_hint).toBe("يمكن تعديل الرسالة هنا أو في واتساب قبل الإرسال.")
        expect(ar.contact_question_here).toBe("(يُكتب السؤال هنا)")
        expect(ar.contact_open_whatsapp).toBe("فتح واتساب")
        expect(ar.contact_foot).toBe("يُفتح واتساب على الهاتف، أو واتساب ويب على الكمبيوتر، على رقم المحاسب والرسالة مكتوبة وجاهزة للإرسال. المحادثة تبقى على واتساب ولا تُحفظ هنا.")
    })

    it("the message's lines", () => {
        expect([en.contact_message_greeting, en.contact_message_from, en.contact_message_position, en.contact_message_position_undated])
            .toEqual(["Hello,", "This is {person} from {client}.", "A question about the tax position as of {date}:", "A question about the tax position:"])
        expect([ar.contact_message_greeting, ar.contact_message_from, ar.contact_message_position, ar.contact_message_position_undated])
            .toEqual(["السلام عليكم،", "أنا {person} من {client}.", "استفسار عن الموقف الضريبي بتاريخ {date}:", "استفسار عن الموقف الضريبي:"])
    })
})

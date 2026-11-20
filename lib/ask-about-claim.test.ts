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
 * Ask about this claim on the client's own page (CLIENT_PORTAL_PLAN.md §7,
 * §12 step 9d; DESIGN.md §5.2, An icon button, and §5.5, A client's tax
 * position and Contact on WhatsApp; PR 345), as the owner's mockup draws it:
 * a button on each claim, in the table and on the phone's cards, opening
 * Contact on WhatsApp with that claim's message, and the note under the
 * claims pointing to it.
 */

const state = { locale: "en" as "en" | "ar" }

vi.mock("@/context/LanguageContext", () => ({
    useLanguage: () => ({ locale: state.locale, t: (key: string) => (state.locale === "ar" ? ar : en)[key as keyof typeof en] ?? key }),
}))
vi.mock("@/lib/useHydrated", () => ({ useHydrated: () => true }))
vi.mock("react-dom", async (importOriginal) => ({ ...(await importOriginal<typeof import("react-dom")>()), createPortal: (node: unknown) => node }))

const { claimMessage, contactMessage } = await import("./contact-message")
const { PortalHome, askingOf } = await import("@/components/portal/PortalHome")
const { IconButton } = await import("@/components/ui")
const { ChatTextIcon } = await import("@phosphor-icons/react/ssr")

beforeEach(() => {
    state.locale = "en"
    // The dialog is drawn into the page's body, which a test stands in for.
    vi.stubGlobal("document", { body: {} })
})

const t = (locale: "en" | "ar") => (key: string) => (locale === "ar" ? ar : en)[key as keyof typeof en] ?? key

const TODAY = "2026-11-19"
const AS_OF = "2026-11-17"
const claim = (claimNumber: string, item: string, original: number, paid: number, dueDate: string): TaxClaimRow => ({
    id: claimNumber, claimNumber, item, taxType: null, registrationType: null,
    originalAmount: original, paidAmount: paid, remainingAmount: Math.round((original - paid) * 100) / 100,
    currency: "جنيه مصري", status: null, periodStart: null, periodEnd: null, dueDate, daysLate: daysLate(dueDate, TODAY),
})
/** Made-up claims: one late, one partly paid, one with no badge. */
const LATE = claim("000110000001", "إقرار ضريبة الدخل", 1000, 0, "2025-06-30")
const PARTLY = claim("000110000002", "إقرار ضريبة الدخل", 21088.26, 7365, "2026-12-31")
const PLAIN = claim("000220000001", "إقرار القيمة المضافة", 400.5, 0, "2026-12-31")
const POSITION = summarise([LATE, PARTLY, PLAIN], TODAY, AS_OF)

/** A made-up accountant. */
const WRITES = { name: "Tamer Saleh", whatsappNumber: "+201001234567" }
const NO_NUMBER = { name: "Tamer Saleh", whatsappNumber: null }

const page = (accountant: typeof WRITES | typeof NO_NUMBER | null, locale: "en" | "ar" = "en", position: PortalTaxPosition = POSITION) => {
    state.locale = locale
    return renderToStaticMarkup(h(PortalHome, { client: "Nile Trading", person: "Mona Fouad", position, accountant }))
}
const between = (html: string, from: string, to: string) => {
    const start = html.indexOf(from)
    expect([from, start >= 0]).toEqual([from, true])
    const end = html.indexOf(to, start)
    return html.slice(start, end < 0 ? undefined : end + to.length)
}
const table = (html: string) => between(html, '<table class="ui-claims-table">', "</table>")
const phoneCards = (html: string) => between(html, '<div class="ui-claims-phone">', "</section>")
const ask = (number: string, locale: "en" | "ar" = "en") => locale === "ar"
    ? `<button type="button" class="ui-btn ui-btn-quiet ui-btn-icon ui-claim-ask" aria-label="استفسار عن المطالبة ${number} على واتساب" title="استفسار عن هذه المطالبة على واتساب" aria-haspopup="dialog"><svg`
    : `<button type="button" class="ui-btn ui-btn-quiet ui-btn-icon ui-claim-ask" aria-label="Ask about claim ${number} on WhatsApp" title="Ask about this claim on WhatsApp" aria-haspopup="dialog"><svg`
const count = (html: string, part: string) => html.split(part).length - 1

const css = stripComments(readFileSync("components/ui/ui.css", "utf8"))
/** The body of the rule whose selector is exactly this one, outside any media block. */
function rule(selector: string): string {
    const at = css.search(new RegExp(`(^|\\})\\s*${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{`, "m"))
    expect([selector, at >= 0]).toEqual([selector, true])
    const open = css.indexOf("{", at + 1)
    return css.slice(open + 1, css.indexOf("}", open))
}
/** The phone's media block that shows the claims' cards. */
const phoneBlock = () => {
    const at = css.indexOf("@media (max-width: 767px) {\n  .ui-portal-claims-head")
    expect(at).toBeGreaterThan(0)
    return css.slice(at, css.indexOf("\n}\n", at))
}
const source = (file: string) => stripComments(readFileSync(file, "utf8"))

describe("a button that's only an icon", () => {
    it("quiet, named for screen readers, with what it does when pointed at", () => {
        state.locale = "en"
        expect(renderToStaticMarkup(h(IconButton, { icon: ChatTextIcon, label: "Ask about claim 1 on WhatsApp", tip: "Ask about this claim on WhatsApp" })))
            .toMatch(/^<button type="button" class="ui-btn ui-btn-quiet ui-btn-icon" aria-label="Ask about claim 1 on WhatsApp" title="Ask about this claim on WhatsApp"><svg[^>]*>.*<\/svg><\/button>$/)
    })

    it("its name as its tooltip where it has no other", () => {
        expect(renderToStaticMarkup(h(IconButton, { icon: ChatTextIcon, label: "Close" }))).toContain(`aria-label="Close" title="Close"`)
    })

    it("hands on what else it's given, such as what it opens and its press", () => {
        expect(renderToStaticMarkup(h(IconButton, { icon: ChatTextIcon, label: "L", className: "x", "aria-haspopup": "dialog" })))
            .toMatch(/^<button type="button" class="ui-btn ui-btn-quiet ui-btn-icon x" aria-label="L" title="L" aria-haspopup="dialog">/)
        expect(source("components/ui/Button.tsx")).toMatch(/export function IconButton\([^)]*\.\.\.rest[^)]*\)[\s\S]*?\{\.\.\.rest\}/)
    })

    it("44px square on phones and computers alike, its icon 20px", () => {
        expect(rule(".ui-btn.ui-btn-icon")).toMatch(/width: 44px;[\s\S]*height: 44px;[\s\S]*padding: 0;/)
        expect(rule(".ui-btn.ui-btn-icon")).toContain("flex: none;")
        expect(source("components/ui/Button.tsx")).toMatch(/<Icon icon=\{icon\} size=\{20\} \/>/)
    })
})

describe("the message for a claim", () => {
    it("in English: the claim's number, its item, what remains of the original and its last day to pay", () => {
        expect(claimMessage(t("en"), "en", { person: "Mona Fouad", client: "Nile Trading", item: "إقرار ضريبة الدخل", claim: PARTLY })).toBe(
            "Hello,\nThis is Mona Fouad from Nile Trading.\nA question about claim 000110000002:\nItem: إقرار ضريبة الدخل\nRemaining: EGP 13,723.26 of 21,088.26\nLast day to pay: 31 December 2026",
        )
    })

    it("in Arabic, as the plan writes it: the amounts and day in Arabic digits, the claim's number as it's typed into the portal", () => {
        expect(claimMessage(t("ar"), "ar", { person: "منى فؤاد", client: "شركة النيل للتجارة", item: "إقرار ضريبة الدخل", claim: PARTLY })).toBe(
            "السلام عليكم،\nأنا منى فؤاد من شركة النيل للتجارة.\nاستفسار عن المطالبة رقم 000110000002:\nالبند: إقرار ضريبة الدخل\nالمتبقي: ١٣٬٧٢٣٫٢٦ جنيه من ٢١٬٠٨٨٫٢٦\nآخر موعد للسداد: ٣١ ديسمبر ٢٠٢٦",
        )
    })

    it("whole amounts with their two decimals", () => {
        expect(claimMessage(t("en"), "en", { person: "Mona Fouad", client: "Nile Trading", item: "إقرار ضريبة الدخل", claim: LATE })).toContain("\nRemaining: EGP 1,000.00 of 1,000.00\nLast day to pay: 30 June 2025")
    })

    it("the item as the page names it, not as the claim was read", () => {
        const odd = { ...PLAIN, item: "إقرار  القيمة المضافة " }
        expect(claimMessage(t("en"), "en", { person: "Mona Fouad", client: "Nile Trading", item: "إقرار القيمة المضافة", claim: odd })).toContain("\nItem: إقرار القيمة المضافة\n")
    })
})

describe("what the dialog opens with", () => {
    it("from the page's header: Contact the accountant, with the page's message", () => {
        for (const locale of ["en", "ar"] as const) {
            expect(askingOf(t(locale), locale, { person: "Mona Fouad", client: "Nile Trading", asOf: AS_OF }, null)).toEqual({
                title: (locale === "ar" ? ar : en).portal_contact_accountant,
                message: contactMessage(t(locale), locale, { person: "Mona Fouad", client: "Nile Trading", asOf: AS_OF }),
            })
        }
    })

    it("from a claim: Ask about a claim, with that claim's message", () => {
        for (const locale of ["en", "ar"] as const) {
            expect(askingOf(t(locale), locale, { person: "Mona Fouad", client: "Nile Trading", asOf: AS_OF }, { claim: LATE, item: "إقرار ضريبة الدخل" })).toEqual({
                title: (locale === "ar" ? ar : en).contact_about_claim,
                message: claimMessage(t(locale), locale, { person: "Mona Fouad", client: "Nile Trading", item: "إقرار ضريبة الدخل", claim: LATE }),
            })
        }
    })

    it("a claim's button says which claim, with the name the page gives its item; the header's says none", () => {
        const home = source("components/portal/PortalHome.tsx")
        expect(home).toContain("<PortalClaims items={position.items} totals={totals} onAsk={reachable ? open : undefined} />")
        expect(home).toMatch(/onClick=\{\(\) => open\(null\)\}/)
        expect(home).toMatch(/\{\.\.\.askingOf\(t, locale, \{ person, client, asOf \}, about\)\}/)
        const claims = source("components/portal/PortalClaims.tsx")
        expect(claims).toContain("onClick={() => onAsk({ claim: c, item: item.item })}")
        // The same in the table and on the cards.
        expect(claims).toContain("<td>{end(c, item)}</td>")
        expect(claims).toContain("<span className=\"ui-claim-number\" dir=\"ltr\">{c.claimNumber}</span>{end(c, item)}</div>")
    })

    it("keeps what it was opened from while it closes, so its words don't change as it goes", () => {
        const home = source("components/portal/PortalHome.tsx")
        expect(home).toMatch(/const open = \(from: ClaimAsked \| null\) => \{\s*setAbout\(from\)\s*setContacting\(true\)\s*\}/)
        expect(home).toMatch(/onClose=\{\(\) => setContacting\(false\)\}/)
    })
})

describe("on each claim", () => {
    it("in the table: after its badges, at the end of its last cell", () => {
        const rows = table(page(WRITES))
        expect(rows).toContain(`<td><span class="ui-claim-end"><span class="ui-claims-badges"><span class="ui-badge ui-badge-problem">Late</span></span>${ask("000110000001")}`)
        expect(rows).toContain(`<td><span class="ui-claim-end"><span class="ui-claims-badges"><span class="ui-badge ui-badge-waiting">Partly paid</span></span>${ask("000110000002")}`)
        expect(rows).toContain(`<td><span class="ui-claim-end">${ask("000220000001")}`)
    })

    it("on the phone's cards: after its badges on the first line", () => {
        const cards = phoneCards(page(WRITES))
        expect(cards).toContain(`<div class="ui-claim-card-top"><span class="ui-claim-number" dir="ltr">000110000001</span><span class="ui-claim-end"><span class="ui-claims-badges"><span class="ui-badge ui-badge-problem">Late</span></span>${ask("000110000001")}`)
        expect(cards).toContain(`<div class="ui-claim-card-top"><span class="ui-claim-number" dir="ltr">000220000001</span><span class="ui-claim-end">${ask("000220000001")}`)
    })

    it("one on each claim, none on an item or the total", () => {
        const html = page(WRITES)
        expect(count(table(html), "ui-claim-ask")).toBe(3)
        expect(count(phoneCards(html), "ui-claim-ask")).toBe(3)
        expect(between(table(html), "<tfoot>", "</tfoot>")).not.toContain("ui-claim-ask")
    })

    it("named in Arabic as the mockup names it", () => {
        expect(table(page(WRITES, "ar"))).toContain(ask("000110000001", "ar"))
    })

    it("a speech bubble with lines in it", () => {
        expect(source("components/portal/PortalClaims.tsx")).toMatch(/<IconButton\s+icon=\{ChatTextIcon\}\s+className="ui-claim-ask"/)
    })

    it("none where the accountant has no number, or there's none to write to, the claims as they were", () => {
        for (const accountant of [NO_NUMBER, null]) {
            const html = page(accountant)
            expect(html).not.toContain("ui-claim-ask")
            expect(html).not.toContain("ui-claim-end")
            expect(table(html)).toContain(`<td><span class="ui-claims-badges"><span class="ui-badge ui-badge-problem">Late</span></span></td>`)
        }
    })

    it("opens no dialog until it's pressed", () => {
        expect(page(WRITES)).not.toContain("ui-contact-dialog")
    })
})

describe("its look", () => {
    it("the badges and the button on one line, the button at the cell's end side", () => {
        expect(rule(".ui-claim-end")).toMatch(/display: flex;[\s\S]*align-items: center;[\s\S]*gap: var\(--space-2\);/)
        expect(rule(".ui-claim-end > .ui-claim-ask")).toContain("margin-inline-start: auto;")
    })

    it("kept from making a claim's row taller than its words do", () => {
        expect(rule(".ui-claims-table .ui-claim-ask")).toMatch(/margin-block: calc\(var\(--space-2\) \* -1\);/)
    })
})

describe("the note under the claims", () => {
    it("points to the button in the claim's row on computers and its card on phones, where it's there", () => {
        expect(page(WRITES)).toContain(`<p class="ui-portal-note">Amounts are in Egyptian pounds, as they were on the Tax Authority&#x27;s portal on 17\u00a0Nov\u00a02026, and penalties for paying late aren&#x27;t counted. <span class="ui-portal-note-row">To ask about any claim, the message button in its row opens WhatsApp with its number.</span><span class="ui-portal-note-card">To ask about any claim, the message button on its card opens WhatsApp with its number.</span></p>`)
        expect(page(WRITES, "ar")).toContain(`<p class="ui-portal-note">المبالغ بالجنيه المصري كما هي على بوابة مصلحة الضرائب يوم ١٧\u00a0نوفمبر\u00a0٢٠٢٦، وغرامات التأخير غير محسوبة. <span class="ui-portal-note-row">للاستفسار عن أي مطالبة، زر الرسالة في صفها يفتح واتساب برقمها.</span><span class="ui-portal-note-card">للاستفسار عن أي مطالبة، زر الرسالة في بطاقتها يفتح واتساب برقمها.</span></p>`)
    })

    it("one of the two at a time, as the table and the cards are", () => {
        expect(rule(".ui-portal-note-card")).toContain("display: none;")
        expect(phoneBlock()).toMatch(/\.ui-portal-note-row \{\s*display: none;\s*\}/)
        expect(phoneBlock()).toMatch(/\.ui-portal-note-card \{\s*display: inline;\s*\}/)
    })

    it("says to contact the office where there's no button", () => {
        for (const accountant of [NO_NUMBER, null]) {
            expect(page(accountant)).toContain("To ask about any claim, contact the office.</p>")
        }
    })
})

describe("its words", () => {
    it("in English", () => {
        expect(en.portal_claim_ask).toBe("Ask about claim {number} on WhatsApp")
        expect(en.portal_claim_ask_tip).toBe("Ask about this claim on WhatsApp")
        expect(en.contact_about_claim).toBe("Ask about a claim")
        expect(en.portal_tax_note_figures).toBe("Amounts are in Egyptian pounds, as they were on the Tax Authority's portal on {date}, and penalties for paying late aren't counted.")
        expect(en.portal_tax_note_ask_row).toBe("To ask about any claim, the message button in its row opens WhatsApp with its number.")
        expect(en.portal_tax_note_ask_card).toBe("To ask about any claim, the message button on its card opens WhatsApp with its number.")
        expect(en.contact_message_claim).toBe("A question about claim {number}:")
        expect(en.contact_message_item).toBe("Item: {item}")
        expect(en.contact_message_remaining).toBe("Remaining: EGP {remaining} of {original}")
        expect(en.contact_message_due).toBe("Last day to pay: {date}")
    })

    it("in Arabic, as the mockup and the plan say them", () => {
        expect(ar.portal_claim_ask).toBe("استفسار عن المطالبة {number} على واتساب")
        expect(ar.portal_claim_ask_tip).toBe("استفسار عن هذه المطالبة على واتساب")
        expect(ar.contact_about_claim).toBe("استفسار عن مطالبة")
        expect(ar.portal_tax_note_figures).toBe("المبالغ بالجنيه المصري كما هي على بوابة مصلحة الضرائب يوم {date}، وغرامات التأخير غير محسوبة.")
        expect(ar.portal_tax_note_ask_row).toBe("للاستفسار عن أي مطالبة، زر الرسالة في صفها يفتح واتساب برقمها.")
        expect(ar.portal_tax_note_ask_card).toBe("للاستفسار عن أي مطالبة، زر الرسالة في بطاقتها يفتح واتساب برقمها.")
        expect(ar.contact_message_claim).toBe("استفسار عن المطالبة رقم {number}:")
        expect(ar.contact_message_item).toBe("البند: {item}")
        expect(ar.contact_message_remaining).toBe("المتبقي: {remaining} جنيه من {original}")
        expect(ar.contact_message_due).toBe("آخر موعد للسداد: {date}")
    })

    it("the note's words from before the button, gone", () => {
        expect("portal_tax_note_accountant" in en).toBe(false)
        expect("portal_tax_note_accountant" in ar).toBe(false)
    })
})

import { describe, it, expect, vi } from "vitest"
import { createElement as h } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { readFileSync } from "node:fs"
import { ar } from "./translations/ar"
import { en } from "./translations/en"
import { stripComments } from "./strip-comments"
import { keepsFirstContacts } from "./attendance/terminal-connections"

/**
 * A ZKTeco terminal's first contacts, on screen and as they are wired
 * (ATTENDANCE_PLAN.md §17.8, Phase 4 part 6, PR 299; DESIGN.md §5.5,
 * Dialog): First contacts in the menu of every terminal straight to Nizmo,
 * the dialog's line for a ZKTeco terminal, the words for what Nizmo made of
 * its requests, and where keeping sits in the handler. What is kept is in
 * lib/attendance/zkteco-first-contact.test.ts and
 * lib/terminal-adms-first-contacts.db.test.ts.
 */

type Loaded = { data?: unknown; error?: unknown; isValidating?: boolean }
const state = { locale: "en" as "en" | "ar", swr: {} as Record<string, Loaded> }

vi.mock("@/context/LanguageContext", () => ({
    useLanguage: () => ({ locale: state.locale, isRtl: state.locale === "ar", t: (key: string) => (state.locale === "ar" ? ar : en)[key as keyof typeof en] ?? key }),
}))
vi.mock("@/lib/useHydrated", () => ({ useHydrated: () => true }))
vi.mock("react-dom", async (importOriginal) => ({ ...(await importOriginal<typeof import("react-dom")>()), createPortal: (node: unknown) => node }))
vi.mock("swr", () => ({
    default: (key: string | null) => ({ data: undefined, error: undefined, isValidating: false, mutate: async () => {}, ...(key ? state.swr[key] ?? {} : {}) }),
}))
// A dialog is drawn into the page's body: here, where it's asked for.
vi.stubGlobal("document", { body: {} })

const source = (path: string) => stripComments(readFileSync(path, "utf8"))
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/'/g, "&#x27;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
const KEY = "/api/attendance/devices/z1/first-contacts"
const contact = (c: Record<string, unknown> = {}) => ({
    id: "k1", receivedAt: "2026-11-16T06:05:07Z", method: "GET", path: "/iclock/cdata?SN=ABC123&options=all&pushver=2.4.1",
    headers: { "user-agent": "iClock Proxy/1.09" }, otherHeaders: ["x-vercel-forwarded-for"], body: "", kind: "options", outcome: ["OPTIONS"], ...c,
})
const kept = (contacts = [contact()]) => ({ data: { success: true, data: { name: "Gate", firstContactAt: "2026-11-16T06:05:07Z", keptUntil: "2026-11-23T06:05:07Z", keeping: true, contacts } } })

async function render(protocol: "ZKTECO" | "HIKVISION", locale: "en" | "ar" = "en", contacts = [contact()]) {
    Object.assign(state, { locale, swr: { [KEY]: kept(contacts) } })
    const { TerminalContactsDialog } = await import("@/components/TerminalContactsDialog")
    return renderToStaticMarkup(h(TerminalContactsDialog, { deviceId: "z1", name: "Gate", protocol, onClose: () => {} }))
}

describe("where First contacts opens from", () => {
    it("is every terminal straight to Nizmo, whichever its protocol, and none the agent reads", () => {
        expect(keepsFirstContacts({ connection: "DIRECT" })).toBe(true)
        expect(keepsFirstContacts({ connection: "AGENT" })).toBe(false)
    })

    it("is in such a terminal's menu, for the Super Admin alone, and the dialog is told its protocol", () => {
        const panel = source("components/AttendanceTerminalsPanel.tsx")
        expect(panel).toContain("const contactsItem = (d: Device): MenuItem[] => (superAdmin && keepsFirstContacts(d) ? [{ key: 'contacts', label: t('att_term_contacts'), icon: ListMagnifyingGlassIcon, onSelect: () => setContactsOf(d) }] : [])")
        expect(panel).toContain("{contactsOf && <TerminalContactsDialog deviceId={contactsOf.id} name={contactsOf.name} protocol={contactsOf.protocol} onClose={() => setContactsOf(null)} />}")
    })
})

describe("the dialog, for a ZKTeco terminal", () => {
    it("says what is kept, and that only its scans are opened and its address on the office network is taken out", async () => {
        for (const locale of ["en", "ar"] as const) {
            const html = await render("ZKTECO", locale)
            const words = locale === "ar" ? ar : en
            expect(html).toContain(`<p class="ui-hint">${esc(words.att_term_contacts_intro_zkteco)}</p>`)
            expect(html).not.toContain(esc(words.att_term_contacts_intro))
        }
        // A Hikvision terminal's says what it said.
        expect(await render("HIKVISION")).toContain(`<p class="ui-hint">${esc(en.att_term_contacts_intro)}</p>`)
    })

    it("says in words what Nizmo made of each request: answered with its options, or not opened", async () => {
        for (const locale of ["en", "ar"] as const) {
            const words = locale === "ar" ? ar : en
            const html = await render("ZKTECO", locale, [contact(), contact({ id: "k2", method: "POST", path: "/iclock/cdata?SN=ABC123&table=OPERLOG", kind: "OPERLOG", outcome: ["NOT_OPENED"], body: "[not opened: changes to the people it holds carry their names]" })])
            expect(html).toContain(`<bdi>${esc(words.att_term_contact_OPTIONS)}</bdi>`)
            expect(html).toContain(`<bdi>${esc(words.att_term_contact_NOT_OPENED)}</bdi>`)
            // Its kind is as the protocol names it, left to right.
            expect(html).toContain('<bdi dir="ltr" translate="no">options</bdi>')
            expect(html).toContain('<bdi dir="ltr" translate="no">OPERLOG</bdi>')
        }
    })
})

describe("in the handler", () => {
    const handler = source("lib/attendance/zkteco-handler.ts")

    it("knows a request's kind, and whether it may be kept, before anything it sent is read", () => {
        const held = handler.indexOf("if (terminal.refused) return refuse(403)")
        const kind = handler.indexOf("const kind = admsKind(asked, req.method, url)")
        const counted = handler.indexOf("const keeping = await mayKeep(terminal, kind, req.method)")
        const read = handler.indexOf("await req.text()")
        expect(held).toBeGreaterThan(-1)
        expect(kind).toBeGreaterThan(held)
        expect(counted).toBeGreaterThan(kind)
        expect(read).toBeGreaterThan(counted)
        // Past its first 7 days nothing is looked up; with its kind full, or 50 kept, nothing is kept.
        expect(handler).toContain("if (!keepingFor(terminal.firstContactAt, new Date())) return false")
        expect(handler).toContain("return roomFor(await TerminalFirstContactService.counts(terminal.deviceId), kind)")
    })

    it("keeps a request only once it is taken, and never lets keeping hold the terminal", () => {
        const taken = handler.indexOf("const taken = await take(req, asked, terminal, address)")
        const keeps = handler.indexOf("if (keeping) await keepContact(")
        const answered = handler.indexOf("return say(taken.answer)")
        expect(taken).toBeGreaterThan(-1)
        expect(keeps).toBeGreaterThan(taken)
        expect(answered).toBeGreaterThan(keeps)
        // Counting and keeping each fail on their own, recorded and passed over.
        expect(handler.split("await notKept(").length).toBe(3)
        // The body is still read in one place, for attendance records alone.
        expect(handler.match(/req\.(text|json|formData|arrayBuffer|blob)\(\)/g)).toEqual(["req.text()"])
    })

    it("knows a terminal's first contact from its serial number, as it knows the rest", () => {
        const push = source("lib/services/attendance-terminal-push.service.ts")
        const bySerial = push.slice(push.indexOf("static async bySerial("), push.indexOf("static async calledFromElsewhere("))
        expect(bySerial).toContain("firstContactAt: true")
        expect(bySerial).toContain("firstContactAt: device.firstContactAt")
    })
})

describe("the words", () => {
    const KEYS = ["att_term_contacts_intro_zkteco", "att_term_contact_OPTIONS", "att_term_contact_NOT_OPENED"] as const

    it("are in both languages, with none of the marks the copy rules leave out", () => {
        for (const key of KEYS) {
            expect(en[key], key).toBeTruthy()
            expect(ar[key], key).toMatch(/[؀-ۿ]/)
            for (const words of [en[key], ar[key]]) expect(words, key).not.toMatch(/ · |→|\bwe\b|\bWe\b/)
        }
        expect(en.att_term_contact_OPTIONS).toBe("Answered with its options")
        expect(en.att_term_contact_NOT_OPENED).toBe("Not opened")
    })

    it("say what is kept as the plan has it, 50, 5 of a kind, 7 days, and what isn't opened", () => {
        for (const intro of [en.att_term_contacts_intro_zkteco, ar.att_term_contacts_intro_zkteco]) for (const n of ["50", "5", "7"]) expect(intro).toContain(n)
        expect(en.att_term_contacts_intro_zkteco).toContain("Only its scans are opened")
        expect(en.att_term_contacts_intro_zkteco).toContain("office network")
        // No secret address for a ZKTeco terminal: it has none.
        expect(en.att_term_contacts_intro_zkteco).not.toContain("secret")
    })
})

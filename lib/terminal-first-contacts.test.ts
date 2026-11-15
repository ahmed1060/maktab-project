import { describe, it, expect, vi } from "vitest"
import { createElement as h } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { readFileSync } from "node:fs"
import { ar } from "./translations/ar"
import { en } from "./translations/en"
import { stripComments } from "./strip-comments"

/**
 * A terminal's first contacts, on screen (ATTENDANCE_PLAN.md §17.8, Phase 4
 * part 5, PR 294; DESIGN.md §5.5, Dialog): the Super Admin's dialog, where
 * it opens from, how terminals connect on System health, and the words.
 * What is kept is in lib/attendance/terminal-first-contact.test.ts and
 * lib/terminal-first-contacts.db.test.ts; who reads it in
 * lib/attendance-terminals-access.test.ts.
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
const KEY = "/api/attendance/devices/d1/first-contacts"
const contact = (c: Record<string, unknown> = {}) => ({
    id: "k1", receivedAt: "2026-09-14T06:05:07Z", method: "POST", path: "/api/terminals/hikvision/[secret]",
    headers: { "user-agent": "Hikvision-Webs", "content-type": "application/json", authorization: "Digest [removed]" },
    otherHeaders: ["x-forwarded-for", "x-vercel-id"], body: '{\n  "eventType": "AccessControllerEvent",\n  "name": "[name removed]"\n}',
    kind: "AccessControllerEvent 5/75", outcome: ["STORED"], ...c,
})
const kept = (k: Record<string, unknown> = {}) => ({ data: { success: true, data: { name: "Lobby", firstContactAt: "2026-09-14T06:05:07Z", keptUntil: "2026-09-21T06:05:07Z", keeping: true, contacts: [contact()], ...k } } })
const when = (locale: "en" | "ar", iso: string) => new Date(iso).toLocaleString(locale === "ar" ? "ar-EG" : "en-GB", { dateStyle: "medium", timeStyle: "medium" })

async function render(swr: Loaded | undefined, locale: "en" | "ar" = "en") {
    Object.assign(state, { locale, swr: swr ? { [KEY]: swr } : {} })
    const { TerminalContactsDialog } = await import("@/components/TerminalContactsDialog")
    return renderToStaticMarkup(h(TerminalContactsDialog, { deviceId: "d1", name: "Lobby", onClose: () => {} }))
}

describe("First contacts, the Super Admin's dialog", () => {
    it("is named for the terminal, says what is kept and what is taken out, and changes nothing: Close is its only button", async () => {
        const html = await render(kept())
        expect(html).toContain(`>${en.att_term_contacts_title.replace("{name}", "Lobby")}</h2>`)
        expect(html).toContain(`<p class="ui-hint">${esc(en.att_term_contacts_intro)}</p>`)
        expect(html).toContain(esc(en.att_term_contacts_until.replace("{when}", when("en", "2026-09-21T06:05:07Z"))))
        // Its one row to open, Copy beside each of its boxes, and Close: nothing else to press.
        expect(html.match(/<button/g)).toHaveLength(1 + html.match(new RegExp(`>${en.att_guide_copy}<`, "g"))!.length + 1)
        expect(html).toContain(`>${en.close}</button>`)
        expect(html).not.toMatch(/<form|<input|<select/)
    })

    it("lists them in the order they came, each with what Nizmo made of it and when", async () => {
        const html = await render(kept({ contacts: [
            contact({ id: "k1", kind: "empty", outcome: ["EMPTY"], body: "" }),
            contact({ id: "k2", receivedAt: "2026-09-14T06:05:17Z", kind: "heartBeat", outcome: ["NOTHING"] }),
            contact({ id: "k3", receivedAt: "2026-09-14T06:06:00Z", outcome: ["STORED", "ALREADY", "REFUSED:IN_FUTURE"] }),
            contact({ id: "k4", receivedAt: "2026-09-14T06:07:00Z", kind: "AccessControllerEvent 5/113", outcome: ["REFUSED:EVENT_NOT_KNOWN:113"] }),
            contact({ id: "k5", receivedAt: "2026-09-14T06:08:00Z", kind: "unreadable", outcome: ["UNREADABLE", "SOMETHING_NEW"] }),
        ] }))
        expect(html).toContain(`<ol class="ui-rows ui-rows-flush" aria-label="${en.att_term_contacts}">`)
        const rows = html.split("<li>").slice(1)
        expect(rows).toHaveLength(5)
        expect(rows[0]).toContain(`<bdi>${esc(en.att_term_contact_EMPTY)}</bdi>`)
        expect(rows[1]).toContain(`<bdi>${en.att_term_contact_NOTHING}</bdi>`)
        // Each outcome in a run of its own, so two can't swap places in Arabic.
        expect(rows[2]).toContain([en.att_term_contact_STORED, en.att_term_contact_ALREADY, en.att_term_contact_REFUSED.replace("{reason}", en.att_term_refusal_IN_FUTURE)].map(w => `<bdi>${esc(w)}</bdi>`).join(en.list_separator))
        expect(rows[3]).toContain(esc(en.att_term_contact_REFUSED.replace("{reason}", en.att_term_refusal_EVENT_NOT_KNOWN.replace("{type}", "113"))))
        // An outcome with no words yet is shown as it was kept.
        expect(rows[4]).toContain(`<bdi>${esc(en.att_term_contact_UNREADABLE)}</bdi>${en.list_separator}<bdi>SOMETHING_NEW</bdi>`)
        // When, to the second, and its kind as the terminal writes it: in one piece, so the line can't split around its comma.
        expect(rows[1]).toContain(`<span class="ui-item-detail"><span><bdi>${when("en", "2026-09-14T06:05:17Z")}</bdi>${en.list_separator}<bdi dir="ltr" translate="no">heartBeat</bdi></span></span>`)
        expect(rows[3]).toContain('<bdi dir="ltr" translate="no">AccessControllerEvent 5/113</bdi>')
    })

    it("is a row that opens onto what it sent, closed until then: headers, the other headers' names, and the body, each in a box left to right", async () => {
        const html = await render(kept())
        const row = html.split("<li>")[1]
        // What Nizmo made of it and when are the button; what it sent is there, hidden, so the button names what it opens.
        const id = row.match(/<button type="button" class="ui-row-main ui-row-toggle" aria-expanded="false" aria-controls="([^"]+)">/)![1]
        expect(row).toContain(`<div id="${id}" class="ui-row-more" role="group" aria-label="${en.att_term_contact_sent}" hidden="">`)
        expect(row).toMatch(/<span class="ui-item-title"><bdi>A scan, stored<\/bdi><svg[^>]*class="ui-icon ui-row-caret"/)
        expect(row).not.toContain("<details")
        const labels = [...row.matchAll(/<dt>([^<]*)<\/dt>/g)].map(m => m[1])
        expect(labels).toEqual([en.att_term_contact_headers, esc(en.att_term_contact_other_headers), en.att_term_contact_body])
        // Each box is reached by the keyboard, to scroll a long one.
        const boxes = [...row.matchAll(/<pre id="[^"]*" dir="ltr" translate="no" tabindex="0"><code>([\s\S]*?)<\/code><\/pre>/g)].map(m => m[1])
        expect(boxes).toHaveLength(3)
        // The request's first line by the route's pattern, then its headers in order of the alphabet, a line each.
        expect(boxes[0]).toBe(esc("POST /api/terminals/hikvision/[secret]\nauthorization: Digest [removed]\ncontent-type: application/json\nuser-agent: Hikvision-Webs"))
        expect(boxes[1]).toBe("x-forwarded-for\nx-vercel-id")
        expect(boxes[2]).toBe(esc('{\n  "eventType": "AccessControllerEvent",\n  "name": "[name removed]"\n}'))
    })

    it("asks again while it's open, so a terminal being tried is seen sending", () => {
        const dialog = source("components/TerminalContactsDialog.tsx")
        expect(dialog).toContain("const REFRESH_MS = 10_000")
        expect(dialog).toContain("useSWR(`/api/attendance/devices/${deviceId}/first-contacts`, fetcher, { refreshInterval: REFRESH_MS })")
        // A row is known by its own id, so it stays open when more arrive.
        expect(dialog).toContain("key={c.id}")
    })

    it("keeps which rows are open itself, and lets several be open at once", () => {
        const dialog = source("components/TerminalContactsDialog.tsx")
        expect(dialog).toContain("const [open, setOpen] = useState<ReadonlySet<string>>(new Set())")
        expect(dialog).toContain("open={open.has(c.id)}")
        expect(dialog).toContain("onToggle={() => toggle(c.id)}")
    })

    it("says so where a request had no body, or no other headers", async () => {
        const row = (await render(kept({ contacts: [contact({ body: "", otherHeaders: [] })] }))).split("<li>")[1]
        expect([...row.matchAll(/<dt>([^<]*)<\/dt>/g)].map(m => m[1])).toEqual([en.att_term_contact_headers, en.att_term_contact_body])
        expect(row).toContain(`<dd>${en.att_term_contact_no_body}</dd>`)
        expect(row.match(/<pre /g)).toHaveLength(1)
    })

    it("says why there is nothing: none has come yet, or its first 7 days are over", async () => {
        const none = await render(kept({ firstContactAt: null, keptUntil: null, contacts: [] }))
        expect(none).toContain(`<p class="ui-card-note">${en.att_term_contacts_none}</p>`)
        expect(none).not.toContain("<ol")
        const over = await render(kept({ keeping: false, contacts: [] }))
        expect(over).toContain(`<p class="ui-card-note">${esc(en.att_term_contacts_over)}</p>`)
        // Whether more are kept is the server's to say, never the reader's clock.
        const dialog = source("components/TerminalContactsDialog.tsx")
        expect(dialog).toContain("!kept.keeping ? t('att_term_contacts_over')")
        expect(dialog).not.toContain("Date.now()")
    })

    it("says it is loading, and when it couldn't, offers to try again in its place", async () => {
        const loading = await render(undefined)
        expect(loading).toContain(`<p class="ui-card-note" role="status">${en.loading}</p>`)
        const failed = await render({ error: Object.assign(new Error("x"), { status: 500, info: { error: "Database unavailable" } }) })
        expect(failed).toContain(`<p class="ui-empty-title">${esc(en.att_term_contacts_failed)}</p>`)
        expect(failed).toContain("Database unavailable")
        expect(failed).toContain(`>${en.try_again}</button>`)
    })

    it("reads the same in Arabic, with what was sent still left to right", async () => {
        const html = await render(kept({ contacts: [contact({ outcome: ["STORED", "REFUSED:IN_FUTURE"] })] }), "ar")
        expect(html).toContain(`>${ar.att_term_contacts_title.replace("{name}", "Lobby")}</h2>`)
        expect(html).toContain(esc(ar.att_term_contacts_intro))
        expect(html).toContain(`<bdi>${ar.att_term_contact_STORED}</bdi>${ar.list_separator}<bdi>${esc(ar.att_term_contact_REFUSED.replace("{reason}", ar.att_term_refusal_IN_FUTURE))}</bdi>`)
        expect(html).toContain(`<bdi>${when("ar", "2026-09-14T06:05:07Z")}</bdi>`)
        expect(html).toContain(`role="group" aria-label="${ar.att_term_contact_sent}" hidden=""`)
        expect(html.match(/<pre id="[^"]*" dir="ltr" translate="no" tabindex="0">/g)).toHaveLength(3)
        expect(html).toContain('<bdi dir="ltr" translate="no">AccessControllerEvent 5/75</bdi>')
    })
})

describe("where it opens from", () => {
    const PANEL = source("components/AttendanceTerminalsPanel.tsx")

    it("is in the menu of a terminal straight to Nizmo, for the Super Admin alone, retired or not", () => {
        expect(PANEL).toContain("const superAdmin = session?.user?.role === 'SUPER_ADMIN'")
        expect(PANEL).toContain("const contactsItem = (d: Device): MenuItem[] => (superAdmin && hasAddress(d) ? [{ key: 'contacts', label: t('att_term_contacts'), icon: ListMagnifyingGlassIcon, onSelect: () => setContactsOf(d) }] : [])")
        // In both menus: a retired terminal's contacts can still be read.
        expect(PANEL.split("...contactsItem(d),")).toHaveLength(3)
        expect(PANEL).toContain("{contactsOf && <TerminalContactsDialog deviceId={contactsOf.id} name={contactsOf.name} onClose={() => setContactsOf(null)} />}")
    })

    it("is asked of a route that answers the Super Admin alone", () => {
        const route = source("app/api/attendance/devices/[id]/first-contacts/route.ts")
        expect(route).toContain(`if (session.user.role !== "SUPER_ADMIN") return ApiResponse.forbidden()`)
        expect(route.indexOf("SUPER_ADMIN")).toBeLessThan(route.indexOf("TerminalFirstContactService.list"))
        expect(route).not.toMatch(/export const (POST|PUT|PATCH|DELETE)/)
    })
})

describe("how terminals connect, on System health", () => {
    const company = (c: Record<string, unknown> = {}) => ({
        companyId: "c1", name: "Delta Sites", working: true, tone: "ok", agents: [],
        terminals: { total: 3, ok: 3, unreachable: 0, silent: 0, memoryFull: 0, clockOff: 0, direct: 2 }, ...c,
    })
    const card = async (companies: unknown[], locale: "en" | "ar" = "en") => {
        Object.assign(state, { locale, swr: { "/api/admin/terminals": { data: { success: true, data: { companies } } } } })
        const { default: TerminalsHealthCard } = await import("@/components/TerminalsHealthCard")
        return renderToStaticMarkup(h(TerminalsHealthCard))
    }

    it("says how many of a company's terminals are straight to Nizmo, and nothing where none is", async () => {
        const html = await card([company(), company({ companyId: "c2", name: "Nile Co", agents: [{ id: "a2", name: "Main", health: "OK", queueDepth: 0 }], terminals: { total: 1, ok: 1, unreachable: 0, silent: 0, memoryFull: 0, clockOff: 0, direct: 0 } })])
        const [delta, nile] = html.split("<li").slice(1)
        // A company with no agent has only its terminals to say.
        expect(delta).toContain([en.att_term_health_terminals.replace("{ok}", "3").replace("{total}", "3"), en.att_term_health_direct.replace("{n}", "2")].map(f => `<bdi>${f}</bdi>`).join(en.list_separator))
        expect(nile).not.toContain(en.att_term_health_direct.replace("{n}", "0"))
        expect(nile).not.toContain("Nizmo")
        expect((await card([company()], "ar"))).toContain(`<bdi>${ar.att_term_health_direct.replace("{n}", "٢")}</bdi>`)
    })

    it("lists a company for a terminal straight to Nizmo as well as for an agent", () => {
        const service = source("lib/services/attendance-terminal-status.ts")
        expect(service).toContain(`where: { OR: [{ attendanceAgents: { some: { status: { not: "REVOKED" } } } }, { attendanceDevices: { some: { connection: "DIRECT", retiredAt: null } } }] },`)
        expect(service).toContain(`direct: c.attendanceDevices.filter(d => d.connection === "DIRECT").length,`)
        // And says so where no company has either.
        expect(en.att_term_health_none).toBe("No company has a connected agent or a terminal straight to Nizmo yet.")
        expect(ar.att_term_health_none).toContain("Nizmo")
    })
})

describe("the migration, and the nightly job", () => {
    const sql = readFileSync("prisma/migrations/20261231000000_terminal_first_contacts/migration.sql", "utf8")
    const statements = sql.split("\n").filter(line => line.trim() && !line.trimStart().startsWith("--")).join("\n").split(";").map(s => s.trim()).filter(Boolean)

    it("only adds: a table with its indexes and its link to its terminal, and one empty column", () => {
        expect(statements.map(s => s.split("\n")[0].replace(/\s*\($/, ""))).toEqual([
            `CREATE TABLE "TerminalFirstContact"`,
            `CREATE INDEX "TerminalFirstContact_deviceId_receivedAt_idx" ON "TerminalFirstContact"("deviceId", "receivedAt")`,
            `CREATE INDEX "TerminalFirstContact_receivedAt_idx" ON "TerminalFirstContact"("receivedAt")`,
            `ALTER TABLE "TerminalFirstContact" ADD CONSTRAINT "TerminalFirstContact_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "AttendanceDevice"("id") ON DELETE CASCADE ON UPDATE CASCADE`,
            `ALTER TABLE "AttendanceDevice" ADD COLUMN "firstContactAt" TIMESTAMP(3)`,
            `ALTER TABLE "TerminalFirstContact" ENABLE ROW LEVEL SECURITY`,
        ])
        // Previews run it on production: nothing there is dropped, rewritten or required of a row that exists.
        expect(statements.join(";\n")).not.toMatch(/\b(DROP|RENAME|ALTER COLUMN|NOT NULL DEFAULT (?!CURRENT_TIMESTAMP))\b|^(UPDATE|DELETE|INSERT)\b/m)
    })

    it("has no column for the secret, the address a request came from, or a picture", () => {
        const columns = [...statements[0].matchAll(/^\s+"(\w+)"/gm)].map(m => m[1])
        expect(columns).toEqual(["id", "deviceId", "receivedAt", "method", "path", "headers", "otherHeaders", "body", "kind", "outcome"])
    })

    it("is pruned nightly, with the logs", () => {
        const prune = source("app/api/cron/prune/route.ts")
        expect(prune).toContain("TerminalFirstContactService.prune(),")
        expect(prune).toContain("const [logs, notifications, challenges, counts, tabs, contacts] = await JobHeartbeatService.run(\"prune\"")
    })

    it("is kept only once a request is taken, and never holds the terminal", () => {
        const handler = source("lib/attendance/terminal-handler.ts")
        const taken = handler.indexOf("await AttendanceTerminalPushService.receive(")
        const keeps = handler.indexOf("await keepContact(")
        expect(taken).toBeGreaterThan(-1)
        expect(keeps).toBeGreaterThan(taken)
        // Past its first 7 days, or with 50 kept, no copy of the request is taken.
        expect(handler).toContain("if (!terminal.live || !keepingFor(terminal.firstContactAt, new Date())) return null")
        expect(handler).toContain("return roomFor(await TerminalFirstContactService.counts(terminal.deviceId)) ? req.clone() : null")
        // Counting what is kept is no more allowed to hold the terminal than keeping is: the copy is decided before the request is taken, on its own.
        const copies = handler.indexOf("const copy = await copyToKeep(req, terminal)")
        expect(copies).toBeGreaterThan(-1)
        expect(copies).toBeLessThan(taken)
        expect(handler.split("await notKept(").length).toBe(3)
        // What is kept is counted again as it is kept, one at a time for a terminal, without holding up a scan being stored.
        const service = source("lib/services/terminal-first-contact.service.ts")
        expect(service).toContain('SELECT "firstContactAt" FROM "AttendanceDevice" WHERE id = ${deviceId} FOR NO KEY UPDATE')
        expect(service).toContain("if (!roomFor(await TerminalFirstContactService.counts(deviceId, tx), contact.kind)) return false")
        // What is kept names the route by its pattern, never the request's own address.
        expect(handler).toContain("path: HIKVISION_ROUTE,")
        expect(handler).not.toMatch(/path: (copy|req)\.url/)
    })
})

describe("the words", () => {
    const KEYS = [
        "att_term_contacts", "att_term_contacts_title", "att_term_contacts_intro", "att_term_contacts_none", "att_term_contacts_until", "att_term_contacts_over",
        "att_term_contacts_failed", "att_term_contact_sent", "att_term_contact_headers", "att_term_contact_other_headers", "att_term_contact_body", "att_term_contact_no_body",
        "att_term_contact_STORED", "att_term_contact_ALREADY", "att_term_contact_SKIPPED", "att_term_contact_REFUSED", "att_term_contact_NOTHING",
        "att_term_contact_UNREADABLE", "att_term_contact_EMPTY", "att_term_health_direct",
    ] as const

    it("are in both languages, with the same slots, and none of the marks the copy rules leave out", () => {
        for (const key of KEYS) {
            const [english, arabic] = [en[key], ar[key]]
            expect(arabic, key).toMatch(/[؀-ۿ]/)
            expect([...arabic.matchAll(/\{\w+\}/g)].map(m => m[0]).sort(), key).toEqual([...english.matchAll(/\{\w+\}/g)].map(m => m[0]).sort())
            for (const words of [english, arabic]) expect(words, key).not.toMatch(/ · |→|\bwe\b|\bWe\b/)
        }
        // Sentence case: a label starts with a capital and has no other, names aside.
        for (const key of ["att_term_contacts", "att_term_contact_sent", "att_term_contact_headers", "att_term_contact_body"] as const) expect(en[key], key).toMatch(/^[A-Z][a-z ]+$/)
    })

    it("say what is kept as the plan has it: 50, 5 of a kind, 7 days", () => {
        for (const intro of [en.att_term_contacts_intro, ar.att_term_contacts_intro]) for (const n of ["50", "5", "7"]) expect(intro).toContain(n)
    })
})

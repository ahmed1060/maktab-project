import { describe, it, expect, vi } from "vitest"
import { createElement as h } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { readFileSync } from "node:fs"
import { ar } from "./translations/ar"
import { en } from "./translations/en"
import { stripComments } from "./strip-comments"
import { KNOWN_REFUSALS } from "./api-errors"

/**
 * Change connection, on Fingerprint terminals (ATTENDANCE_PLAN.md §17.6,
 * §17.7, Phase 4 part 6, PR 298; DESIGN.md §5.5 Dialog): where it's
 * offered, its dialog either way, the step-up code straight to Nizmo
 * alone, and the words. What the server does is in
 * lib/terminal-change-connection.db.test.ts, against a real Postgres.
 */

const state = { locale: "en" as "en" | "ar" }
vi.mock("@/context/LanguageContext", () => ({
    useLanguage: () => ({ locale: state.locale, isRtl: state.locale === "ar", t: (key: string) => (state.locale === "ar" ? ar : en)[key as keyof typeof en] ?? key }),
}))
vi.mock("@/lib/useHydrated", () => ({ useHydrated: () => true }))
vi.mock("react-dom", async (importOriginal) => ({ ...(await importOriginal<typeof import("react-dom")>()), createPortal: (node: unknown) => node }))
// A dialog is drawn into the page's body: here, where it's asked for.
vi.stubGlobal("document", { body: {} })

const source = (path: string) => stripComments(readFileSync(path, "utf8"))
const PANEL = source("components/AttendanceTerminalsPanel.tsx")
const DIALOGS = source("components/TerminalAddDialog.tsx")
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/'/g, "&#x27;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
/** A sentence as it's drawn: what's between backticks in a box of its own. */
const drawn = (s: string) => esc(s).replace(/`([^`]+)`/g, '<code class="ui-guide-inline" dir="ltr" translate="no">$1</code>')
const words = (locale: "en" | "ar") => (locale === "ar" ? ar : en)

describe("the Change connection dialog", () => {
    const render = async (locale: "en" | "ar", props: { to: "AGENT" | "DIRECT"; officeAsked: boolean; protocol?: "ZKTECO" | "HIKVISION" }) => {
        state.locale = locale
        const { ConnectionDialog } = await import("@/components/TerminalAddDialog")
        return renderToStaticMarkup(h(ConnectionDialog, { name: "Front door", protocol: "ZKTECO", busy: false, onClose: () => {}, onSubmit: async () => {}, ...props }))
    }
    const buttons = (html: string) => [...html.matchAll(/<button type="(button|submit)" class="ui-btn ([a-z-]+)"[^>]*>([^<]+)<\/button>/g)].map(m => [m[2], m[3]])

    it("moving straight to Nizmo: titled with where it moves to, says what changes, asks for the office's address, and says the move", async () => {
        for (const locale of ["en", "ar"] as const) {
            const w = words(locale)
            const html = await render(locale, { to: "DIRECT", officeAsked: true })
            expect(html).toContain(`>${esc(w.att_term_move_DIRECT_title.replace("{name}", "Front door"))}</h2>`)
            expect(html).toContain(drawn(w.att_term_move_DIRECT_body))
            expect(html).toContain(`>${esc(w.att_term_office)}</label>`)
            expect(html).toMatch(/<textarea[^>]*name="officeAddresses"[^>]*dir="ltr"[^>]*><\/textarea>/)
            // Cancel, then the move, which isn't the danger colour: nothing is lost.
            expect(buttons(html)).toEqual([["ui-btn-secondary", w.cancel], ["ui-btn-primary", w.att_term_move_DIRECT]])
        }
    })

    it("asks for no address where the terminal moving straight to Nizmo has none", async () => {
        const html = await render("en", { to: "DIRECT", officeAsked: false })
        expect(html).not.toContain('name="officeAddresses"')
        expect(buttons(html).at(-1)).toEqual(["ui-btn-primary", en.att_term_move_DIRECT])
    })

    it("moving to the agent: asks first, says to turn the terminal's cloud setting off, and isn't the danger colour", async () => {
        for (const locale of ["en", "ar"] as const) {
            const w = words(locale)
            const html = await render(locale, { to: "AGENT", officeAsked: false })
            expect(html).toContain(`>${esc(w.att_term_move_AGENT_title.replace("{name}", "Front door"))}</h2>`)
            expect(html).toContain(drawn(w.att_term_move_AGENT_body))
            expect(html).toContain('<code class="ui-guide-inline" dir="ltr" translate="no">Cloud Server Setting</code>')
            expect(html).not.toContain("<textarea")
            expect(buttons(html)).toEqual([["ui-btn-secondary", w.cancel], ["ui-btn-primary", w.att_term_move_AGENT]])
        }
    })

    it("moving a Hikvision terminal to the agent: says to add it to agent.json and turn its HTTP Listening off (PR 301)", async () => {
        for (const locale of ["en", "ar"] as const) {
            const w = words(locale)
            const html = await render(locale, { to: "AGENT", officeAsked: false, protocol: "HIKVISION" })
            expect(html).toContain(drawn(w.att_term_move_AGENT_HIKVISION_body))
            expect(html).toContain('<code class="ui-guide-inline" dir="ltr" translate="no">HTTP Listening</code>')
            expect(html).toContain('<code class="ui-guide-inline" dir="ltr" translate="no">agent.json</code>')
            expect(html).not.toContain("Cloud Server Setting")
            expect(buttons(html)).toEqual([["ui-btn-secondary", w.cancel], ["ui-btn-primary", w.att_term_move_AGENT]])
            // Moving straight to Nizmo reads the same for either: what to set is shown after.
            expect(await render(locale, { to: "DIRECT", officeAsked: false, protocol: "HIKVISION" })).toContain(drawn(w.att_term_move_DIRECT_body))
        }
    })

    it("needs the office's address before anything is sent, and sends it only where it's asked for", () => {
        const dialog = DIALOGS.slice(DIALOGS.indexOf("export function ConnectionDialog("))
        expect(dialog).toContain("if (officeAsked && typed.length === 0) { setError(t('att_term_office_required')); focusFirstWrong(formRef.current); return }")
        expect(dialog).toContain("await onSubmit(officeAsked ? typed : undefined)")
        // Once sent it stays open until the work is done.
        expect(dialog).toContain("onClose={() => { if (!busy) onClose() }}")
        expect(dialog).toContain("<Button onClick={onClose} disabled={busy}>{t('cancel')}</Button>")
    })
})

describe("on Fingerprint terminals", () => {
    it("offers Change connection in the menu where another way is open to the terminal, and only for one not retired", () => {
        expect(PANEL).toContain("...(otherConnection(d, directAllowed) ? [{ key: 'connection', label: t('att_term_change_connection'), icon: PlugsConnectedIcon, onSelect: () => setMoving(d) }] : []),")
        const retired = PANEL.slice(PANEL.indexOf("const deviceMenu = (d: Device): MenuItem[] => d.retiredAt"), PANEL.indexOf(": [\n            { key: 'edit'"))
        expect(retired).not.toContain("otherConnection")
    })

    it("sends the move to its own route, then shows what to set on it, as after adding it", () => {
        expect(PANEL).toContain("const movingTo = moving ? otherConnection(moving, directAllowed) : null")
        expect(PANEL).toContain("<ConnectionDialog name={moving.name} to={movingTo} protocol={moving.protocol} officeAsked={hasOfficeAddress({ protocol: moving.protocol, connection: movingTo })}")
        expect(PANEL).toContain("send(`/api/attendance/devices/${moving.id}/connection`, { method: 'PUT', body: JSON.stringify({ connection: movingTo, ...(officeAddresses && { officeAddresses }) }) }, `att_term_moved_${movingTo}`, d => { showAddress(d); setMoving(null) })")
    })

    it("says nothing of what an agent saw on the row of a terminal straight to Nizmo", () => {
        expect(PANEL).toContain("d.connection === 'AGENT' && !d.reachable && d.lastError,")
    })
})

describe("the route", () => {
    const route = source("app/api/attendance/devices/[id]/connection/route.ts")

    it("asks for the step-up code to move straight to Nizmo alone, once it's known whose terminal it is", () => {
        expect(route).toContain("export const PUT = withStandardHandler(")
        expect(route).toContain('connection: z.enum(["AGENT", "DIRECT"]),')
        expect(route).toContain("officeAddresses: z.array(z.string().max(64)).max(MAX_IP_RANGES).optional(),")
        const denied = route.indexOf("if (denied) return denied")
        const stepUp = route.indexOf('if (validation.data.connection === "DIRECT") await assertStepUp(session, "attendance.manage_terminals")')
        const moved = route.indexOf("AttendanceDeviceService.changeConnection(device.id, validation.data, session.user.id)")
        expect(denied).toBeGreaterThan(-1)
        expect(stepUp).toBeGreaterThan(denied)
        expect(moved).toBeGreaterThan(stepUp)
        expect(route.match(/assertStepUp\(/g)).toHaveLength(1)
    })
})

describe("the silence check", () => {
    it("is for terminals through the agent alone: one straight to Nizmo calls when someone scans (§17.7)", () => {
        const alerts = source("lib/services/attendance-terminal-alerts.ts")
        expect(alerts).toContain('{ retiredAt: null, alertedAt: null, connection: "AGENT", agent: { status: "ACTIVE" }, ...silentSince(cutoff, "firstSeenAt") }')
        expect(alerts).toContain('!d.retiredAt && d.connection === "AGENT" && d.agent?.status === "ACTIVE"')
    })
})

describe("the words", () => {
    const KEYS = [
        "att_term_change_connection", "att_term_move_DIRECT_title", "att_term_move_AGENT_title", "att_term_move_DIRECT", "att_term_move_AGENT",
        "att_term_move_DIRECT_body", "att_term_move_AGENT_body", "att_term_move_AGENT_HIKVISION_body", "att_term_moved_DIRECT", "att_term_moved_AGENT",
    ] as const

    it("are there in both languages, with the same slots", () => {
        const slots = (s: string) => (s.match(/\{[a-z]+\}/g) ?? []).sort()
        for (const key of KEYS) {
            expect(en[key], key).toBeTruthy()
            expect(ar[key], key).toBeTruthy()
            expect(slots(ar[key]), key).toEqual(slots(en[key]))
            expect(/[؀-ۿ]/.test(ar[key]), key).toBe(true)
        }
        for (const key of ["att_term_move_DIRECT_title", "att_term_move_AGENT_title"] as const) expect(en[key]).toContain("{name}")
    })

    it("name the terminal's own setting the same in both languages, as it is on its screen", () => {
        const literals = (s: string) => s.match(/`[^`]+`/g) ?? []
        expect(literals(en.att_term_move_AGENT_body)).toEqual(["`Cloud Server Setting`"])
        expect(literals(ar.att_term_move_AGENT_body)).toEqual(literals(en.att_term_move_AGENT_body))
        // Hikvision's, as its HTTP Listening page names it, beside the agent's own file (PR 301).
        expect(literals(en.att_term_move_AGENT_HIKVISION_body)).toEqual(["`agent.json`", "`HTTP Listening`"])
        expect(literals(ar.att_term_move_AGENT_HIKVISION_body)).toEqual(literals(en.att_term_move_AGENT_HIKVISION_body))
        expect(en.att_term_address_intro).toContain("`HTTP Listening`")
    })

    it("say the move on its button, as its title says where it goes", () => {
        expect(en.att_term_move_DIRECT).toBe("Move straight to Nizmo")
        expect(en.att_term_move_AGENT).toBe("Move to the office agent")
        expect(en.att_term_move_DIRECT_title).toBe("Move {name} straight to Nizmo")
        expect(en.att_term_move_AGENT_title).toBe("Move {name} to the office agent")
    })
})

describe("the server's refusals", () => {
    it("say a move to the way it already connects in words", () => {
        expect(KNOWN_REFUSALS.DEVICE_SAME_CONNECTION).toMatchObject({ status: 409 })
        expect(KNOWN_REFUSALS.DEVICE_SAME_CONNECTION.message).toMatch(/already/)
    })
})

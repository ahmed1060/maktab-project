import { describe, it, expect, vi } from "vitest"
import { createElement as h } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { readFileSync } from "node:fs"
import { ar } from "./translations/ar"
import { en } from "./translations/en"
import { stripComments } from "./strip-comments"
import { KNOWN_REFUSALS } from "./api-errors"
import { AUDIT_ACTIONS } from "./audit-codes"
import { newPushSecret } from "./attendance/terminal-secrets"
import { hikvisionPath } from "./attendance/terminal-connections"

/**
 * Add a terminal, and its address shown once (ATTENDANCE_PLAN.md §17.7,
 * Phase 4 part 5, PR 292; DESIGN.md §5.3, §5.5 Dialog), on Fingerprint
 * terminals: the dialogs, the row of a terminal straight to Nizmo, and the
 * words. What the server does with them is in lib/terminal-add.db.test.ts,
 * and who reaches it in lib/attendance-terminals-access.test.ts.
 */

const state = { locale: "en" as "en" | "ar" }
vi.mock("@/context/LanguageContext", () => ({
    useLanguage: () => ({ locale: state.locale, isRtl: state.locale === "ar", t: (key: string) => (state.locale === "ar" ? ar : en)[key as keyof typeof en] ?? key }),
}))
vi.mock("@/lib/useHydrated", () => ({ useHydrated: () => true }))
vi.mock("react-dom", async (importOriginal) => ({ ...(await importOriginal<typeof import("react-dom")>()), createPortal: (node: unknown) => node }))
// A dialog is drawn into the page's body: here, where it's asked for.
vi.stubGlobal("document", { body: {} })

const HIK = { id: "b2", name: "Hikvision", protocol: "HIKVISION" as const, notesEn: "Its web page is at its address, on port 80.", notesAr: null }
const ZK = { id: "b3", name: "ZKTeco", protocol: "ZKTECO" as const, notesEn: null, notesAr: null }
const source = (path: string) => stripComments(readFileSync(path, "utf8"))
const PANEL = source("components/AttendanceTerminalsPanel.tsx")
const DIALOGS = source("components/TerminalAddDialog.tsx")
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/'/g, "&#x27;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
/** A sentence as it's drawn: what's between backticks in a box of its own. */
const drawn = (s: string) => esc(s).replace(/`([^`]+)`/g, '<code class="ui-guide-inline" dir="ltr" translate="no">$1</code>')

describe("Add a terminal", () => {
    const render = async (locale: "en" | "ar", props: object = {}) => {
        state.locale = locale
        const { TerminalAddDialog } = await import("@/components/TerminalAddDialog")
        return renderToStaticMarkup(h(TerminalAddDialog, { brands: [HIK, ZK], directAllowed: false, busy: false, onClose: () => {}, onSubmit: async () => {}, ...props }))
    }

    it("asks for the terminal's name, brand, serial number and how it reads scans, each under a visible label", async () => {
        const html = await render("en")
        expect(html).toContain(`>${en.att_term_add_device}</h2>`)
        for (const label of [en.att_term_device_name, en.att_term_brand, en.att_term_serial_label, en.att_term_mode]) expect(html, label).toContain(`>${label}</label>`)
        // The brands offered, after "Pick a brand": none is picked for them.
        expect(html).toContain(`<option value="" selected="">${en.att_term_brand_pick}</option><option value="b2">Hikvision</option><option value="b3">ZKTeco</option>`)
        // Brands are names as printed: never machine-translated (web audit).
        expect(html).toMatch(/<select[^>]*name="brand"[^>]*translate="no"/)
        // The serial number is typed as printed: left to right in either language, and never corrected.
        expect(html).toMatch(/<input[^>]*name="serialNumber"[^>]*>/)
        const serial = html.match(/<input[^>]*name="serialNumber"[^>]*>/)![0]
        for (const attr of ['dir="ltr"', 'autoComplete="off"', 'spellCheck="false"', 'maxLength="64"']) expect(serial.toLowerCase(), attr).toContain(attr.toLowerCase())
        expect(html).toContain(esc(en.att_term_serial_hint))
        expect(html).toContain(esc(en.att_term_add_brand_hint))
        // Cancel, then the one main button, named for what it does.
        expect(html).toMatch(new RegExp(`${en.cancel}</button><button type="submit" class="ui-btn ui-btn-primary"[^>]*>${en.att_term_add_device}</button>`))
    })

    it("says to pick the brand before it asks how the terminal connects", async () => {
        const html = await render("en", { directAllowed: true })
        expect(html).toContain(esc(en.att_term_connection_pick_brand))
        expect(html).not.toContain('type="radio"')
        expect(await render("ar")).toContain(esc(ar.att_term_connection_pick_brand))
    })

    it("lists the ways from the brand's protocol and the company's switch, the one not built greyed with why", () => {
        // The dialog draws what lib/attendance/terminal-connections.ts says, as the server checks it.
        expect(DIALOGS).toContain("connectionChoices(brand.protocol, directAllowed)")
        expect(DIALOGS).toContain("options={choices.map(c => ({ value: c.connection, label: t(`att_term_connection_${c.connection}`), disabled: !c.built }))}")
        expect(DIALOGS).toContain("warning={whyNot || undefined}")
        expect(DIALOGS).toContain("choices.filter(c => !c.built).map(c => t(NOT_BUILT[c.connection]))")
        expect(DIALOGS).toContain("NOT_BUILT = { AGENT: 'att_term_connection_agent_not_built', DIRECT: 'att_term_connection_direct_not_built' }")
        // With one way only, it is picked without asking; what the way means is said under the choice.
        expect(DIALOGS).toContain("built.length === 1 ? built[0] : ''")
        // A ZKTeco terminal straight to Nizmo has a hint of its own, as it is let in from the office's address (PR 297), and a
        // Hikvision one through the agent names the agent version that reads it (PR 303): lib/attendance/terminal-connections.ts.
        expect(DIALOGS).toContain("{connection && <p className=\"ui-hint\"><Sentence text={t(connectionHint(brand.protocol, connection))} /></p>}")
    })

    it("keeps Add where it is, greyed, with why beside it, where the brand can't be connected (DESIGN.md §5.2)", () => {
        expect(DIALOGS).toContain("const blocked = !!brand && built.length === 0")
        expect(DIALOGS).toContain("{blocked && <p id={noneId} className=\"ui-hint\">{t('att_term_connection_none')}</p>}")
        expect(DIALOGS).toContain("aria-disabled={blocked || undefined} aria-describedby={blocked ? noneId : undefined}")
        // Pressed, it sends nothing.
        expect(DIALOGS).toMatch(/e\.preventDefault\(\)\s+if \(blocked\) return/)
    })

    it("says what's missing under its field, and sends nothing until it's there", () => {
        for (const key of ["att_term_device_name_required", "att_term_brand_required", "att_term_serial_required"]) expect(DIALOGS, key).toContain(`t('${key}')`)
        expect(DIALOGS).toContain("focusFirstWrong(formRef.current); return")
        expect(DIALOGS).toContain("await onSubmit({ name: name.trim(), serialNumber: serialNumber.trim(), brandId: brand.id, mode, connection, ...(officeAsked && { officeAddresses: addressLines(office) }) })")
    })
})

describe("what to set on the terminal, shown once", () => {
    const secret = newPushSecret()
    const path = hikvisionPath(secret)
    const render = async (locale: "en" | "ar", props: object = {}) => {
        state.locale = locale
        const { TerminalAddressDialog } = await import("@/components/TerminalAddDialog")
        return renderToStaticMarkup(h(TerminalAddressDialog, { name: "Lobby", path, host: "nizmo.example", brand: null, onClose: () => {}, ...props }))
    }

    it("lists each setting under the terminal's own name for it, its value left to right and never translated", async () => {
        for (const locale of ["en", "ar"] as const) {
            const html = await render(locale)
            const words = locale === "ar" ? ar : en
            expect(html).toContain(`>${words.att_term_address_title.replace("{name}", "Lobby")}</h2>`)
            expect(html).toContain('<dl class="ui-device-settings">')
            // The names are the terminal's, to match on its screen: the same in both languages.
            const names = [...html.matchAll(/<dt><bdi dir="ltr" lang="en" translate="no">([^<]+)<\/bdi><\/dt>/g)].map(m => m[1])
            expect(names).toEqual(["Destination IP or domain name", "URL", "Port", "Protocol"])
            // The two too long to type are in a box with Copy; the others, as they're typed.
            const boxes = [...html.matchAll(/<pre id="[^"]+" dir="ltr" translate="no"><code>([^<]+)<\/code><\/pre>/g)].map(m => m[1])
            expect(boxes).toEqual(["nizmo.example", path])
            expect(html.match(new RegExp(`>${words.att_guide_copy}</button>`, "g"))).toHaveLength(2)
            expect(html).toContain('<dd><code class="ui-guide-inline" dir="ltr" translate="no">443</code></dd>')
            expect(html).toContain('<dd><code class="ui-guide-inline" dir="ltr" translate="no">HTTPS</code></dd>')
        }
    })

    it("says where the setting is, that the URL is secret and shown once, and how to stop the pictures", async () => {
        for (const locale of ["en", "ar"] as const) {
            const html = await render(locale)
            const words = locale === "ar" ? ar : en
            expect(html).toContain(`<p>${drawn(words.att_term_address_intro)}</p>`)
            expect(html).toContain(`<p class="ui-hint">${esc(words.att_term_address_once)}</p>`)
            expect(html).toContain(`<p>${drawn(words.att_term_address_pictures)}</p>`)
            expect(html).toContain(`<p>${esc(words.att_term_address_then)}</p>`)
            // In order: where, the settings, that it's shown once, the pictures, then trying it.
            const order = [drawn(words.att_term_address_intro), "ui-device-settings", esc(words.att_term_address_once), drawn(words.att_term_address_pictures), esc(words.att_term_address_then)].map(x => html.indexOf(x))
            expect(order).toEqual([...order].sort((a, b) => a - b))
            expect(order.every(at => at >= 0)).toBe(true)
        }
    })

    it("shows the secret once on the page, in the URL's box, and Done is its only button besides Copy", async () => {
        const html = await render("en")
        expect(html.split(secret)).toHaveLength(2)
        expect(html.match(/<button/g)).toHaveLength(html.includes('aria-label="Close"') ? 4 : 3)
        expect(html).toContain(`class="ui-btn ui-btn-primary">${en.att_term_done}</button>`)
        expect(html).not.toContain(`>${en.cancel}<`)
    })

    it("puts the brand's notes, the Super Admin's, above them, marked when they're in the other language", async () => {
        const withNotes = await render("en", { brand: HIK })
        expect(withNotes).toContain(`<p class="ui-guide-notes">About <bdi translate="no">Hikvision</bdi>: <bdi>${esc(HIK.notesEn)}</bdi></p>`)
        expect(withNotes.indexOf("ui-guide-notes")).toBeLessThan(withNotes.indexOf("ui-device-settings"))
        const other = await render("ar", { brand: HIK })
        expect(other).toContain(`<bdi lang="en">${esc(HIK.notesEn)}</bdi>`)
        // A brand with no notes, or one retired since and no longer offered, has none to show.
        expect(await render("en", { brand: ZK })).not.toContain("ui-guide-notes")
        expect(await render("en")).not.toContain("ui-guide-notes")
    })

    it("names this Nizmo's own address, as the page was opened on, and keeps the secret nowhere", () => {
        // The address in the setup card is a setting, not written into the code (§18, 6).
        expect(PANEL).toContain("host={window.location.host}")
        for (const file of [PANEL, DIALOGS, source("lib/attendance/terminal-connections.ts")]) {
            expect(file).not.toMatch(/nizmo\.vercel\.app/)
            expect(file).not.toMatch(/localStorage|sessionStorage|console\./)
        }
        // Held only while its dialog is open: closing it is the end of it.
        expect(PANEL).toContain("onClose={() => setShownAddress(null)}")
        expect(PANEL.match(/setShownAddress\(/g)).toHaveLength(2)
    })
})

describe("on Fingerprint terminals", () => {
    it("offers Add a terminal beside Add an agent, once the brands it asks for have loaded", () => {
        expect(PANEL).toContain("<Button icon={PlusIcon} disabled={busy || !devicesBody} onClick={() => setAddingDevice(true)}>{t('att_term_add_device')}</Button>")
        // Add an agent stays the card's one main button.
        expect(PANEL.match(/variant="primary" icon=\{PlusIcon\}/g)).toHaveLength(1)
        expect(PANEL.indexOf("t('att_term_add_device')}</Button>")).toBeLessThan(PANEL.indexOf("t('att_term_add_agent')}</Button>"))
    })

    it("sends what was asked to the company's terminals, and shows the address that comes back, once", () => {
        expect(PANEL).toContain("send('/api/attendance/devices', { method: 'POST', body: JSON.stringify({ companyId, ...terminal }) }, 'att_term_device_added'")
        expect(PANEL).toContain("<TerminalAddDialog brands={brands} directAllowed={directAllowed} busy={busy}")
        expect(PANEL).toContain("const directAllowed: boolean = devicesBody?.data?.directAllowed ?? false")
        expect(PANEL).toContain("if (d?.device && d.path) setShownAddress({ name: d.device.name, path: d.path, brandId: d.device.brand?.id ?? null })")
    })

    it("offers Issue a new address only for a terminal with an address of its own, and asks first", () => {
        expect(PANEL).toContain("...(hasAddress(d) ? [{ key: 'address', label: t('att_term_new_address'), icon: KeyIcon, onSelect: () => setReissuing(d) }] : [])")
        // Before Retire, which stays last, after its hairline.
        expect(PANEL.indexOf("key: 'address'")).toBeLessThan(PANEL.indexOf("key: 'retire'"))
        expect(PANEL).toContain("title={t('att_term_new_address_title').replace('{name}', reissuing?.name ?? '')}")
        expect(PANEL).toContain("<p>{t('att_term_new_address_body')}</p>")
        expect(PANEL).toContain("send(`/api/attendance/devices/${reissuing.id}/address`, { method: 'POST' }, 'att_term_address_issued', d => { showAddress(d); setReissuing(null) })")
        // It stops the address it has, which isn't a loss: asked about, with the main button, not the danger one.
        const dialog = PANEL.slice(PANEL.indexOf("open={!!reissuing}"), PANEL.indexOf("open={!!retiring}"))
        expect(dialog).toContain('variant="primary"')
        expect(dialog).not.toContain('variant="danger"')
    })

    it("shows a terminal added by hand as waiting until it's heard from, and says what one through the agent waits for", () => {
        expect(PANEL).toContain("WAITING: 'waiting'")
        expect(en.att_term_device_WAITING).toBe("Waiting for its first contact")
        expect(PANEL).toContain("d.health.state === 'WAITING'")
        expect(PANEL).toContain("? d.connection === 'AGENT' && t('att_term_waiting_agent')")
        expect(PANEL).toContain(": t('att_term_last_seen').replace('{when}', ago(d.lastSeenAt)),")
    })

    it("says of a terminal straight to Nizmo how it connects, where it calls from, and what was refused, in words", () => {
        expect(PANEL).toContain("d.connection === 'DIRECT' && t('att_term_connection_DIRECT'),")
        // The address is left to right and never translated, in a sentence of either language (web audit).
        expect(PANEL).toContain("if (d.connection !== 'DIRECT' || !d.lastAddress) return null")
        expect(PANEL).toContain("return <>{before}<bdi dir=\"ltr\" translate=\"no\">{d.lastAddress}</bdi>{after}</>")
        expect(PANEL).toContain("callsFrom(d),")
        expect(PANEL).toContain("refusedLine(d),")
        expect(PANEL).toContain("const words = d.lastRefusal ? refusalWords(d.lastRefusal) : null")
        // A reason with no words yet is shown as it was kept, never dropped.
        expect(PANEL).toContain("let reason: ReactNode = d.lastRefusal ?? ''")
        expect(PANEL).toContain("else if (words) reason = t(words.key).replace('{type}', words.type ?? '')")
        expect(PANEL).toContain("if (!(d.refusedCount > 0)) return null")
        // What an agent last said of it isn't shown for one that calls Nizmo itself.
        expect(PANEL).toContain("d.connection === 'AGENT' && !d.reachable && d.lastError,")
    })

    it("points the setup guide to Add a terminal for a model the company may connect straight to Nizmo, above the agent's steps", async () => {
        const { SetupGuideSteps } = await import("@/components/TerminalSetupGuide")
        const steps = (locale: "en" | "ar", props: object) => {
            state.locale = locale
            return renderToStaticMarkup(h(SetupGuideSteps, { brand: HIK, superAdmin: false, server: "https://nizmo.example", ...props }))
        }
        // Every model the agent reads keeps its steps either way, Hikvision's too from PR 303; where it may be added straight to Nizmo, a line above them says so (PR 297).
        for (const brand of [ZK, HIK]) {
            expect(steps("en", { brand, directAllowed: false })).toMatch(/^<ol class="ui-guide-steps"/)
            expect(steps("en", { brand })).toMatch(/^<ol class="ui-guide-steps"/)
            expect(steps("en", { brand, directAllowed: true }).startsWith(`<p class="ui-card-note">${esc(en.att_guide_direct_too)}</p><ol class="ui-guide-steps"`)).toBe(true)
            expect(steps("ar", { brand, directAllowed: true }).startsWith(`<p class="ui-card-note">${esc(ar.att_guide_direct_too)}</p><ol class="ui-guide-steps"`)).toBe(true)
        }
        // The guide's page hands it what the list says of the company (PR 356).
        expect(readFileSync("components/TerminalGuidePage.tsx", "utf8")).toContain("directAllowed={loaded?.directAllowed ?? false}")
    })
})

describe("the words", () => {
    const KEYS = Object.keys(en).filter(k => /^att_term_(add_device|device_added|device_WAITING|serial_(label|hint|required)|brand_(pick|required)|add_brand_hint|connection|waiting_agent|calls_from|refused_line|refusal_|new_address|address_)/.test(k)).concat("att_guide_direct_too")

    it("are there in both languages, with the same slots", () => {
        expect(KEYS.length).toBeGreaterThanOrEqual(40)
        const slots = (s: string) => (s.match(/\{[a-z]+\}/g) ?? []).sort()
        for (const key of KEYS) {
            const [e, a] = [(en as Record<string, string>)[key], (ar as Record<string, string>)[key]]
            expect(a, key).toBeTruthy()
            expect(slots(a), key).toEqual(slots(e))
            expect(/[؀-ۿ]/.test(a), key).toBe(true)
        }
    })

    it("name the terminal's own menus and options the same in both languages, as they are on its screen", () => {
        const literals = (s: string) => s.match(/`[^`]+`/g) ?? []
        for (const key of ["att_term_address_intro", "att_term_address_pictures"] as const) {
            expect(literals(en[key]).length, key).toBeGreaterThan(0)
            expect(literals(ar[key]), key).toEqual(literals(en[key]))
        }
        expect(literals(en.att_term_address_intro)).toEqual(["`HTTP Listening`", "`System and Maintenance`", "`System Configuration`", "`Network`", "`Network Service`", "`HTTP(S)`"])
        expect(literals(en.att_term_address_pictures)).toEqual(["`Upload Picture When Authenticating`", "`Upload Picture After Linked Capture`"])
    })

    it("say a list with none also takes a terminal added by hand", () => {
        expect(en.att_term_no_devices).toBe("No terminal yet. They appear here when an agent reports them, or when one is added.")
    })
})

describe("the server's side", () => {
    it("says why it refuses, in words", () => {
        expect(KNOWN_REFUSALS.DEVICE_SERIAL_REQUIRED.status).toBe(400)
        for (const code of ["DEVICE_SERIAL_TAKEN", "DEVICE_DIRECT_NOT_ALLOWED", "DEVICE_CONNECTION_NOT_BUILT", "DEVICE_NO_ADDRESS"]) {
            expect(KNOWN_REFUSALS[code], code).toMatchObject({ status: 409 })
            expect(KNOWN_REFUSALS[code].message.length, code).toBeGreaterThan(20)
        }
        expect(KNOWN_REFUSALS.DEVICE_SERIAL_TAKEN.message).toContain("restore it")
        expect(KNOWN_REFUSALS.DEVICE_DIRECT_NOT_ALLOWED.message).toContain("Super Admin")
    })

    it("writes a new address to the audit log under an action of its own, labelled in both languages", () => {
        expect(AUDIT_ACTIONS).toContain("ISSUE_TERMINAL_ADDRESS")
        expect(en.audit_action_ISSUE_TERMINAL_ADDRESS).toBe("Issued new terminal address")
        expect(ar.audit_action_ISSUE_TERMINAL_ADDRESS).toBeTruthy()
        expect(en.audit_field_connection).toBe("Connection")
        expect(ar.audit_field_connection).toBeTruthy()
    })

    it("never sends the secret's hash to the page, and issues an address only from the service", () => {
        const service = source("lib/services/attendance-device.service.ts")
        const shown = service.slice(service.indexOf("const SHOWN = {"), service.indexOf("} as const"))
        expect(shown).toContain("connection: true, lastAddress: true, refusedCount: true, lastRefusedAt: true, lastRefusal: true")
        expect(shown).not.toContain("pushSecretHash")
        // Who added it tells waiting from silent, on the server; the list leaves it out of what it sends.
        expect(service).toContain("return devices.map(({ addedById, ...d }) => ({ ...withBrand(d), health: deviceHealth({ ...d, addedById }, now, working, zone) }))")
        // The secret is made, hashed and returned in one place each for adding, issuing again, and moving straight to Nizmo (PR 298).
        expect(service.match(/newPushSecret\(\)/g)).toHaveLength(3)
        expect(service.match(/hashSecret\(secret\)/g)).toHaveLength(3)
        expect(service.match(/hikvisionPath\(secret\)/g)).toHaveLength(3)
        for (const route of ["app/api/attendance/devices/route.ts", "app/api/attendance/devices/[id]/address/route.ts", "app/api/attendance/devices/[id]/connection/route.ts"]) {
            expect(source(route), route).not.toMatch(/newPushSecret|hashSecret|pushSecretHash/)
        }
    })

    it("lays the settings out with the building blocks' tokens, and no side named", () => {
        const css = readFileSync("components/ui/ui.css", "utf8")
        const block = css.slice(css.indexOf(".ui-device-settings {"), css.indexOf("/* What's typed inside a sentence"))
        expect(block).toContain(".ui-device-settings dt {")
        expect(block).not.toMatch(/\b(left|right)\b/)
        expect(block).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
        expect(block).toMatch(/var\(--space-3\)/)
    })
})
